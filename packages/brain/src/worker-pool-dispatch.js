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
 * - 第四病（09-07）：发射即认为成功 → pane 接管有秒级延迟窗口。
 *   ① 发射前僵尸检测：busy 槽在 DB 里找不到在途任务对应 = 空启动残留 claude，
 *      kill-session 后按 missing 重建（只碰 slot7-9，只杀无在途任务的）
 *   ② 发射后阻塞探活：轮询到 pane_current_command 离开 shell 才算 dispatched，
 *      超时记 failed_dispatch(liveness_timeout) + 回滚 claim。本轮返回时 pane 已 busy，
 *      同轮与跨轮（16:38 发 A→16:43 仍判 idle→B 打进 A 的 composer）重复发射一并根治
 */
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

export const WORKER_SLOTS = ['slot7', 'slot8', 'slot9'];
export const MAX_CONCURRENT = 2;
/** shell 即空闲；worker 跑完 claude 退出回 shell = 槽位自动释放 */
const IDLE_COMMANDS = new Set(['zsh', 'bash', 'sh', 'fish']);
const INTERVAL_MS = parseInt(process.env.CECELIA_WORKER_POOL_INTERVAL_MS || String(5 * 60 * 1000), 10);
const HOST_REPO = process.env.CECELIA_HOST_REPO || '/Users/administrator/perfect21/cecelia';
/** 发射后探活：pane 必须在此窗口内离开 shell，否则判发射失败 */
const LIVENESS_TIMEOUT_MS = parseInt(process.env.CECELIA_WORKER_LIVENESS_TIMEOUT_MS || '10000', 10);
const LIVENESS_POLL_MS = parseInt(process.env.CECELIA_WORKER_LIVENESS_POLL_MS || '2000', 10);
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
  // 宿主直跑（测试/本机进程）时不套 ssh。先转义反斜杠再转义引号——只转义引号
  // 会被 \" 序列绕过（CodeQL js/incomplete-sanitization）
  // $ 也必须转义:双引号包裹的 ssh 参数里 $(...)/$VAR 会被本地(容器)shell 先展开——
  // 金丝雀案:$(cat promptFile) 在容器求值(无宿主文件)→ 发射命令落地成 claude-launch.sh ""
  const wrap = (cmd) => (host ? `ssh ${sshOpts} ${host} "${cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"` : cmd);

  const sleep = deps.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));

  // ── 1. 槽位盘点（stdout 判读，exit code 不可信）────────────────────────────
  const probeSlot = (slot) => {
    try {
      // 探针用 list-panes 而非 display-message:真机实证 display-message -p -t
      // <不存在的会话> 返回空串+rc=0(不报错),|| echo MISSING 不触发,空串被判
      // busy → 全槽假忙永不派发(09-06 金丝雀案 busy=3)。list-panes 对不存在
      // 会话真报错。多 pane 时取首行;空串防御性归为 missing。
      const out = String(execFn(wrap(
        `tmux list-panes -t ${slot} -F '#{pane_current_command}' 2>/dev/null || echo MISSING`
      ))).trim().split('\n')[0].trim();
      return (!out || out.includes('MISSING')) ? 'missing' : (IDLE_COMMANDS.has(out) ? 'idle' : 'busy');
    } catch {
      return 'missing'; // tmux server 未起等同全空闲可建
    }
  };
  const slotState = {};
  for (const slot of WORKER_SLOTS) slotState[slot] = probeSlot(slot);

  // ── 1.5 僵尸检测：busy 槽找不到在途任务对应 = 空启动残留 claude ─────────────
  // 不清掉的话:① 白占产能 ② send-keys 会打进残留 claude 的 composer 空转。
  // 保守三重限制:只看 slot7-9、只杀 DB 里无在途任务认领的、查库失败一律不杀。
  const zombies = [];
  const busySlots = WORKER_SLOTS.filter(s => slotState[s] === 'busy');
  if (busySlots.length) {
    let activeSlots = null;
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT split_part(de.reason, ':', 2) AS slot
           FROM dispatch_events de
           JOIN tasks t ON t.id = de.task_id
          WHERE de.event_type = 'dispatched'
            AND de.reason LIKE 'worker_pool:%'
            AND t.claimed_by = 'interactive-dev-skill'
            AND t.status IN ('queued', 'in_progress')`
      );
      activeSlots = new Set((rows || []).map(r => String(r.slot || '').trim()));
    } catch (err) {
      console.warn(`[worker-pool] 僵尸判定查库失败,保守不清理: ${err.message}`);
    }
    if (activeSlots) {
      for (const slot of busySlots) {
        if (activeSlots.has(slot)) continue; // 有在途任务认领 → 真在干活,绝不碰
        try {
          execFn(wrap(`tmux kill-session -t ${slot} 2>/dev/null || true`));
          slotState[slot] = 'missing'; // 按 missing 走 new-session 重建
          zombies.push(slot);
          console.log(`[worker-pool] 清理僵尸槽 slot=${slot}（无在途任务对应）`);
        } catch (err) {
          console.warn(`[worker-pool] 僵尸清理失败 slot=${slot}: ${err.message}`);
        }
      }
    }
  }

  const busy = WORKER_SLOTS.filter(s => slotState[s] === 'busy').length;
  if (busy >= MAX_CONCURRENT) return { skipped: 'concurrency_cap', dispatched: 0, busy, zombies };

  const budget = MAX_CONCURRENT - busy;
  const freeSlots = WORKER_SLOTS.filter(s => slotState[s] !== 'busy');
  const capacity = Math.min(budget, freeSlots.length);
  if (capacity <= 0) return { skipped: 'no_free_slot', dispatched: 0, busy, zombies };

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
  if (!tasks.length) return { skipped: 'queue_empty', dispatched: 0, busy, zombies };

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

      // 发射后阻塞探活：pane 必须真离开 shell 才算发射成功。
      // 不等 = 本轮返回时 pane 还是 zsh，下一轮探测判 idle → 同一个槽被二次发射，
      // 命令打进上一个 claude 的 composer（09-07 16:38→16:43 现场案）。
      const attempts = Math.max(1, Math.ceil(LIVENESS_TIMEOUT_MS / LIVENESS_POLL_MS));
      let alive = false;
      for (let i = 0; i < attempts; i++) {
        if (probeSlot(slot) === 'busy') { alive = true; break; }
        if (i < attempts - 1) await sleep(LIVENESS_POLL_MS);
      }
      if (!alive) {
        throw new Error(`liveness_timeout: pane ${LIVENESS_TIMEOUT_MS}ms 内未离开 shell`);
      }
      slotState[slot] = 'busy'; // 本轮内其他任务不得再瞄这个槽

      await pool.query(
        `INSERT INTO dispatch_events (task_id, event_type, reason) VALUES ($1, $2, $3)`,
        [task.id, 'dispatched', `worker_pool:${slot}`]
      );
      console.log(`[worker-pool] dispatched task=${task.id} slot=${slot}`);
      dispatched++;
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
    // 成败都推进：失败的槽（含探活超时）本轮绝不给下一个任务复用——
    // 旧代码失败时不推进，第二个任务照打同一个槽 = 同轮重复发射
    slotIdx++;
  }
  return { dispatched, busy, zombies };
}
