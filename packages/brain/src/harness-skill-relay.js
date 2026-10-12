import { hostname } from 'node:os';
import { withLegacyRelayExecution } from './execution-directory/legacy-relay.js';
import { withLegacyExecution,legacyExecutorEntries } from './execution-directory/legacy-executor.js';
import { assertExternalExecutionAllowed } from './runtime-safety.js';
import { CLAUDE_CHANNEL_RETIRED_CODE, isClaudeExecutor } from './lib/claude-channel.js';
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
import { findActiveRunBlockingSpawn } from './lib/harness-run-guard.js';
import { buildChainPromptSafe } from './handoff.js';
import { normalizeChangeKind } from './impact-contract/change-kind.js';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RELAY_FLAG = 'skill-relay';
/** kernel-v1 运行时退役后的拒绝码（A5，决策 b4adf807）。 */
export const KERNEL_RUNTIME_RETIRED_CODE = 'kernel_runtime_retired';
const RELAY_DEADLINE_HOURS = 6;
const CODEX_RELAY_DEADLINE_HOURS = 8; // B5: codex 路径用 8h
const GROK_RELAY_DEADLINE_HOURS = 8;  // grok 路径对齐 codex 等级

// B2: 进程内并发守门（MAX=1）
let _activeCodexRelays = 0;
/** 仅供测试注入（_setActiveCodexRelays(1) 模拟已有活跃 relay）*/
export function _setActiveCodexRelays(n) { _activeCodexRelays = n; }

/**
 * detectQuotaWall — 检测 grok 输出是否命中额度/速率撞墙。
 * 匹配 6 个 pattern（大小写不敏感）：
 *   out of credits / rate limit / 429 / quota exceeded / quota reached / usage limit
 * @param {string} output — spawn 错误信息或容器 stdout
 * @returns {boolean}
 */
export function detectQuotaWall(output) {
  const text = String(output || '').toLowerCase();
  return (
    text.includes('out of credits') ||
    text.includes('rate limit') ||
    text.includes('429') ||
    text.includes('quota exceeded') ||
    text.includes('quota reached') ||
    text.includes('usage limit')
  );
}

/**
 * P2-1 review 分级判定（主理人规矩：新功能人审，非新功能 auto merge——risk-based gating）。
 * 显式 payload.review_required 永远赢；fix/chore/修复/bug 类标题或
 * change_kind∈{bugfix,parameter_only}（规范值）或旧值{fix,small,thicken}（由 normalizeChangeKind 归一）→ false；
 * 其余（新功能/判定不出）→ true（安全方向：宁可多看一眼）。
 *
 * change_kind 独立于 gear：本函数只读 change_kind，不读 gear，两者严格分离。
 */
