/** 旧Kernel relay新运行已退役；保留历史会话识别与纯工具兼容。 */
import { normalizeChangeKind } from './impact-contract/change-kind.js';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RELAY_FLAG = 'skill-relay';
/** kernel-v1 运行时退役后的拒绝码（A5，决策 b4adf807）。 */
export const KERNEL_RUNTIME_RETIRED_CODE = 'kernel_runtime_retired';

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

export async function spawnSkillRelaySession(_task, _deps = {}) {
  // 包含 headed/xian/codex：不允许通过旧 relay 创建新的 kernel 会话。
  return {ok:false, mode:RELAY_FLAG, error:KERNEL_RUNTIME_RETIRED_CODE};
}

// 历史会话识别常量仍由watchdog读取；不提供新启动函数。
const HEADED_HOSTS = {
  codex: 'skill-relay-codex-headed',
  claude: 'skill-relay-claude-headed',
  grok: 'skill-relay-grok-headed',
};
const HEADED_TMUX_PREFIXES = { codex: 'codex-relay-', claude: 'claude-relay-', grok: 'grok-relay-' };
export { HEADED_HOSTS, HEADED_TMUX_PREFIXES };
