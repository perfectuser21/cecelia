/**
 * worker-pool-dispatch.js — 并行血管P1：worker 池自动派发（scheduler job，5min 自 gate）
 *
 * 扫 status='queued' 且（payload.parallel_worker=true 或 pipeline=canvas+canonical=exploratory）
 * 的任务 → 挑空闲 worker 槽（只用 tmux slot7-9；slot1-6 是 harness/主理人地盘绝不碰）→
 * 经 claude-launch.sh 发射交互 claude 跑 `/dev --task-id`（launcher 自动 session-id +
 * per-session worktree，youtou-dispatch-pattern 首航实证）。
 *
 * 纪律：
 * - 并发上限 MAX_CONCURRENT=2（忙槽 = pane_current_command 非 shell）
 * - 发射前 CAS 预占 claimed_by='interactive-dev-skill'——worker 内 /dev claim 撞 409 时
 *   见 claimed_by=interactive-dev-skill 即知是预占、继续执行（约定见任务 873acc6d）
 * - 发射即记 dispatch_events(dispatched)；发射失败记 failed_dispatch + 回滚 claim
 * - ssh 套壳后 exit code 不可靠（雷11 先例）：探活判断只信 stdout 内容
 * - prompt 经宿主文件交付（内联进引号嵌套必炸，harness headed 先例）
 */
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

export const WORKER_SLOTS = ['slot7', 'slot8', 'slot9'];
export const MAX_CONCURRENT = 2;
/** shell 即空闲；worker 跑完 claude 退出回 shell = 槽位自动释放 */
const IDLE_COMMANDS = new Set(['zsh', 'bash', 'sh', 'fish']);
const INTERVAL_MS = parseInt(process.env.CECELIA_WORKER_POOL_INTERVAL_MS || String(5 * 60 * 1000), 10);
const HOST_REPO = process.env.CECELIA_HOST_REPO || '/Users/administrator/perfect21/cecelia';
const PROMPT_DIR = '/tmp/cecelia-host-prompts';

let lastRunAt = 0;
export function __resetWorkerPoolDispatchForTest() {
  lastRunAt = 0;
}

