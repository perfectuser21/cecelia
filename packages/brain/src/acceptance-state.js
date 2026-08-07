/**
 * acceptance-state.js — 验收一体两面的纯计算层（D1，零 DB 依赖）
 *
 * 三段互不推导的计算，v7-final 明写「两者不得共用同一个动词或同一段计算」：
 *   1. 格级 final_state（作用域 = 单个格，九组合矩阵）      → computeCellState
 *   2. run 级 gate_verdict（作用域 = 整个 run，但不是 status）→ computeGateVerdict
 *   3. run 级 status（7 值状态机，只看人列填写进度）         → computeRunStatus
 */

/** 7 值状态机的全集；passed/failed 是只读历史兼容值，不在其中 */
export const RUN_STATUSES = [
  'pending', 'in_review', 'human_complete', 'adjudicated', 'stale', 'expired', 'abandoned',
];

/** 只有这两个状态会被「提交人列结果」这条路径改写 */
export const ACTIVE_RUN_STATUSES = ['pending', 'in_review'];

/**
 * 提交人列这条路径必须原样保留的前态：5 个非活跃终态 + 2 个只读历史兼容值。
 * 「不在活跃集里就透传」是不够的——前态缺失（run 行被并发删掉）或库里躺着不可识别的
 * 历史值时会把 undefined 透传出去，写进 NOT NULL 的 status 列直接炸掉整笔提交，
 * 连带已落库的 check 结果一起回滚。只认白名单，其余一律按填写进度重算。
 */
const PRESERVED_RUN_STATUSES = [
  ...RUN_STATUSES.filter((s) => !ACTIVE_RUN_STATUSES.includes(s)),
  'passed', 'failed',
];

/**
 * run 级 status：只看人列填写进度，不看 AI 列、不看 final_state。
 * human_complete 的判据是人列全部非 NULL，与「其中有几格不通过」无关——
 * 旧三元式只要有一格不通过就写 failed，而合看页/裁决/员工回显都以 human_complete
 * 为开门条件，于是「员工判出不通过的那一轮」永远打不开后续流程（A10⑤ 堵的就是这个洞）。
 */
export function computeRunStatus(prevStatus, { total, humanFilled }) {
  // 非活跃终态由各自的显式转移路径设置（human_complete→adjudicated 走裁决；*→stale 走冻结锁；
  // pending→expired 走 48h 扫描；*→abandoned 走作废端点），提交人列这条路径不得把它们改回去
  if (PRESERVED_RUN_STATUSES.includes(prevStatus)) return prevStatus;
  if (humanFilled === 0) return 'pending';
  if (humanFilled < total) return 'in_review';
  return 'human_complete';
}
