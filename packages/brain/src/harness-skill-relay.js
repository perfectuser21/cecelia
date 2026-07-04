/**
 * harness-skill-relay — N3 最小接线（harness-skill-relay initiative，主理人 2026-07-04 拍板）。
 *
 * task.payload.orchestrator==='skill-relay' 的 harness_initiative 任务不走 LangGraph 图，
 * 改为 spawn 一个 claude session 跑 harness-controller skill（SDD 模式单 session 接力）。
 * 双轨：flag 缺省的任务照旧走图，零行为变化。
 *
 * 设计要点（PrepPRD sprints/07041621-harness-skill-relay-wiring/prep-prd.md）：
 * - 复用存量原语：ensureHarnessWorktree / resolveAccount / loadSkillContent / spawnDockerDetached
 * - initiative_runs 落行 phase='A_planning'（现有 watchdog overdue 白名单内）+
 *   orchestrator_version='v2'（migration 312 双轨 flag）+ deadline 6h 兜底
 * - 任务完成态由 controller 末端的 harness-report 走 Brain API 回写；
 *   session 容器自身的 execution-callback 由 v1 链处理（单容器 session 模式下幂等无害，
 *   与 T3 多容器模式不同，不需要 fencing——见 decision「N3 skill-relay 最小接线设计」）
 */
import pool from './db.js';

const RELAY_FLAG = 'skill-relay';
const RELAY_DEADLINE_HOURS = 6;

/** 双轨路由判断：payload.orchestrator==='skill-relay' 才走 relay */
export function isSkillRelayTask(task) {
  return task?.payload?.orchestrator === RELAY_FLAG;
}

function shortId(id) {
  return String(id).replace(/-/g, '').slice(0, 8);
}

/** 上海时区 MMDDHHNN（sprint_dir 缺省生成用；now 注入保持可测确定性） */
function stampMMDDHHNN(now) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

/**
 * spawn 一个 skill-relay controller session。
 * deps 全注入（测试 fake）：{pool, spawnFn, loadSkill, ensureWt, resolveAccountFn, tokenFn, now}
 * @returns {Promise<{ok:boolean, mode:'skill-relay', containerId?:string, error?:string}>}
 */
export async function spawnSkillRelaySession(task, deps = {}) {
  const dbPool = deps.pool || pool;
  const now = deps.now || (() => new Date());
  const initiativeId = task.payload?.initiative_id || task.id; // B51: initiative_id = task.id
  const short = shortId(task.id);

  try {
    // 1. skill 全文（skill 未部署 = 硬失败，不 spawn 半截 session）
    const loadSkill = deps.loadSkill
      || (await import('./harness-shared.js')).loadSkillContent;
    const skillContent = loadSkill('harness-controller');

    // 2. worktree（幂等）
    const ensureWt = deps.ensureWt
      || (await import('./harness-worktree.js')).ensureHarnessWorktree;
    const worktreePath = await ensureWt({
      taskId: task.id,
      initiativeId,
      baseRepo: task.payload?.base_repo,
    });

    // 3. sprint_dir：/dev 交接优先，缺省按 relay 规约生成
    const sprintDir = task.payload?.sprint_dir
      || `sprints/${stampMMDDHHNN(now())}-relay-${short}`;

    // 4. 账号轮换/熔断（原地改 env）
    const acctOpts = { env: {} };
    const resolveAccountFn = deps.resolveAccountFn
      || (await import('./spawn/middleware/account-rotation.js')).resolveAccount;
    try {
      await resolveAccountFn(acctOpts, { taskId: task.id });
    } catch (err) {
      console.warn(`[skill-relay] resolveAccount failed（继续，用默认凭据）: ${err.message}`);
    }

    // 5. github token
    const tokenFn = deps.tokenFn
      || (await import('./harness-utils.js')).resolveGitHubToken;
    const githubToken = await tokenFn();

    // 6. prompt：skill 全文 inline + 上下文头（与图节点的 loadSkillContent 注入模式一致）
    const prompt = [
      `你是 harness-controller session。按下面 SKILL 指令跑完整条 sprint。`,
      ``,
      skillContent,
      ``,
      `---`,
      `## 本次上下文`,
      `HARNESS_TASK_ID=${task.id}`,
      `SPRINT_DIR=${sprintDir}`,
      `BRAIN_URL=http://host.docker.internal:5221`,
      `任务标题：${task.title || ''}`,
    ].join('\n');

    // 7. spawn detached session
    const containerId = `cecelia-relay-${short}-${Math.random().toString(16).slice(2, 10)}`;
    const spawnFn = deps.spawnFn
      || (await import('./spawn/detached.js')).spawnDockerDetached;
    await spawnFn({
      task: { ...task, task_type: 'harness_controller' },
      prompt,
      worktreePath,
      containerId,
      env: {
        ...acctOpts.env,
        CECELIA_TASK_TYPE: 'harness_controller',
        HARNESS_TASK_ID: task.id,
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_SPRINT_DIR: sprintDir,
        CECELIA_JOURNEY_ID: task.payload?.journey_id || '',
        GITHUB_TOKEN: githubToken,
        BRAIN_URL: 'http://host.docker.internal:5221',
      },
    });

    // 8. initiative_runs 落行：A_planning（watchdog overdue 白名单内）+ v2 + 6h deadline
    await dbPool.query(
      `INSERT INTO initiative_runs
         (initiative_id, phase, journey_id, orchestrator_version, orchestrator_host, deadline_at)
       VALUES ($1, 'A_planning', $2, 'v2', $3, NOW() + INTERVAL '${RELAY_DEADLINE_HOURS} hours')`,
      [initiativeId, task.payload?.journey_id || null, 'skill-relay-session']
    );

    console.log(`[skill-relay] session spawned: container=${containerId} sprint=${sprintDir}`);
    return { ok: true, mode: RELAY_FLAG, containerId, sprintDir, worktreePath };
  } catch (err) {
    console.error(`[skill-relay] spawn failed: ${err.message}`);
    return { ok: false, mode: RELAY_FLAG, error: err.message };
  }
}
