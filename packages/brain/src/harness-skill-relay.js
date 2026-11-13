const RELAY_FLAG = 'skill-relay';
export const KERNEL_RUNTIME_RETIRED_CODE = 'kernel_runtime_retired';

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
