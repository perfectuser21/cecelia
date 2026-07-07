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
import { execSync } from 'node:child_process';

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
 * deps 全注入（测试 fake）：{pool, spawnFn, sshSpawnFn, loadSkill, ensureWt, resolveAccountFn, tokenFn, now}
 * @returns {Promise<{ok:boolean, mode:string, containerId?:string, error?:string}>}
 */
export async function spawnSkillRelaySession(task, deps = {}) {
  const dbPool = deps.pool || pool;
  const now = deps.now || (() => new Date());
  const initiativeId = task.payload?.initiative_id || task.id; // B51: initiative_id = task.id
  const short = shortId(task.id);
  const isCodex = task.payload?.executor === 'codex';
  const isHeaded = task.payload?.mode === 'headed';

  // claude+headed 防御层（入口层已拦，这里是 spawnSkillRelaySession 内部防御）
  if (isHeaded && task.payload?.executor !== 'codex') {
    return { ok: false, mode: 'skill-relay', error: `executor=${task.payload?.executor} 不支持 headed 模式，仅 codex 支持` };
  }

  // ─── headed 分支：ssh+tmux 路径 ──────────────────────────────────────────
  if (isHeaded) {
    return _spawnHeadedSession(task, { dbPool, now, short, initiativeId, deps });
  }
  // ─── end headed ──────────────────────────────────────────────────────────

  // 去重守卫（P1 bug 39b97ade / 今日两次实证 a3d61486、4cedf175）：
  // Brain 重启后误 requeue 的存量 skill-relay 任务被 dispatcher 重新 claim 并再次调用本函数时，
  // 若旧 relay 容器仍在跑（未被杀），直接堵死双 spawn——命名规约与
  // harness-relay-watchdog.js::resumeStalledRelayRuns 一致（cecelia-relay-<short8>）。
  // fail-open：docker 不可达/命令报错时保守放行 spawn（不能让 docker 抽风挡住正常调度）。
  const execFn = deps.execFn || ((cmd) => execSync(cmd, { encoding: 'utf8', timeout: 10000 }));
  try {
    const running = execFn(`docker ps -q --filter "name=cecelia-relay-${short}"`).trim();
    if (running) {
      console.warn(`[skill-relay][GUARD] live container exists, skip duplicate spawn: task=${task.id} container=${running}`);
      return { ok: false, mode: RELAY_FLAG, deferred: true, reason: 'live_container_guard', containerId: running };
    }
  } catch (err) {
    console.warn(`[skill-relay][GUARD] docker ps 检查失败（保守放行 spawn）: ${err.message}`);
  }

  // B6: codex 容器凭据挂载（demo task a150998c 实证：容器内无任何凭据，
  // codex CLI `401 Unauthorized: Missing bearer` 秒退）。宿主 team2 codex 凭据目录
  // 由 CODEX_RELAY_HOME 指定（docker-compose 注入），挂到容器内 codex 默认读取路径
  // /home/cecelia/.codex。禁止在此写死 /Users 路径（铁律：不写死环境假设值）——
  // 缺配置时 loud 失败，不静默降级成"无凭据容器照样 spawn 再秒退"。
  const codexRelayHome = process.env.CODEX_RELAY_HOME;
  // B6: 已配置但值为空（CODEX_RELAY_HOME=''）→ 显式失败（生产错误配置）。
  // 未配置（undefined）→ 允许继续（extraMounts 为空，凭据挂载跳过），测试注入 spawnFn 覆盖。
  if (isCodex && codexRelayHome !== undefined && !codexRelayHome) {
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
          // 刀3（跨 repo 化）：宿主 worktree 绝对路径。controller 在容器内（cwd=/workspace），
          // Step 5 curl Brain judge API 时 worktree 参数必须传宿主路径——Brain 容器把
          // ~/perfect21/cecelia 与 .claude/worktrees 按宿主同路径挂载，judge 按此读 .brain-result.json。
          HARNESS_WORKTREE_HOST: worktreePath,
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

    // 进程内守门计数
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

// ─── headed 分支实现 ──────────────────────────────────────────────────────────

const HEADED_ORCHESTRATOR_HOST = 'skill-relay-codex-headed';
const HEADED_RELAY_DEADLINE_HOURS = 8;

/**
 * headed 模式：ssh 逃逸宿主，tmux new-session 启动 codex TUI。
 * 不走 docker，不产生 extraMounts，不注入 GITHUB_TOKEN 进 tmux 命令串。
 */
async function _spawnHeadedSession(task, { dbPool, now, short, initiativeId, deps }) {
  // B6 门禁在 headed 分支同样生效（headed 早退绕过了 spawnSkillRelaySession 主体里的
  // CODEX_RELAY_HOME 检查——headed 恒为 codex executor，缺凭据目录同样不能裸 spawn）。
  // 未配置（undefined）→ 放行（本地/测试环境）；显式配置为空字符串 → loud-fail。
  const codexRelayHome = process.env.CODEX_RELAY_HOME;
  if (codexRelayHome !== undefined && !codexRelayHome) {
    console.error('[skill-relay][headed][ALERT] CODEX_RELAY_HOME 未配置，codex executor 无法挂载凭据');
    try {
      await dbPool.query(
        `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
        [task.id]
      );
    } catch (rollbackErr) {
      console.warn(`[skill-relay][headed] task 回滚失败（non-fatal）: ${rollbackErr.message}`);
    }
    return { ok: false, mode: HEADED_ORCHESTRATOR_HOST, error: 'CODEX_RELAY_HOME 未配置' };
  }

  const sprintDir = task.payload?.sprint_dir
    || `sprints/${stampMMDDHHNN(now())}-relay-${short}`;
  const sshHost = task.payload?.ssh_host || process.env.HEADED_SSH_HOST || 'localhost';
  const tmuxSession = `codex-relay-${short}`;
  const promptFile = `/tmp/cecelia-host-prompts/${task.id}.${short}.prompt`;

  const loadSkill = deps.loadSkill
    || (await import('./harness-shared.js')).loadSkillContent;
  const skillContent = loadSkill('harness-controller');

  // worktree（幂等；headed 分支之前漏调，codex 会在宿主 $HOME 裸奔——worktree 路径经
  // compose rw 挂载容器内外一致，宿主可直接 cd 进去）
  const ensureWt = deps.ensureWt
    || (await import('./harness-worktree.js')).ensureHarnessWorktree;
  const worktreePath = await ensureWt({
    taskId: task.id,
    initiativeId,
    baseRepo: task.payload?.base_repo,
  });

  const prompt = [
    `你是 harness-controller session（headed 模式）。按下面 SKILL 指令跑完整条 sprint。`,
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

  const sshSpawnFn = deps.sshSpawnFn;
  if (!sshSpawnFn) {
    // 降级：real ssh 执行（生产路径）。用文件顶部已 import 的 execSync（ESM 下 require 未定义会直接崩）。
    const execFn = deps.execFn
      || ((cmd, opts) => execSync(cmd, { encoding: 'utf8', timeout: 30000, ...opts }));
    // 写 prompt 文件到宿主（0600 权限）——用 ssh stdin 交付，避免 prompt 内联进
    // 双引号/tmux 单引号时被反引号/引号/$ 炸穿（printf + JSON.stringify 内联已实证必炸）。
    try {
      execFn(
        `ssh ${sshHost} "mkdir -p /tmp/cecelia-host-prompts && cat > ${promptFile} && chmod 600 ${promptFile}"`,
        { input: prompt }
      );
    } catch (err) {
      console.error(`[skill-relay][headed] prompt 文件写入失败: ${err.message}`);
      await dbPool.query(
        `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
        [task.id]
      );
      return { ok: false, mode: HEADED_ORCHESTRATOR_HOST, error: `prompt write failed: ${err.message}` };
    }
    // tmux new-session：cd 进 worktree + 注入 CODEX_HOME（不注入=烧宿主默认账号）+
    // codex 位置参数从远端文件展开（--prompt-file 是编造的 flag，codex TUI 只吃 [PROMPT] 位置参数）
    try {
      execFn(
        `ssh ${sshHost} "tmux new-session -d -s ${tmuxSession} 'cd ${worktreePath} && CODEX_HOME=${codexRelayHome || ''} codex \\"\\$(cat ${promptFile})\\"'"`
      );
    } catch (spawnErr) {
      console.error(`[skill-relay][headed][ALERT] ssh tmux spawn failed: ${spawnErr.message}`);
      await dbPool.query(
        `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
        [task.id]
      );
      return { ok: false, mode: HEADED_ORCHESTRATOR_HOST, error: `ssh spawn failed: ${spawnErr.message}` };
    }
  } else {
    // 测试注入路径
    try {
      await sshSpawnFn({
        sshHost,
        tmuxSession,
        promptFile,
        prompt,
      });
    } catch (spawnErr) {
      console.error(`[skill-relay][headed][ALERT] ssh spawn failed: ${spawnErr.message}`);
      try {
        await dbPool.query(
          `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
          [task.id]
        );
      } catch { /* non-fatal */ }
      return { ok: false, mode: HEADED_ORCHESTRATOR_HOST, error: `ssh: ${spawnErr.message}` };
    }
  }

  // initiative_runs 落行（orchestrator_host='skill-relay-codex-headed' 内联，便于测试断言）
  await dbPool.query(
    `INSERT INTO initiative_runs
       (initiative_id, phase, journey_id, orchestrator_version, orchestrator_host, deadline_at)
     VALUES ($1, 'A_planning', $2, 'v2', 'skill-relay-codex-headed', NOW() + INTERVAL '${HEADED_RELAY_DEADLINE_HOURS} hours')`,
    [initiativeId, task.payload?.journey_id || null]
  );

  // tui.log 留痕（在 sprint_dir 目录写入，管道洗敏：不含 token）
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const logDir = sprintDir;
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logLine = `[${now().toISOString()}] headed spawn: task=${task.id} tmux=${tmuxSession} host=${sshHost} prompt=${promptFile}\n`;
    fs.appendFileSync(path.join(logDir, 'tui.log'), logLine, 'utf8');
  } catch (logErr) {
    console.warn(`[skill-relay][headed] tui.log 写入失败（non-fatal）: ${logErr.message}`);
  }

  console.log(`[skill-relay][headed] session spawned: tmux=${tmuxSession} sprint=${sprintDir} host=${sshHost}`);
  return { ok: true, mode: HEADED_ORCHESTRATOR_HOST, tmuxSession, sprintDir, extraMounts: undefined };
}