export function deriveReviewRequired(task) {
  const explicit = task?.payload?.review_required;
  if (typeof explicit === 'boolean') return explicit;
  const rawKind = task?.payload?.change_kind;
  // 旧值 {fix,small,thicken} 直接走 no-review 路径（thicken 归一后为 capability_change 不在规范白名单，
  // 但语义上"加厚不算新面"，需在归一化前单独处理）
  if (['fix', 'small', 'thicken'].includes(rawKind)) return false;
  // 归一化旧值，忽略非法值（非法值视为"不确定" → 安全方向返回 true）
  let kind = null;
  try {
    kind = normalizeChangeKind(rawKind);
  } catch {
    // 非法 change_kind 不影响判定，视为未知，走 title 检测
  }
  // 规范值：bugfix/parameter_only → 不需要人审
  if (['bugfix', 'parameter_only'].includes(kind)) return false;
  const title = String(task?.title || '');
  if (/^(fix|hotfix|chore)\b|^(fix|hotfix|chore)\(|修复|\bbug\b/i.test(title)) return false;
  return true;
}

/**
 * harness gear 档位（07-17 一体化设计决策1）：default=现行为不动 / hotfix=免 planner/GAN 直通
 * / segmented=骨架全红棋盘 + N 段串行点绿。
 */
export const GEAR_VALUES = ['default', 'hotfix', 'segmented'];

/**
 * deriveGear(task) — 纯函数，缺省/undefined/null → 'default'；∈GEAR_VALUES → 原值透传；
 * 其余非法值 → throw（executor 层 catch 后同 missing_orchestrator_flag 形态标 terminal failed）。
 * segmented 的段循环在 controller session 内完成，不新增 Brain 任务，不影响 dispatcher 并发模型
 *（见 dispatcher.js:54-69 全局 harness_initiative 并发上限按 task 数计数，与 gear 值无关）。
 */
export function deriveGear(task) {
  const gear = task?.payload?.gear;
  if (gear === undefined || gear === null) return 'default';
  if (GEAR_VALUES.includes(gear)) return gear;
  throw new Error(`invalid_gear: ${gear}`);
}

/** 双轨路由判断：payload.orchestrator==='skill-relay' 才走 relay */
export function isSkillRelayTask(task) {
  return task?.payload?.orchestrator === RELAY_FLAG;
}

/**
 * controllerSkillFor — 按 task_type 选 relay session 要跑的 controller skill（GP2/T2）。
 * capability-controller（原 golden-path-controller，决策 a340f100 追加口径改名）本体在
 * skills repo T3 落地；未部署时 loadSkillContent 会带
 * skill 名 throw（harness-shared.js:62），spawn 硬失败不起半截 session——即"明确报错"。
 */
export function controllerSkillFor(taskType) {
  return taskType === 'golden_path_proposal' ? 'capability-controller' : 'harness-controller';
}

export function shortId(id) {
  return String(id).replace(/-/g, '').slice(0, 8);
}

/** base_repo（URL 或 owner/name）→ worker repoAllowlist 键；解析不出回落 cecelia。 */
function parseBaseRepoOrDefault(baseRepo) {
  if (typeof baseRepo === 'string') {
    const m = baseRepo.match(/([\w-]+\/[\w.-]+?)(?:\.git)?$/);
    if (m) return m[1];
  }
  return 'perfectuser21/cecelia';
}

/** 上海时区 MMDDHHNN（sprint_dir 缺省生成用；now 注入保持可测确定性） */
export function stampMMDDHHNN(now) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

/**
 * codex 容器凭据挂载改成"先快照再挂"（2026-07-21，project_codex_token_consolidation_us 记忆）。
 *
 * 背景：直接把 CODEX_RELAY_HOME（宿主真实持久目录，默认 ~/.codex-team2）以 :rw 挂进容器，
 * 容器内 codex 一旦自己判断 access_token 快过期就会刷新写回——这个写会通过 bind mount
 * 穿透落回宿主真实 auth.json，跟宿主自己的 refresh-codex-tokens-us.sh cron 竞态（同 Claude
 * account1 掉线的"cron刷新+并发进程多写者竞态清空token"病根）。
 *
 * 改成：先把真实目录里的 auth.json 复制到一次性临时目录，挂临时目录而不是真实目录——
 * 容器内不管怎么写，都碰不到宿主真实持久文件。真实凭据目录下找不到 auth.json 视为
 * 配置错误，loud fail（不静默退回直挂真实目录）。
 *
 * 2026-07-22：headed 分支（SSH+tmux 直接跑，不走 docker）复用本函数，同一病根——
 * headed session 里 codex 自己刷新一样会写回真文件，跟 refresh-codex-tokens-us.sh
 * 的 cron 竞态。headed 分支还依赖 config.toml 做"雷9 trust 预写"（避免 codex TUI
 * 每次进新 worktree 都卡交互确认），所以顺带把 config.toml 也复制进快照——
 * 缺失不算错误（本来就允许账号目录还没有 config.toml，trust preseed 自己会优雅
 * 跳过），只有 auth.json 缺失才是真正的配置错误。
 *
 * @param {string} codexRelayHome 宿主真实凭据目录（CODEX_RELAY_HOME）
 * @param {string} taskId 用于临时目录命名，保证唯一性
 * @returns {string} 一次性临时目录路径
 */
export function snapshotCodexRelayHome(codexRelayHome, taskId) {
  const srcAuth = join(codexRelayHome, 'auth.json');
  if (!existsSync(srcAuth)) {
    throw new Error(`CODEX_RELAY_HOME 下找不到 auth.json: ${srcAuth}`);
  }
  const dir = join(tmpdir(), `codex-relay-cred-${taskId}-${Date.now()}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  copyFileSync(srcAuth, join(dir, 'auth.json'));
  const srcConfig = join(codexRelayHome, 'config.toml');
  if (existsSync(srcConfig)) {
    copyFileSync(srcConfig, join(dir, 'config.toml'));
  }
  return dir;
}

/**
 * spawn 一个 skill-relay controller session。
 * deps 全注入（测试 fake）：{pool, spawnFn, sshSpawnFn, loadSkill, ensureWt, resolveAccountFn, tokenFn, now, snapshotCodexHome}
 * @returns {Promise<{ok:boolean, mode:string, containerId?:string, error?:string}>}
 */
/**
 * 派发 prompt 组装（接力棒 2026-09-23 抽出为纯函数，好在 Golden Path 边上直接断言）。
 * kind='controller'（headless harness-controller）/ 'headed'（Kernel Harness 2.0 headed）。
 * chainContext 来自 handoff.buildChainPromptSafe：任务在链上 → 注入根目标 + 最近 handoff；
 * 孤立任务 → 空串，prompt 与之前逐字一致（不给无链任务加噪音）。
 */
export function buildRelayPrompt({ kind, skillContent, task, sprintDir, brainUrl, reviewRequired, gear, chainContext = '' }) {
  const head = kind === 'headed'
    ? '你是 Kernel Harness 2.0 headed session。按下面 SKILL 指令跑完整条 sprint。'
    : '你是 harness-controller session。按下面 SKILL 指令跑完整条 sprint。';
  const lines = [
    head,
    '',
    skillContent,
    '',
    '---',
    '## 本次上下文',
    `HARNESS_TASK_ID=${task.id}`,
    `SPRINT_DIR=${sprintDir}`,
    `BRAIN_URL=${brainUrl}`,
  ];
  if (kind !== 'headed') {
    lines.push(`REVIEW_REQUIRED=${reviewRequired}`, `HARNESS_GEAR=${gear}`);
  }
  lines.push(`任务标题：${task.title || ''}`);
  if (chainContext) lines.push(chainContext);
  return lines.join('\n');
}

export async function spawnSkillRelaySession(task, deps = {}) {
  assertExternalExecutionAllowed();
  // preview Brain 隔离闸（2026-08-05 preview-4643 事故）：预览 Brain 由生产快照
  // 整库克隆而来且作为生产 Brain 子进程启动，继承生产 env（同一 fleet bridge
  // token、callback 指回生产 Brain）。startup-sync 会把克隆的 in_progress 任务
  // 当孤儿重点火，spawn 出的 orchestrator 与生产 Brain 争抢同一 fleet-worker/
  // 工作区/run。这里是所有 harness 派发路径（kernel/headed/headless/xian）的
  // 唯一咽喉——预览环境一律拒绝，任何调用方（startup-sync/dispatcher/API）都拦。
  const previewFlag = (deps.env ?? process.env).BRAIN_PREVIEW;
  if (previewFlag === '1' || previewFlag === 'true') {
    console.warn(`[skill-relay][preview-guard] BRAIN_PREVIEW=${previewFlag} — refusing harness spawn task=${task?.id}`);
    return { ok: false, mode: RELAY_FLAG, error: 'preview_brain_harness_spawn_forbidden' };
  }
  // kernel-v1 运行时已退役（决策 b4adf807 先删后补，A5）：Brain 侧 kernel 启动 / 远程桥 / 有头 kernel
  // 代码已删除，存量 payload.harness_runtime='kernel-v1' 的单派到这里直接拒（不建 run、不碰 worktree）。
  // 无头编码改走 coding_workflow runner；有头 /dev 账本行带 headed_manual 不进 tick。
  if (task?.payload?.harness_runtime === 'kernel-v1') {
    console.warn(`[skill-relay][kernel-retired] task=${task?.id} harness_runtime=kernel-v1 → ${KERNEL_RUNTIME_RETIRED_CODE}`);
    return { ok: false, mode: RELAY_FLAG, error: KERNEL_RUNTIME_RETIRED_CODE };
  }
  // 本机执行闸（铁律 96054a8b：us-vps 上的 Brain 只当调度器）：CECELIA_LOCAL_EXECUTION_ENABLED='false'
  // 时拒绝本机起 relay（headed tmux / headless docker），错误码 local_execution_disabled_on_scheduler。
  // 拦在所有派发路径的唯一咽喉（与 preview-guard 同位），拒绝时不建 run、不碰 worktree。
  // 缺省或 'true' 一律放行。
  const localExecutionDisabled =
    (deps.env ?? process.env).CECELIA_LOCAL_EXECUTION_ENABLED === 'false';
  const dbPool = deps.pool || pool;
  const now = deps.now || (() => new Date());
  const initiativeId = task.payload?.initiative_id || task.id; // B51: initiative_id = task.id
  const short = shortId(task.id);
  const isCodex = task.payload?.executor === 'codex';
  const isGrok = task.payload?.executor === 'grok';
  const isHeaded = task.payload?.mode === 'headed';

  // 本机执行闸先于 Claude 退役检查（任务 76a160b3），错误码不变。
  if (localExecutionDisabled) {
    console.warn(`[skill-relay][local-exec-guard] CECELIA_LOCAL_EXECUTION_ENABLED=false — refusing local harness spawn task=${task?.id}（执行须下放 Mac worker，见决策 96054a8b）`);
    return { ok: false, mode: RELAY_FLAG, error: 'local_execution_disabled_on_scheduler' };
  }

  // Claude Code 无头通道已退役（任务 76a160b3，决策 067867c8）：显式 executor=claude 一律拒绝；
  // 无头路径缺省执行体即 claude，同样拒绝。不建 run、不碰 worktree、不起容器/tmux。
  // task.location='xian' 走西安 codex bridge（从不拉起 claude），缺省执行体不拦。
  const relayExecutor = task.payload?.executor;
  if (relayExecutor === 'claude'
    || (!isHeaded && task.location !== 'xian'
      && isClaudeExecutor(relayExecutor))) {
    console.warn(`[skill-relay][claude-retired] task=${task?.id} executor=${relayExecutor ?? 'claude(default)'} → ${CLAUDE_CHANNEL_RETIRED_CODE}`);
    return { ok: false, mode: RELAY_FLAG, error: CLAUDE_CHANNEL_RETIRED_CODE };
  }

  // INV-8: unsupported executor loud-fail（三处文件 —— harness-skill-relay.js 这处）
  // 白名单：claude / codex / grok / undefined（缺省 claude）；其余显式 loud-fail。
  const executorValue = task.payload?.executor;
  const SUPPORTED_EXECUTORS = ['claude', 'codex', 'grok', undefined, null];
  if (!SUPPORTED_EXECUTORS.includes(executorValue)) {
    const errMsg = `unsupported executor: ${executorValue}`;
    console.error(`[skill-relay][ALERT] ${errMsg}`);
    try {
      await dbPool.query(
        `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
        [task.id]
      );
    } catch { /* non-fatal */ }
    return { ok: false, mode: RELAY_FLAG, error: errMsg };
  }

  // ─── headed 分支：ssh+tmux 路径 ──────────────────────────────────────────
  if (isHeaded) {
    return _spawnHeadedSession(task, { dbPool, now, short, initiativeId, deps });
    // innerCmd 两分支（INV-1 + FR-R3/R4，isGrokHeaded 决策在函数内；claude 分支随通道退役删除）：
    //   isGrokHeaded   → grok-launch.sh（FR-R4 新增 GP3 路径）
    //   default(codex) → 直接调 codex TUI（INV-11 快照 CODEX_HOME，不走 launcher 脚本）
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

  // DB 层幂等防重：initiative_runs 有非终态行 → 拒绝二次 spawn（task 8419142d）
  // 判据必须与 orphan-guard 收割时的清场判据同源（lib/harness-run-guard.js）——
  // 两边分叉正是 2026-08-07 三条 harness_initiative 全灭的死锁根因：
  // 收割器只把 task 打回 queued 不动 run，这把守卫就一路拒到 requeue 超限。
  // fail-open 由 findActiveRunBlockingSpawn 内部兜（DB 抽风不挡正常调度）。
  const blockingRun = await findActiveRunBlockingSpawn(dbPool, task.id);
  if (blockingRun) {
    console.warn(`[dispatcher][spawn-guard] active_run_guard: task=${task.id} initiative_run=${blockingRun.id} — refusing duplicate spawn`);
    return { ok: false, mode: RELAY_FLAG, deferred: true, reason: 'active_run_guard', containerId: blockingRun.id };
  }

  // ─── xian 分支：task.location='xian' → bridge 派发 ─────────────────────────
  const targetLocation = task.location ?? null;
  if (targetLocation === 'xian') {
    return _spawnXianBridgeSession(task, { dbPool, now, short, initiativeId, deps });
  }
  // ─── end xian ────────────────────────────────────────────────────────────────

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

  // 2026-07-21：不直接挂真实 CODEX_RELAY_HOME，先快照到一次性临时目录再挂
  // （见 snapshotCodexRelayHome 顶部注释——直挂会跟宿主 cron 刷新竞态）。
  // 快照失败（真实目录下没有 auth.json，配置错误）同样 loud-fail + task 回滚。
  let codexRelayCredDir;
  if (isCodex && codexRelayHome) {
    const snapshotFn = deps.snapshotCodexHome || snapshotCodexRelayHome;
    try {
      codexRelayCredDir = snapshotFn(codexRelayHome, task.id);
    } catch (snapshotErr) {
      console.error(`[skill-relay][ALERT] codex 凭据快照失败: ${snapshotErr.message}`);
      try {
        await dbPool.query(
          `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
          [task.id]
        );
      } catch (rollbackErr) {
        console.warn(`[skill-relay] task 回滚失败（non-fatal）: ${rollbackErr.message}`);
      }
      return { ok: false, mode: RELAY_FLAG, error: `codex 凭据快照失败: ${snapshotErr.message}` };
    }
  }

  // ─── grok 凭据门禁：GROK_RELAY_HOME='' → loud-fail + task 回滚 ─────────────
  // 对齐 codex 的 CODEX_RELAY_HOME 设计（B6）：
  // - 已配置但值为空（GROK_RELAY_HOME=''）→ 显式失败（生产错误配置）。
  // - 未配置（undefined）→ 允许继续（extraMounts 为空，凭据挂载跳过），测试注入 spawnFn 覆盖。
  const grokRelayHome = process.env.GROK_RELAY_HOME;
  if (isGrok && grokRelayHome !== undefined && !grokRelayHome) {
    console.error('[skill-relay][ALERT] GROK_RELAY_HOME 未配置，grok executor 无法挂载凭据');
    try {
      await dbPool.query(
        `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
        [task.id]
      );
    } catch (rollbackErr) {
      console.warn(`[skill-relay] task 回滚失败（non-fatal）: ${rollbackErr.message}`);
    }
    return { ok: false, mode: RELAY_FLAG, error: 'GROK_RELAY_HOME 未配置' };
  }
  // ─── end grok 凭据门禁 ────────────────────────────────────────────────────

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
    const skillContent = loadSkill(controllerSkillFor(task.task_type));

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

    // 3.55 harness gear 档位（决策1）：executor 层已对非法值硬校验 terminal failed（本函数
    // 直调时非法值仍会 throw，走既有通用回滚 catch——见函数尾部）。
    const gear = deriveGear(task);
    try {
      await dbPool.query(
        `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('review_required', $2::boolean)
          WHERE id = $1`,
        [task.id, reviewRequired]
      );
    } catch (err) {
      console.warn(`[skill-relay] review_required 持久化失败（不阻塞，controller 以 prompt 头为准）: ${err.message}`);
    }

    // issue 45dd6925：缺省生成的 sprint_dir 必须回写 payload，否则重派换新目录（断点恢复产物路径漂移）
    if (!task.payload?.sprint_dir) {
      try {
        await dbPool.query(
          `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('sprint_dir', $2::text)
            WHERE id = $1`,
          [task.id, sprintDir]
        );
      } catch (err) {
        console.warn(`[skill-relay] sprint_dir 持久化失败（不阻塞，task=${task.id}）: ${err.message}`);
      }
    }

    // 4. 账号轮换/熔断（原地改 env）
    const acctOpts = { env: {} };
    const resolveAccountFn = deps.resolveAccountFn
      || (await import('./spawn/middleware/account-rotation.js')).resolveAccount;
    try {
      await resolveAccountFn(acctOpts, { taskId: task.id });
    } catch (err) {
      console.warn(`[skill-relay] resolveAccount failed: ${err.message}`);
    }

    // claude 执行体无可用账号 → defer 不裸 spawn（issue 5167ef48）：
    // 全号熔断/打满时 account-rotation 静默返回（env 不写），旧行为继续 spawn 无凭据
    // 容器 → "Not logged in" exit(1) 三连 → orphan-guard 终态（143f66e1 事故）。
    // defer 让任务留在 queued，账号自愈（usage 实测 200 清熔断）后下一 tick 自然续派。
    if (!isCodex && !isGrok && !acctOpts.env.CECELIA_CREDENTIALS) {
      console.warn(`[skill-relay] claude 无可用账号（全号熔断/打满）→ defer task=${task.id}`);
      return { ok: false, deferred: true, reason: 'no_available_claude_account' };
    }

    // 在凭据签发和工作区启动之外先核绑定，最终 doSpawn 仍在同机锁内复核。
    await (deps.authorizeLegacyRelay??withLegacyRelayExecution)({pool:dbPool,location:hostname(),provider:isCodex?'codex':isGrok?'grok':'claude',
      credentialIdentity:isCodex?codexRelayHome:isGrok?grokRelayHome:acctOpts.env.CECELIA_CREDENTIALS,
      repo:task.payload?.repo??parseBaseRepoOrDefault(task.payload?.base_repo)},()=>{});

    // 5. github token
    const tokenFn = deps.tokenFn
      || (await import('./harness-credentials.js')).resolveGitHubToken;
    const githubToken = await tokenFn();

    // 6. prompt：skill 全文 inline + 上下文头（与图节点的 loadSkillContent 注入模式一致）
    // 接力棒：沿 parent_task_id 注入项目根目标 + 最近 3 份 handoff（失败吞成空串不挡派发）
    const chainContext = await buildChainPromptSafe({ pool }, task.id);
    const prompt = buildRelayPrompt({
      kind: 'controller', skillContent, task, sprintDir,
      brainUrl: 'http://host.docker.internal:5221', reviewRequired, gear, chainContext,
    });

    // 7. spawn detached session
    // B5: codex 路径容器名用 -cx 后缀；grok 路径用 -gk 后缀（对齐命名规约）
    const containerId = isCodex
      ? `cecelia-relay-${short}-cx`
      : isGrok
        ? `cecelia-relay-${short}-gk`
        : `cecelia-relay-${short}-${Math.random().toString(16).slice(2, 10)}`;
    const spawnFn = deps.spawnFn
      || (await import('./spawn/detached.js')).spawnDockerDetached;

    // 刀A7：OOM 升档内存覆盖（opts.memoryTier='oom_upgrade' 或 opts.env.HARNESS_RELAY_MEMORY_OVERRIDE）
    const memoryOverride = deps.memoryOverride
      || process.env.HARNESS_RELAY_MEMORY_OVERRIDE
      || null;
    const oomEnvOverride = deps.env?.HARNESS_RELAY_MEMORY_OVERRIDE
      || null;
    const effectiveMemoryOverride = memoryOverride || oomEnvOverride || null;

    // grok extraMounts：宿主 GROK_RELAY_HOME 挂到容器内 /home/cecelia/.grok
    const grokExtraMounts = isGrok && grokRelayHome
      ? [`${grokRelayHome}:/home/cecelia/.grok:rw`]
      : undefined;

    // 决定 CECELIA_EXECUTOR 值
    const effectiveExecutor = isCodex ? 'codex' : isGrok ? 'grok' : 'claude';

    // B4: spawn 失败回滚（在 spawn 前不落 initiative_runs 行）
    const doSpawn = async () => {
      const spawnExecutor = effectiveExecutor;
      const spawnExtraMounts = isCodex
        ? [`${codexRelayCredDir}:/home/cecelia/.codex:rw`]
        : (spawnExecutor === 'grok' ? grokExtraMounts : undefined);
      await (deps.authorizeLegacyRelay??withLegacyRelayExecution)({pool:dbPool,location:hostname(),provider:spawnExecutor,
        credentialIdentity:isCodex?codexRelayHome:(spawnExecutor==='grok'?grokRelayHome:acctOpts.env.CECELIA_CREDENTIALS),
        repo:task.payload?.repo??parseBaseRepoOrDefault(task.payload?.base_repo)},()=>spawnFn({
        containerId,
        task: { ...task, task_type: 'harness_controller' },
        prompt,
        worktreePath,
        extraMounts: spawnExtraMounts,
        ...(effectiveMemoryOverride ? { memoryOverride: effectiveMemoryOverride } : {}),
        env: {
          ...acctOpts.env,
          CECELIA_TASK_TYPE: 'harness_controller',
          CECELIA_EXECUTOR: spawnExecutor,
          // v1.0.1：HARNESS_NODE 使 entrypoint tee stdout（过程观测）+ 结束 POST callback；
          // relay 容器无 thread_lookup，callback 由 harness-callback 路由 200 ack（免 5×404 重试尾巴）
          HARNESS_NODE: 'controller',
          HARNESS_CALLBACK_URL: `http://host.docker.internal:5221/api/brain/harness/callback/${containerId}`,
          HARNESS_TASK_ID: task.id,
          HARNESS_INITIATIVE_ID: initiativeId,
          HARNESS_SPRINT_DIR: sprintDir,
          HARNESS_GEAR: gear,
          // 刀3（跨 repo 化）：宿主 worktree 绝对路径。controller 在容器内（cwd=/workspace），
          // Step 5 curl Brain judge API 时 worktree 参数必须传宿主路径——Brain 容器把
          // ~/perfect21/cecelia 与 .claude/worktrees 按宿主同路径挂载，judge 按此读 .brain-result.json。
          HARNESS_WORKTREE_HOST: worktreePath,
          CECELIA_JOURNEY_ID: task.payload?.journey_id || '',
          CECELIA_ABILITY_ID: task.ability_id || task.payload?.ability_id || '',
          GITHUB_TOKEN: githubToken,
          BRAIN_URL: 'http://host.docker.internal:5221',
        },
      }));
    };

    try {
      await doSpawn();
    } catch (spawnErr) {
      // grok 额度撞墙曾降级 claude 重试一次；Claude 通道退役后不再降级，按普通 spawn 失败回滚
      // B4: spawn 失败 → 回滚 task，不落 initiative_runs
      console.error(`[skill-relay][ALERT] spawn failed: ${spawnErr.message}`);
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

    // 8. initiative_runs 落行：A_planning + v2 + deadline（codex/grok=8h, claude=6h）+ orchestrator_host 区分
    // orchestrator_host 内联在 SQL 模板（对齐 headed 路径，便于测试断言且无注入面——值来自固定常量）
    const deadlineHours = isCodex
      ? CODEX_RELAY_DEADLINE_HOURS
      : isGrok
        ? GROK_RELAY_DEADLINE_HOURS
        : RELAY_DEADLINE_HOURS;
    const orchestratorHost = isCodex
      ? 'skill-relay-codex'
      : isGrok
        ? 'skill-relay-grok'
        : 'skill-relay-session';
    const abilityId = task.ability_id || task.payload?.ability_id || null;
    await dbPool.query(
      `INSERT INTO initiative_runs
         (initiative_id, phase, journey_id, orchestrator_version, orchestrator_host,
          deadline_at, ability_id, current_task_id, created_source)
       VALUES ($1, 'A_planning', $2, 'v1', '${orchestratorHost}',
               NOW() + INTERVAL '${deadlineHours} hours', $3, $4, 'legacy_relay')`,
      [initiativeId, task.payload?.journey_id || null, abilityId, task.id]
    );

    // 进程内守门计数
    if (isCodex) _activeCodexRelays++;

    console.log(`[skill-relay] session spawned: container=${containerId} sprint=${sprintDir} executor=${effectiveExecutor}`);
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

// ─── xian bridge 分支实现 ────────────────────────────────────────────────────

const XIAN_RELAY_DEADLINE_HOURS = 8;
const XIAN_BRAIN_URL = 'http://100.86.57.69:5221';

/**
 * _spawnXianBridgeSession — xian-M4 bridge 派发路径。
 * task.location='xian' 时，POST 到 xian codex bridge，非阻塞派发 harness 任务。
 * INV-1: 白名单门禁（payload.allow_xian=true 才放行）
 * INV-2: spawn 失败 loud 失败 + task 回滚
 * INV-4: 路由完全由 task.location DB 字段驱动，不依赖 env 开关
 */
async function _spawnXianBridgeSession(task, { dbPool, now, short, initiativeId, deps }) {
  // 1. 白名单门禁（INV-1）：allow_xian !== true → loud 失败
  if (task.payload?.allow_xian !== true) {
    console.error(`[skill-relay][xian][ALERT] task.location=xian 但 allow_xian 未授权: task=${task.id}`);
    try {
      await dbPool.query(
        `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
        [task.id]
      );
    } catch (rollbackErr) {
      console.warn(`[skill-relay][xian] task 回滚失败（non-fatal）: ${rollbackErr.message}`);
    }
    return { ok: false, mode: RELAY_FLAG, error: 'allow_xian 白名单未授权' };
  }

  const sprintDir = task.payload?.sprint_dir
    || `sprints/${stampMMDDHHNN(now())}-relay-xian-${short}`;
  const containerId = `cecelia-relay-xian-${short}-${Math.random().toString(16).slice(2, 6)}`;
  const xianBrainUrl = process.env.XIAN_BRAIN_URL || XIAN_BRAIN_URL;
  const bridgeBaseUrl = legacyExecutorEntries().find(e=>e.machineId==='xian-mac-m4'&&e.executor==='codex')?.url;

  // 2. 取 github token（复用既有 harness-credentials.js）
  let githubToken = '';
  try {
    const tokenFn = deps.tokenFn
      || (await import('./harness-credentials.js')).resolveGitHubToken;
    githubToken = await tokenFn();
  } catch (tokenErr) {
    console.warn(`[skill-relay][xian] resolveGitHubToken 失败（继续，bridge 侧用 account_id 凭据）: ${tokenErr.message}`);
  }

  // 3. bridge payload（改动 B 合同定义）
  const bridgePayload = {
    task_id: task.id,
    task_type: 'harness_relay',
    sprint_dir: sprintDir,
    harness_task_id: task.id,
    brain_url: xianBrainUrl,
    callback_url: `${xianBrainUrl}/api/brain/harness/callback/${containerId}`,
    account_id: task.payload?.xian_account_id || 'team3',
    github_token: githubToken,
    anthropic_api_key: process.env.ANTHROPIC_API_KEY || '',
  };

  // 4. 调 bridge（INV-3：所有 xian-M4 操作走 bridge 留痕）
  const bridgeFn = deps.bridgeFn
    || (await import('./spawn/detached.js')).spawnCodexBridgeDetached;

  try {
    await withLegacyExecution({pool:dbPool,machineId:'xian-mac-m4',provider:'codex',endpoint:bridgeBaseUrl,account:bridgePayload.account_id,repo:task.payload?.repo??parseBaseRepoOrDefault(task.payload?.base_repo)},()=>bridgeFn(`${bridgeBaseUrl}/run`, bridgePayload));
  } catch (spawnErr) {
    // 5. spawn 失败 → 回滚 task（INV-2：loud 失败，不静默降级）
    console.error(`[skill-relay][xian][ALERT] bridge spawn 失败: ${spawnErr.message}`);
    try {
      await dbPool.query(
        `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
        [task.id]
      );
    } catch (rollbackErr) {
      console.warn(`[skill-relay][xian] task 回滚失败（non-fatal）: ${rollbackErr.message}`);
    }
    return { ok: false, mode: RELAY_FLAG, error: spawnErr.message };
  }

  // 6. 落 initiative_runs 行（INV-6：watchdog 可感知）
  const abilityId = task.ability_id || task.payload?.ability_id || null;
  await dbPool.query(
    `INSERT INTO initiative_runs
       (initiative_id, phase, journey_id, orchestrator_version, orchestrator_host,
        deadline_at, ability_id, current_task_id, created_source)
     VALUES ($1, 'A_planning', $2, 'v1', $3,
             NOW() + INTERVAL '${XIAN_RELAY_DEADLINE_HOURS} hours',
             $4, $5, 'legacy_relay')`,
    [initiativeId, task.payload?.journey_id || null, 'skill-relay-xian', abilityId, task.id]
  );

  console.log(`[skill-relay][xian] bridge spawned: container=${containerId} sprint=${sprintDir}`);
  return { ok: true, mode: RELAY_FLAG, containerId, sprintDir };
}

// ─── headed 分支实现 ──────────────────────────────────────────────────────────

// T6（88e0b448）：headed tmux 链路从 codex-only 泛化为 codex|claude。
// host 值与 tmux session 前缀按 executor 映射；watchdog（harness-relay-watchdog.js）
// 用同一映射做存活检测/收窗，两边改动必须同步。
const HEADED_HOSTS = {
  codex: 'skill-relay-codex-headed',
  claude: 'skill-relay-claude-headed',
  grok: 'skill-relay-grok-headed',
};
const HEADED_TMUX_PREFIXES = { codex: 'codex-relay-', claude: 'claude-relay-', grok: 'grok-relay-' };
const HEADED_RELAY_DEADLINE_HOURS = 8;

export { HEADED_HOSTS, HEADED_TMUX_PREFIXES };

/**
 * headed 模式：ssh 逃逸宿主，tmux new-session 启动 codex TUI / grok（claude 已退役，任务 76a160b3）。
 * 不走 docker，不产生 extraMounts，不注入 GITHUB_TOKEN 进 tmux 命令串。
 */
async function _spawnHeadedSession(task, {
  dbPool,
  now,
  short,
  initiativeId,
  deps,
}) {
  // Claude Code 通道已退役（任务 76a160b3）：headed kernel 等经此直达的路径同样拒绝 claude
  if (task.payload?.executor === 'claude') {
    return { ok: false, mode: HEADED_HOSTS.claude, error: CLAUDE_CHANNEL_RETIRED_CODE };
  }
  // executor 映射：grok 显式判，其余（codex/缺省）按 codex 处理
  const headedExecutor = task.payload?.executor === 'grok' ? 'grok' : 'codex';
  const headedHost = HEADED_HOSTS[headedExecutor];
  const isGrokHeaded = headedExecutor === 'grok';

  // B6 门禁在 headed 分支同样生效（headed 早退绕过了 spawnSkillRelaySession 主体里的
  // CODEX_RELAY_HOME/GROK_RELAY_HOME 检查）。
  // 未配置（undefined）→ 放行（本地/测试环境）；显式配置为空字符串 → loud-fail。
  const codexRelayHome = process.env.CODEX_RELAY_HOME;
  if (!isGrokHeaded) {
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
      return { ok: false, mode: headedHost, error: 'CODEX_RELAY_HOME 未配置' };
    }
  }

  // 2026-07-22：不直接用真实 CODEX_RELAY_HOME 跑 codex（同 docker relay 病根——
  // headed session 里 codex 自己刷新会写回真文件，跟宿主 cron 竞态），先快照到
  // 一次性临时目录再用。快照失败（真实目录下没有 auth.json，配置错误）loud-fail
  // + task 回滚，跟 docker 路径的处理方式一致。
  let codexRelayCredDir;
  if (!isGrokHeaded && codexRelayHome) {
    const snapshotFn = deps.snapshotCodexHome || snapshotCodexRelayHome;
    try {
      codexRelayCredDir = snapshotFn(codexRelayHome, task.id);
    } catch (snapshotErr) {
      console.error(`[skill-relay][headed][ALERT] codex 凭据快照失败: ${snapshotErr.message}`);
      try {
        await dbPool.query(
          `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
          [task.id]
        );
      } catch (rollbackErr) {
        console.warn(`[skill-relay][headed] task 回滚失败（non-fatal）: ${rollbackErr.message}`);
      }
      return { ok: false, mode: headedHost, error: `codex 凭据快照失败: ${snapshotErr.message}` };
    }
  }

  // grok headed 门禁：GROK_RELAY_HOME='' → loud-fail（对齐 codex headed 门禁 L478-491）
  if (isGrokHeaded) {
    const grokRelayHomeHeaded = process.env.GROK_RELAY_HOME;
    if (grokRelayHomeHeaded !== undefined && !grokRelayHomeHeaded) {
      console.error('[skill-relay][headed][ALERT] GROK_RELAY_HOME 未配置，grok executor 无法挂载凭据');
      try {
        await dbPool.query(
          `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
          [task.id]
        );
      } catch (rollbackErr) {
        console.warn(`[skill-relay][headed] task 回滚失败（non-fatal）: ${rollbackErr.message}`);
      }
      return { ok: false, mode: headedHost, error: 'GROK_RELAY_HOME 未配置' };
    }
  }

  const sprintDir = task.payload?.sprint_dir
    || `sprints/${stampMMDDHHNN(now())}-relay-${short}`;
  // 容器内 'localhost' = 容器自己（R2 8e2bbaef 实证 Connection refused）——对齐
  // spawn/host-executor.js 先例：/.dockerenv 存在时用宿主别名，ssh 加 BatchMode 三件套。
  const inDocker = (deps.inDockerFn || (() => { try { return existsSync('/.dockerenv'); } catch { return false; } }))();
  const sshHost = task.payload?.ssh_host || process.env.HEADED_SSH_HOST
    || (inDocker ? 'administrator@host.docker.internal' : 'localhost');
  // 雷7（R3 dd9642d8 实证 Permission denied）：compose 把宿主 ~/.ssh 同路径 :ro 挂进容器，
  // 对齐 spawn/host-executor.js 的 key 自动发现（候选列表同源），env HEADED_SSH_KEY 可覆盖。
  const defaultSshKeyFn = () => {
    if (process.env.HEADED_SSH_KEY) return process.env.HEADED_SSH_KEY;
    for (const k of ['/Users/administrator/.ssh/id_ed25519', '/Users/administrator/.ssh/id_rsa']) {
      try { if (existsSync(k)) return k; } catch { /* ignore */ }
    }
    return null;
  };
  const sshKey = (deps.sshKeyFn || defaultSshKeyFn)();
  const SSH_OPTS = `${sshKey ? `-i ${sshKey} ` : ''}-o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
  const tmuxSession = `${HEADED_TMUX_PREFIXES[headedExecutor]}${short}`;
  const promptFile = `/tmp/cecelia-host-prompts/${task.id}.${short}.prompt`;

  // 降级：real ssh 执行（生产路径）。用文件顶部已 import 的 execSync（ESM 下 require 未定义会直接崩）。
  // 提前到 worktree/prompt 构建之前：雷11 去重守卫需要在做任何昂贵前置工作
  // （ensureWt/loadSkill/写 prompt 文件）之前先探活，命中就提前返回，不浪费资源。
  const execFn = deps.execFn
    || ((cmd, opts) => execSync(cmd, { encoding: 'utf8', timeout: 30000, ...opts }));

  // ─── 雷11：tmux 去重守卫（防 Brain 重启后 startup-sync/dispatcher 双 spawn 撞名）───
  // 对齐同一函数内 headless 分支既有的 docker ps 去重守卫（P1 bug 39b97ade / #3604）：
  // 用 shell 内 && / || 把 tmux has-session 的 exit code 转成可判读的 stdout 字符串，
  // 而不是靠 execFn 是否抛错来判断——execSync 的"命令失败即抛错"语义在 ssh 套壳后
  // 无法区分"ssh 连接失败"与"tmux session 不存在"，且远程 shell 命令始终 exit 0
  // （&&/|| 已经吃掉内层 exit code），不会抛错，判断只能靠 stdout 内容。
  // R5 首航实证：Brain 重启后旧 tmux session 未死，第二次 spawn 撞名 `tmux new-session`
  // 直接报错。命中存活 session → 不重复 spawn，返回 deferred。
  // fail-open：ssh 本身抛错（连接失败等）时保守放行 spawn（不能让探活抽风挡住正常调度）。
  try {
    const guardOut = execFn(
      `ssh ${SSH_OPTS} ${sshHost} "tmux has-session -t ${tmuxSession} 2>/dev/null && echo TMUX_ALIVE || echo TMUX_DEAD"`
    );
    if (String(guardOut).includes('TMUX_ALIVE')) {
      console.warn(`[skill-relay][headed][GUARD] live tmux session exists, skip duplicate spawn: task=${task.id} session=${tmuxSession}`);
      return { ok: false, mode: headedHost, deferred: true, reason: 'live_tmux_guard', tmuxSession };
    }
  } catch (err) {
    console.warn(`[skill-relay][headed][GUARD] tmux 存活检查失败（保守放行 spawn）: ${err.message}`);
  }
  // ─── end 雷11 ────────────────────────────────────────────────────────────────
  const authorizeRelay=operation=>(deps.authorizeLegacyRelay??withLegacyRelayExecution)({pool:dbPool,location:sshHost,provider:headedExecutor,
    credentialIdentity:isGrokHeaded?process.env.GROK_RELAY_HOME:codexRelayHome,
    repo:task.payload?.repo??parseBaseRepoOrDefault(task.payload?.base_repo)},operation);
  try { await authorizeRelay(()=>{}); } catch(error) { return {ok:false,mode:headedHost,error:error.message}; }


  // issue 45dd6925：缺省生成的 sprint_dir 必须回写 payload，否则重派换新目录（断点恢复产物路径漂移）。
  // 放在雷11去重守卫之后：命中守卫 early-return 时不产生 DB 副作用。
  if (!task.payload?.sprint_dir) {
    try {
      await dbPool.query(
        `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('sprint_dir', $2::text)
          WHERE id = $1`,
        [task.id, sprintDir]
      );
    } catch (err) {
      console.warn(`[skill-relay][headed] sprint_dir 持久化失败（不阻塞，task=${task.id}）: ${err.message}`);
    }
  }

  const loadSkill = deps.loadSkill
    || (await import('./harness-shared.js')).loadSkillContent;
  const skillContent = loadSkill(controllerSkillFor(task.task_type));

  // worktree（幂等；headed 分支之前漏调，codex 会在宿主 $HOME 裸奔——worktree 路径经
  // compose rw 挂载容器内外一致，宿主可直接 cd 进去）
  const ensureWt = deps.ensureWt
    || (await import('./harness-worktree.js')).ensureHarnessWorktree;
  const worktreePath = await ensureWt({
    taskId: task.id,
    initiativeId,
    baseRepo: task.payload?.base_repo,
  });
  const brainUrl = 'http://host.docker.internal:5221';
  const chainContext = await buildChainPromptSafe({ pool }, task.id);
  const prompt = buildRelayPrompt({ kind: 'headed', skillContent, task, sprintDir, brainUrl, chainContext });

  // ─── 雷9：codex TUI 首次进新目录会卡"Do you trust the contents of this directory?"
  // 交互确认——trust 记忆按精确项目目录写进 $CODEX_HOME/config.toml 的 [projects."<dir>"]，
  // 每条 harness worktree 都是新路径 → 每次首航都卡门（R4 靠人工 send-keys Enter 放行）。
  // 在起 tmux 之前，经同一条 ssh 通道幂等预写 trust 段：
  //   ①config.toml 不存在（账号未初始化）→ 跳过 + warn，不硬造文件，让 codex 自己处理
  //   ②该 worktree 表已存在 → grep 命中跳过，不产生重复 TOML 表
  if (codexRelayCredDir) {
    const codexConfigPath = `${codexRelayCredDir}/config.toml`;
    try {
      execFn(
        `ssh ${SSH_OPTS} ${sshHost} "if [ -f ${codexConfigPath} ]; then grep -qF '[projects.\\"${worktreePath}\\"]' ${codexConfigPath} || printf '\\n[projects.\\"${worktreePath}\\"]\\ntrust_level = \\"trusted\\"\\n' >> ${codexConfigPath}; else echo 'codex config.toml not found, skip trust preseed' >&2; fi"`
      );
    } catch (trustErr) {
      console.warn(`[skill-relay][headed] trust preseed 失败（non-fatal，交给 codex 自行处理交互确认）: ${trustErr.message}`);
    }
  } else {
    console.warn('[skill-relay][headed] CODEX_RELAY_HOME 未配置，跳过 trust preseed');
  }

  const sshSpawnFn = deps.sshSpawnFn;
  if (!sshSpawnFn) {
    // 写 prompt 文件到宿主（0600 权限）——用 ssh stdin 交付，避免 prompt 内联进
    // 双引号/tmux 单引号时被反引号/引号/$ 炸穿（printf + JSON.stringify 内联已实证必炸）。
    try {
      execFn(
        `ssh ${SSH_OPTS} ${sshHost} "mkdir -p /tmp/cecelia-host-prompts && cat > ${promptFile} && chmod 600 ${promptFile}"`,
        { input: prompt }
      );
    } catch (err) {
      console.error(`[skill-relay][headed] prompt 文件写入失败: ${err.message}`);
      await dbPool.query(
        `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
        [task.id]
      );
      return { ok: false, mode: headedHost, error: `prompt write failed: ${err.message}` };
    }
    // tmux new-session：cd 进 worktree + 注入 CODEX_HOME（不注入=烧宿主默认账号）+
    // codex 位置参数从远端文件展开（--prompt-file 是编造的 flag，codex TUI 只吃 [PROMPT] 位置参数）
    // 雷12（主理人 2026-07-08 改判）：原 -a never -s workspace-write 压不住 codex 内置
    // GitHub MCP 插件的建分支批准框（MCP 工具批准独立于 -a never 的另一层，R5 首航
    // 实证卡死）。逐个预置 permission 是打地鼠，改用整体 bypass：
    // --dangerously-bypass-approvals-and-sandbox，一个 flag 跳过 trust 确认 + shell 命令
    // 批准 + MCP 工具批准，与无头 docker 里 claude 的 --dangerously-skip-permissions 对等
    // （worktree 隔离 + 有头可 esc 打断 = externally sandboxed 受控环境，适用场景成立）。
    // grok headed：宿主 grok-launch.sh，宿主 repo 根可被 CECELIA_HOST_REPO 覆盖。
    // （claude headed 分支随 Claude 通道退役删除，任务 76a160b3）
    const hostRepo = process.env.CECELIA_HOST_REPO || '/Users/administrator/perfect21/cecelia';
    // export HARNESS_TASK_ID + HARNESS_NODE 到 headed session 环境——
    // post-pr-create.sh hook 检测到该变量后跳过 auto-merge，保证 evaluator gate 不被绕过
    // (P0 a638f840 根治：PR 在 evaluator 运行前被 GitHub 自动合并)。
    // headless docker relay 已通过 spawnFn env 参数注入，此处仅补 headed 路径。
    // 两分支路由（INV-1 + FR-R3/R4）：grok / codex 各占一条独立分支
    let innerCmd;
    if (isGrokHeaded) {
      innerCmd = `cd ${worktreePath} && export HARNESS_TASK_ID=${task.id} HARNESS_NODE=controller && bash ${hostRepo}/scripts/grok-launch.sh --task-id ${task.id} --prompt-file ${promptFile}`;
    } else {
      innerCmd = `cd ${worktreePath} && export HARNESS_TASK_ID=${task.id} && CODEX_HOME=${codexRelayCredDir || ''} codex --dangerously-bypass-approvals-and-sandbox \\"\\$(cat ${promptFile})\\"`;
    }
    try {
      await authorizeRelay(()=>execFn(
        `ssh ${SSH_OPTS} ${sshHost} "tmux new-session -d -s ${tmuxSession} '${innerCmd}'"`
      ));
    } catch (spawnErr) {
      console.error(`[skill-relay][headed][ALERT] ssh tmux spawn failed: ${spawnErr.message}`);
      await dbPool.query(
        `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
        [task.id]
      );
      return { ok: false, mode: headedHost, error: `ssh spawn failed: ${spawnErr.message}` };
    }
  } else {
    // 测试注入路径
    try {
      await authorizeRelay(()=>sshSpawnFn({
        sshHost,
        tmuxSession,
        promptFile,
        prompt,
      }));
    } catch (spawnErr) {
      console.error(`[skill-relay][headed][ALERT] ssh spawn failed: ${spawnErr.message}`);
      try {
        await dbPool.query(
          `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$1`,
          [task.id]
        );
      } catch { /* non-fatal */ }
      return { ok: false, mode: headedHost, error: `ssh: ${spawnErr.message}` };
    }
  }

  // initiative_runs 落行（orchestrator_host 按 executor 映射内联，便于测试断言；
  // headedHost 来自 HEADED_HOSTS 固定映射，无注入面）
  const headedAbilityId = task.ability_id || task.payload?.ability_id || null;
  await dbPool.query(
    `INSERT INTO initiative_runs
       (initiative_id, phase, journey_id, orchestrator_version, orchestrator_host,
        deadline_at, ability_id, current_task_id, created_source)
     VALUES ($1, 'A_planning', $2, 'v1', '${headedHost}',
             NOW() + INTERVAL '${HEADED_RELAY_DEADLINE_HOURS} hours',
             $3, $4, 'legacy_relay')`,
    [initiativeId, task.payload?.journey_id || null, headedAbilityId, task.id]
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
  return {
    ok: true,
    mode: headedHost,
    tmuxSession,
    sprintDir,
    extraMounts: undefined,
  };
}
