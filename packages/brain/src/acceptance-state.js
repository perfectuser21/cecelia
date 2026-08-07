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

/** 故障类 reason：AI 自己没跑成，不是这格本来就机器验不了 */
export const AI_FAILURE_REASONS = ['page_unreachable', 'login_failed', 'timeout'];

/**
 * run 级闸判定（作用域 = 整个 run，但不是 status —— status 只看人列进度）。
 * @param {Array<{check_key:string, hard:boolean, final_state:string}>} cells
 * @param {{ai_incomplete?:boolean}} runDetail
 */
export function computeGateVerdict(cells, runDetail = {}) {
  // AI 跑挂了要和「格判红」机械可区分：前者是基础设施故障，后者是产品缺陷，
  // 混在一起会让一次采证器崩溃看起来像一次真实的验收失败。
  //
  // 这一条同时是缺格的独立拦截路径，不能降级成「汇总 final_state」的下游：
  // computeCellState 把裁决排在 Q0′ 短路之前，缺格被裁决绿后格级就是绿，
  // 只看 final_state 的闸会让「AI 少回写 + 人工补绿」整轮放行（v7-final:275）。
  if (runDetail.ai_incomplete) {
    return { gate_verdict: '红', red_cells: [], blocked_reason: 'ai_run_infra_error' };
  }
  // 空输入下「没有非绿格」恒成立，闸会判绿——run 一格没建或取数挂掉就等于自动放行。
  // 这一层是纯计算，没有「取数失败」的概念，收到空集只可能是调用方的 bug，抛错让它立刻显形。
  if (!Array.isArray(cells) || cells.length === 0) {
    throw new Error('computeGateVerdict: cells 为空，拿不到建行格无法判闸');
  }
  const notGreen = cells.filter((c) => c.final_state !== '绿');
  const redCells = notGreen.filter((c) => c.hard || c.final_state === '红').map((c) => c.check_key);
  return {
    gate_verdict: notGreen.length === 0 ? '绿' : '红',
    red_cells: redCells,
    blocked_reason: null,
  };
}

/**
 * 哑火判据三条件（任一成立即 dumb）：
 *   ① 确定判定格数 == 0
 *   ② machine_db 格中故障类无法验证 ≥ ceil(machineDbTotal / 2)
 *      （19 格 → 10，Gate B 第 4 条落档 3 后 18 格 → 9；阈值从分母算，不硬编码）
 *   ③ 缺格数 > 0（ai_verdict IS NULL）
 * @param {Array<{check_key:string, ai_verdict:string?, ai_reason:string?, verifiable_by:string}>} cells
 * @param {{machineDbTotal:number}} opts
 */
export function computeAiStatus(cells, { machineDbTotal } = {}) {
  // 分母漏传时 ceil(undefined/2) = NaN，而 `n >= NaN` 恒 false —— 条件② 会整条静默失效，
  // 一次采证器半数故障将被判成 ok。阈值算不出来就不许往下走。
  if (!Number.isInteger(machineDbTotal) || machineDbTotal <= 0) {
    throw new Error(`computeAiStatus: machineDbTotal 必须是正整数，收到 ${machineDbTotal}`);
  }
  const decided =cells.filter((c) => c.ai_verdict === '通过' || c.ai_verdict === '不通过').length;
  const missingCells = cells.filter((c) => c.ai_verdict == null).map((c) => c.check_key);
  const machineDbFailures = cells.filter(
    (c) => c.verifiable_by === 'machine_db'
      && c.ai_verdict === '无法验证'
      && AI_FAILURE_REASONS.includes(c.ai_reason)
  ).length;
  const failureThreshold = Math.ceil(machineDbTotal / 2);

  const reasons = [];
  if (decided === 0) reasons.push('no_decided_cells');
  if (machineDbFailures >= failureThreshold) reasons.push('machine_db_failures');
  if (missingCells.length > 0) reasons.push('missing_cells');

  return {
    ai_status: reasons.length > 0 ? 'dumb' : 'ok',
    ai_incomplete: reasons.length > 0,
    reasons,
    missing_cells: missingCells,
    machine_db_failures: machineDbFailures,
    failure_threshold: failureThreshold,
  };
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
