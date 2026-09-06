/**
 * coding-grids.js — 编码线九格常量与相判定（判官口粮第二铲）
 *
 * 结晶判官第一批被告是 OpenClaw leadgen 视觉八格（og1..og8，见 grids.js），
 * 但编码线（回家序列器 home-sequencer）自己的九格从来没进过判官的册页——
 * 真实成败躺在 harness_attempts 的 phase×status 里无人搬运，判官只能天天判 data_gap。
 *
 * 本模块只回答三个机械问题，不含任何判断力：
 *   ① 九格是哪九个（从 home-sequencer STAGE_ORDER 派生，不留硬编码副本以免漂移）
 *   ② 旧代 kernel 的「相(phase)」归到哪一格（两代必须落同一判决单位，
 *      否则 minRuns=20 的次数永远攒不够——一半算在 'gan'、一半算在 'contract'）
 *   ③ 哪些格带机械探针（INV-2 探针强制：认定取 STAGE_REQUIRED_HANDOFFS，不靠人工声明）
 */

import { STAGE_ORDER } from '../orchestrator/home-sequencer.js';
import { STAGE_REQUIRED_HANDOFFS } from '../orchestrator/handoff-schemas.js';

/** 判决单位键前缀：与判官自管单位（og1..og8 + 证据段名）写者隔离，永不撞键。 */
export const CODING_UNIT_PREFIX = 'coding:';

/**
 * 编码线九格。`__run_init` / `__run_finalize` 是序列器的开合动作不是格子，剔除。
 * 派生而非抄写：序列器改格序时本常量自动跟随，配对测试锁死两者一致。
 */
export const CODING_GRIDS = Object.freeze(STAGE_ORDER.filter((s) => !s.startsWith('__')));

/**
 * kernel「相」→ 九格。只登记有确定对应物的相；认不出的一律 null。
 *
 * 猜一个格等于往判官账本里塞假数，宁可少记一条：
 *   - `review` 是人审等待，九格里没有对应格（人审是格外的闸，不是一次格子执行）
 *   - `failed` / `done` 是 run 终态，不是格
 */
const KERNEL_PHASE_TO_GRID = Object.freeze({
  planning: 'plan',
  gan: 'contract',      // GAN 对抗（proposer×reviewer）产出并封合同 = contract 格
  generate: 'generate',
  evaluate: 'evaluate',
  judge: 'judge',
  publish: 'publish',
  merge: 'merge',
});

/**
 * @param {string|null|undefined} phase kernel 相名
 * @returns {string|null} 九格之一；认不出返回 null（不猜）
 */
export function gridForKernelPhase(phase) {
  if (typeof phase !== 'string') return null;
  return KERNEL_PHASE_TO_GRID[phase] ?? null;
}

/**
 * 把格名包成判决单位键。
 * @param {string} grid
 * @returns {string}
 */
export function codingUnitKey(grid) {
  return `${CODING_UNIT_PREFIX}${grid}`;
}

/**
 * 该格有没有机械探针（postcondition）。
 * 判据来自交接件契约 STAGE_REQUIRED_HANDOFFS：要求交接件 = 该格产出必须过 schema 校验
 * = 有可机械复核的后置条件。没登记的格诚实报 false（INV-2 无探针不许晋升）。
 * @param {string} grid
 * @returns {boolean}
 */
export function gridHasPostcondition(grid) {
  const required = STAGE_REQUIRED_HANDOFFS[grid];
  return Array.isArray(required) && required.length > 0;
}
