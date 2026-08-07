/**
 * acceptance-state.js — 验收一体两面的纯计算层（D1，零 DB 依赖）
 *
 * 三段互不推导的计算，v7-final 明写「两者不得共用同一个动词或同一段计算」：
 *   1. 格级 final_state（作用域 = 单个格，九组合矩阵）      → computeCellState（Task 2 落地）
 *   2. run 级 gate_verdict（作用域 = 整个 run，但不是 status）→ computeGateVerdict（Task 3 落地）
 *   3. run 级 status（7 值状态机，只看人列填写进度）         → computeRunStatus（本文件已有）
 */

export const CELL_STATES = ['绿', '红', '未定'];

/** 裁决四字段齐全才算数（A6 断言 verdict/by/reason/at 全非空） */
function validAdjudication(adj) {
  return Boolean(adj && adj.verdict && adj.by && adj.reason && adj.at);
}

/**
 * 格级判定（作用域 = 单个格），严格照 v7-final §九组合表，无自由发挥空间。
 *
 * @param {object}  cell
 * @param {string?} cell.result         人列：'通过'|'不通过'|'无法验证'|null（未填）
 * @param {string?} cell.ai_verdict     AI 列：同枚举；null = 未跑（Q0′）
 * @param {object?} cell.adjudication   裁决 {verdict,by,reason,at}
 * @param {string}  cell.verifiable_by  该格 yaml 静态属性：'human_only'|'machine_db'|'machine_visual'
 * @param {string?} cell.scenario_class 'mandatory'|'opportunistic'|'unverifiable_this_version'|null
 * @returns {{ final_state: '绿'|'红'|'未定' }}
 */
export function computeCellState({ result, ai_verdict, adjudication, verifiable_by, scenario_class }) {
  // 裁决是人对该格的最终覆盖，AI 是否跑过与之无关，因此排在 Q0′ 之前。
  // hard 格的唯一逃生阀，也是 unverifiable_this_version 格判绿的唯一来源（A12 棘轮计数它）。
  if (validAdjudication(adjudication)) {
    return { final_state: adjudication.verdict === '绿' ? '绿' : '红' };
  }

  // Q0′ 优先级最高：ai_verdict IS NULL 时在读人列之前就短路。
  // 写成「先算人列再看 AI 是否为空」很容易在「人列通过」分支上漏掉这个短路（A5 三例专测）。
  if (ai_verdict == null) return { final_state: '未定' };

  // Q0：人列未填
  if (result == null) return { final_state: '未定' };

  let state = '未定';
  if (result === '通过') {
    if (ai_verdict === '通过') state = '绿';                                  // Q1
    else if (ai_verdict === '无法验证' && verifiable_by === 'human_only') state = '绿'; // Q3 合法
    // Q2（AI 不通过）与 Q3′（machine_db 格的无法验证 = 故障）留在「未定」
  } else if (result === '不通过') {
    if (ai_verdict === '不通过' || ai_verdict === '无法验证') state = '红';    // Q5 / Q6
    // Q4 留在「未定」
  } else if (result === '无法验证') {
    if (ai_verdict === '不通过') state = '红';                                // Q8
    // Q7 / Q9 留在「未定」
  }

  // 本版判定为「这一版验不了」的格（= S13-c4，频控红线）不走任何绿通道，绿只能来自裁决。
  // 红仍然判红——「验不了」不等于「不许判坏」。
  if (state === '绿' && scenario_class === 'unverifiable_this_version') state = '未定';

  return { final_state: state };
}

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
