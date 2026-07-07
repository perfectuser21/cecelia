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
const CODEX_RELAY_DEADLINE_HOURS = 8; // B5: codex 路径用 8h

// B2: 进程内并发守门（MAX=1）
let _activeCodexRelays = 0;
/** 仅供测试注入（_setActiveCodexRelays(1) 模拟已有活跃 relay）*/
export function _setActiveCodexRelays(n) { _activeCodexRelays = n; }

/**
 * P2-1 review 分级判定（主理人规矩：新功能人审，非新功能 auto merge——risk-based gating）。
 * 显式 payload.review_required 永远赢；fix/chore/修复/bug 类标题或 change_kind∈{fix,small,thicken} → false；
 * 其余（新功能/判定不出）→ true（安全方向：宁可多看一眼）。
 */
export function deriveReviewRequired(task) {
  const explicit = task?.payload?.review_required;
  if (typeof explicit === 'boolean') return explicit;
  const kind = task?.payload?.change_kind;
  if (['fix', 'small', 'thicken'].includes(kind)) return false;
  const title = String(task?.title || '');
  if (/^(fix|hotfix|chore)\b|^(fix|hotfix|chore)\(|修复|\bbug\b/i.test(title)) return false;
  return true;
}

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
  const isCodex = task.payload?.executor === 'codex';

  // B6: codex 容器凭据挂载（demo task a150998c 实证：容器内无任何凭据，
  // codex CLI `401 Unauthorized: Missing bearer` 秒退）。宿主 team2 codex 凭据目录
  // 由 CODEX_RELAY_HOME 指定（docker-compose 注入），挂到容器内 codex 默认读取路径
  // /home/cecelia/.codex。禁止在此写死 /Users 路径（铁律：不写死环境假设值）——
  // 缺配置时 loud 失败，不静默降级成"无凭据容器照样 spawn 再秒退"。
  const codexRelayHome = process.env.CODEX_RELAY_HOME;
  if (isCodex && !codexRelayHome) {
    console.error('[skill-relay][ALERT] CODEX_RELAY_HOME 未配置，codex executor 无法挂载凭据');
    try {
      await dbPool.query(
        `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
        [task.id]
      );
    } catch (rollbackErr) {
      console.warn(`[skill-relay] task 回滚失败（non-fatal）: ${rollbackErr.message}`);
    }
    return { ok: false, mode: RELAY_FLAG, error: 'CODEX_RELAY_HOME 未配置' };
  }

  // ─── B2+B3: codex 路径守门（在 try 外，defer 不抛异常）─────────────────
  if (isCodex) {
    // B2 层 1：进程内守门
    if (_activeCodexRelays > 0) {
      return { ok: false, deferred: true, reason: 'codex_concurrent_limit' };
    }

    // B2 层 2：DB 守门
    try {
      const concQ = await dbPool.query(
        `SELECT COUNT(*) FROM initiative_runs
          WHERE orchestrator_host = 'skill-relay-codex'
            AND phase NOT IN ('done','failed')
            AND deadline_at > NOW()
            AND initiative_id != $1`,
        [initiativeId]
      );
      const count = parseInt(concQ.rows[0]?.count ?? '0', 10);
      if (count > 0) {
        return { ok: false, deferred: true, reason: 'codex_concurrent_limit' };
      }
    } catch (err) {
      console.warn(`[skill-relay] codex DB 守门查询失败（保守通过）: ${err.message}`);
    }

    // B3: 额度软闸（team2 quota < 30%）
    if (typeof deps.quotaFn === 'function') {
      try {
        const quota = await deps.quotaFn();
        if (quota?.remaining_pct !== undefined && quota.remaining_pct < 0.30) {
          return { ok: false, deferred: true, reason: 'codex_quota_low' };
        }
      } catch (err) {
        console.warn(`[skill-relay] codex quota 软闸查询失败（保守通过）: ${err.message}`);
      }
    }
  }
  // ─── end B2+B3 ────────────────────────────────────────────────────────

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

    // 3.5 P2-1 review 分级：点火时判定并持久化（controller 经 GET task 读 payload.review_required）
    const reviewRequired = deriveReviewRequired(task);
    try {
      await dbPool.query(
        `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('review_required', $2::boolean)
          WHERE id = $1`,
        [task.id, reviewRequired]
      );
    } catch (err) {
      console.warn(`[skill-relay] review_required 持久化失败（不阻塞，controller 以 prompt 头为准）: ${err.message}`);
    }

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
      || (await import('./harness-credentials.js')).resolveGitHubToken;
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
      `REVIEW_REQUIRED=${reviewRequired}`,
      `任务标题：${task.title || ''}`,
    ].join('\n');

    // 7. spawn detached session
    // B5: codex 路径容器名用 -cx 后缀
    const containerId = isCodex
      ? `cecelia-relay-${short}-cx`
      : `cecelia-relay-${short}-${Math.random().toString(16).slice(2, 10)}`;
    const spawnFn = deps.spawnFn
      || (await import('./spawn/detached.js')).spawnDockerDetached;

    // B4: spawn 失败回滚（在 spawn 前不落 initiative_runs 行）
    try {
      await spawnFn({
        containerId,
        task: { ...task, task_type: 'harness_controller' },
        prompt,
        worktreePath,
        extraMounts: isCodex ? [`${codexRelayHome}:/home/cecelia/.codex:rw`] : undefined,
        env: {
          ...acctOpts.env,
          CECELIA_TASK_TYPE: 'harness_controller',
          CECELIA_EXECUTOR: isCodex ? 'codex' : 'claude',
          // v1.0.1：HARNESS_NODE 使 entrypoint tee stdout（过程观测）+ 结束 POST callback；
          // relay 容器无 thread_lookup，callback 由 harness-callback 路由 200 ack（免 5×404 重试尾巴）
          HARNESS_NODE: 'controller',
          HARNESS_CALLBACK_URL: `http://host.docker.internal:5221/api/brain/harness/callback/${containerId}`,
          HARNESS_TASK_ID: task.id,
          HARNESS_INITIATIVE_ID: initiativeId,
          HARNESS_SPRINT_DIR: sprintDir,
          CECELIA_JOURNEY_ID: task.payload?.journey_id || '',
          GITHUB_TOKEN: githubToken,
          BRAIN_URL: 'http://host.docker.internal:5221',
        },
      });
    } catch (spawnErr) {
      // B4: spawn 失败 → 回滚 task，不落 initiative_runs
      console.error(`[skill-relay][ALERT] codex spawn failed: ${spawnErr.message}`);
      try {
        await dbPool.query(
          `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
          [task.id]
        );
      } catch (rollbackErr) {
        console.warn(`[skill-relay] task 回滚失败（non-fatal）: ${rollbackErr.message}`);
      }
      return { ok: false, mode: RELAY_FLAG, error: spawnErr.message };
    }

    // 8. initiative_runs 落行：A_planning + v2 + deadline（codex=8h, claude=6h）+ orchestrator_host 区分
    const deadlineHours = isCodex ? CODEX_RELAY_DEADLINE_HOURS : RELAY_DEADLINE_HOURS;
    const orchestratorHost = isCodex ? 'skill-relay-codex' : 'skill-relay-session';
    await dbPool.query(
      `INSERT INTO initiative_runs
         (initiative_id, phase, journey_id, orchestrator_version, orchestrator_host, deadline_at)
       VALUES ($1, 'A_planning', $2, 'v2', $3, NOW() + INTERVAL '${deadlineHours} hours')`,
      [initiativeId, task.payload?.journey_id || null, orchestratorHost]
    );

    if (isCodex) _activeCodexRelays++;

    console.log(`[skill-relay] session spawned: container=${containerId} sprint=${sprintDir} executor=${isCodex ? 'codex' : 'claude'}`);
    return { ok: true, mode: RELAY_FLAG, containerId, sprintDir, worktreePath };
  } catch (err) {
    console.error(`[skill-relay][ALERT] spawn failed: ${err.message}`);
    // B4: 通用回滚（非 spawn 内部错误也回滚）
    try {
      await dbPool.query(
        `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
        [task.id]
      );
    } catch { /* non-fatal */ }
    return { ok: false, mode: RELAY_FLAG, error: err.message };
  }
}