function defaultSshPrefix() {
  // 对齐 harness-skill-relay headed 分支：容器内 localhost=容器自己，走宿主别名 + key 三件套
  const inDocker = (() => { try { return existsSync('/.dockerenv'); } catch { return false; } })();
  if (!inDocker) return { host: null, opts: '' };
  let key = process.env.HEADED_SSH_KEY || null;
  if (!key) {
    for (const k of ['/Users/administrator/.ssh/id_ed25519', '/Users/administrator/.ssh/id_rsa']) {
      try { if (existsSync(k)) { key = k; break; } } catch { /* ignore */ }
    }
  }
  const opts = `${key ? `-i ${key} ` : ''}-o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
  return { host: process.env.HEADED_SSH_HOST || 'administrator@host.docker.internal', opts };
}

export async function runWorkerPoolDispatch(pool, deps = {}) {
  const now = deps.now || Date.now;
  const t = now();
  if (t - lastRunAt < INTERVAL_MS) return { skipped: 'interval_gate', dispatched: 0 };
  lastRunAt = t;

  const execFn = deps.execFn
    || ((cmd, opts) => execSync(cmd, { encoding: 'utf8', timeout: 30000, ...opts }));
  const { host, opts: sshOpts } = deps.ssh || defaultSshPrefix();
  // 宿主直跑（测试/本机进程）时不套 ssh
  const wrap = (cmd) => (host ? `ssh ${sshOpts} ${host} "${cmd.replace(/"/g, '\\"')}"` : cmd);

  // ── 1. 槽位盘点（stdout 判读，exit code 不可信）────────────────────────────
  const slotState = {};
  for (const slot of WORKER_SLOTS) {
    try {
      const out = String(execFn(wrap(
        `tmux display-message -p -t ${slot} '#{pane_current_command}' 2>/dev/null || echo MISSING`
      ))).trim();
      slotState[slot] = out.includes('MISSING') ? 'missing' : (IDLE_COMMANDS.has(out) ? 'idle' : 'busy');
    } catch {
      slotState[slot] = 'missing'; // tmux server 未起等同全空闲可建
    }
  }
  const busy = WORKER_SLOTS.filter(s => slotState[s] === 'busy').length;
  if (busy >= MAX_CONCURRENT) return { skipped: 'concurrency_cap', dispatched: 0, busy };

  const budget = MAX_CONCURRENT - busy;
  const freeSlots = WORKER_SLOTS.filter(s => slotState[s] !== 'busy');
  const capacity = Math.min(budget, freeSlots.length);
  if (capacity <= 0) return { skipped: 'no_free_slot', dispatched: 0, busy };

  // ── 2. 扫队列（parallel_worker:true 或 canvas+exploratory）────────────────
  const { rows: tasks } = await pool.query(
    `SELECT id, title, payload FROM tasks
      WHERE status = 'queued' AND claimed_by IS NULL
        AND ( (payload->>'parallel_worker')::boolean IS TRUE
              OR (payload->>'pipeline' = 'canvas' AND payload->>'canonical' = 'exploratory') )
      ORDER BY created_at ASC
      LIMIT $1`,
    [capacity]
  );
  if (!tasks.length) return { skipped: 'queue_empty', dispatched: 0, busy };

  // ── 3. 逐任务：预占 → 发射 → 记账 ─────────────────────────────────────────
  let dispatched = 0;
  let slotIdx = 0;
  for (const task of tasks) {
    if (slotIdx >= freeSlots.length || dispatched >= budget) break;
    const slot = freeSlots[slotIdx];

    // CAS 预占：/dev worker claim 撞 409 见此名字即知预占、继续（任务 873acc6d 约定）
    const claim = await pool.query(
      `UPDATE tasks SET claimed_by = 'interactive-dev-skill', claimed_at = NOW()
        WHERE id = $1 AND status = 'queued' AND claimed_by IS NULL`,
      [task.id]
    );
    if (claim.rowCount === 0) continue; // 别人抢先，换下一个任务

    const prompt = [
      `/dev --task-id ${task.id} —— ${task.title || ''}`,
      `claim 若 409 且 claimed_by=interactive-dev-skill 属预占,继续执行勿停。`,
      `自治推进不停下问人。`,
    ].join('\n');
    const promptFile = `${PROMPT_DIR}/worker-${task.id}.prompt`;

    try {
      // prompt 经文件交付（stdin），避开三层引号嵌套
      execFn(wrap(`mkdir -p ${PROMPT_DIR} && cat > ${promptFile} && chmod 600 ${promptFile}`), { input: prompt });
      if (slotState[slot] === 'missing') {
        execFn(wrap(`tmux new-session -d -s ${slot}`));
      }
      execFn(wrap(
        `tmux send-keys -t ${slot} 'cd ${HOST_REPO} && bash scripts/claude-launch.sh "$(cat ${promptFile})"' Enter`
      ));
      await pool.query(
        `INSERT INTO dispatch_events (task_id, event_type, reason) VALUES ($1, $2, $3)`,
        [task.id, 'dispatched', `worker_pool:${slot}`]
      );
      console.log(`[worker-pool] dispatched task=${task.id} slot=${slot}`);
      dispatched++;
      slotIdx++;
    } catch (err) {
      console.error(`[worker-pool] 发射失败 task=${task.id} slot=${slot}: ${err.message}`);
      try {
        await pool.query(
          `INSERT INTO dispatch_events (task_id, event_type, reason) VALUES ($1, $2, $3)`,
          [task.id, 'failed_dispatch', `worker_pool:${slot}: ${err.message}`.slice(0, 500)]
        );
        await pool.query(
          `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1 AND claimed_by = 'interactive-dev-skill'`,
          [task.id]
        );
      } catch (accountErr) {
        console.warn(`[worker-pool] 失败记账/回滚异常（non-fatal）: ${accountErr.message}`);
      }
    }
  }
  return { dispatched, busy };
}
