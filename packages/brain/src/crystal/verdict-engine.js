/**
 * 结晶判官 — 三态判决规则引擎（纯函数，环境无关）
 *
 * 决策 28ca1f69（技能蒸馏五步循环）落地的判据引擎：把每格/每技能的六项运行指标
 * 套三态规则，产出 { verdict, basis }。纯逻辑不碰 DB（DB 写路径在 crystal-judge.js，
 * 由 contract-dod.md 的 [BEHAVIOR] 在真实 Brain + 真 Postgres 上验，见「禁 mock 边清单」）。
 *
 * 三态：
 *   - promote  晋升（固化）：N≥minRuns ∧ 成功率≥minSuccessRate ∧ 新分支率≤maxNewBranchRate
 *               ∧ 有 postcondition ∧ 频率×token成本 > 固化成本基线
 *   - demote   降级：固化件在窗口内碎次数达阈（broken_count ≥ demoteBreaks）
 *   - keep_llm 保持纯 LLM：数据不足 / 变体未收敛 / 无探针 / 判定层 / 数据缺口 / 成本缺口 / 未达标
 *
 * 铁律（决策 28ca1f69）：
 *   INV-1 判定层不蒸馏：is_judgment_layer 永不出 promote。
 *   INV-2 探针强制：无 postcondition 不许入库晋升。
 *   INV-5 固化优先级 = 频率 × 失败率（crystallizePriority）。
 */

/**
 * 三态判决阈值旋钮。固化成本基线为 token 当量占位常量（judgment-pending-user），
 * 降级阈值取 PRD 保守默认（7 天碎 3 次）。
 */
export const CRYSTAL_THRESHOLDS = {
  minRuns: 20, // 数据充分下限：N<minRuns 判 keep_llm（证据不足不晋升）
  minSuccessRate: 0.9, // 晋升成功率门槛
  maxNewBranchRate: 0, // 变体收敛门槛：新分支率 > 该值即未收敛，不晋升
  crystallizeCostBaseline: 200000, // 固化成本基线（频率×token成本需超过它才值得固化）
  demoteBreaks: 3, // 降级碎次阈
  demoteWindowDays: 7, // 降级观察窗（天）
};

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * 对单格/单技能指标出具三态判决。
 * @param {object} metrics - { n_runs, success_rate, token_cost, latency_ms, new_branch_rate,
 *   broken_count, has_postcondition, is_hardened, is_judgment_layer, data_gap }
 * @param {object} thresholds - CRYSTAL_THRESHOLDS
 * @returns {{verdict: 'promote'|'demote'|'keep_llm', basis: object}}
 */
export function classifyCrystalVerdict(metrics = {}, thresholds = CRYSTAL_THRESHOLDS) {
  const t = { ...CRYSTAL_THRESHOLDS, ...thresholds };
  const m = metrics || {};

  const n_runs = num(m.n_runs);
  const new_branch_rate = num(m.new_branch_rate);
  const broken_count = num(m.broken_count);
  const token_cost = num(m.token_cost);

  // 降级优先：固化件在窗口内碎次数达阈 → 退回 LLM 重标定
  if (m.is_hardened && broken_count >= t.demoteBreaks) {
    return {
      verdict: 'demote',
      basis: {
        rule: 'hardened_broken_threshold_exceeded',
        broken_count,
        demote_breaks: t.demoteBreaks,
        demote_window_days: t.demoteWindowDays,
      },
    };
  }

  // INV-1 判定层不蒸馏：判定层永不固化，即使全部晋升条件满足
  if (m.is_judgment_layer) {
    return { verdict: 'keep_llm', basis: { rule: 'judgment_layer_never_harden' } };
  }

  // 数据缺口：源不可达/无新数据 → 保持纯 LLM，不误判为成功/失败
  if (m.data_gap) {
    return { verdict: 'keep_llm', basis: { rule: 'data_gap' } };
  }

  // 数据不足：N<minRuns，证据不足不晋升
  if (n_runs < t.minRuns) {
    return {
      verdict: 'keep_llm',
      basis: { rule: 'data_insufficient', n_runs, min_runs: t.minRuns },
    };
  }

  // 成本证据缺口：跑量是真的，只是没有 token 源，算不出「不固化要烧多少」。
  // 与 data_gap 分开报，否则读账的人会以为这一格根本没跑过（编码九格实测跑了几百次，
  // 混报 data_gap 会把 n_runs 一并抹成 0）。没有成本证据同样不许晋升，语义不变。
  if (m.cost_gap) {
    return {
      verdict: 'keep_llm',
      basis: { rule: 'cost_evidence_missing', n_runs, success_rate: num(m.success_rate, null) },
    };
  }

  // 变体未收敛：新分支率 > 阈值，即使成功率高也不晋升
  if (new_branch_rate > t.maxNewBranchRate) {
    return {
      verdict: 'keep_llm',
      basis: { rule: 'variant_unconverged', new_branch_rate, max_new_branch_rate: t.maxNewBranchRate },
    };
  }

  // INV-2 探针强制：无 postcondition 不许入库晋升
  if (!m.has_postcondition) {
    return { verdict: 'keep_llm', basis: { rule: 'no_postcondition_probe_mandatory' } };
  }

  // 成功率未达标
  const success_rate = num(m.success_rate, null);
  if (success_rate === null || success_rate < t.minSuccessRate) {
    return {
      verdict: 'keep_llm',
      basis: { rule: 'success_rate_below_threshold', success_rate, min_success_rate: t.minSuccessRate },
    };
  }

  // 固化成本收益：频率 × token 成本 > 固化成本基线，才值得固化
  const costBenefit = n_runs * token_cost;
  if (costBenefit <= t.crystallizeCostBaseline) {
    return {
      verdict: 'keep_llm',
      basis: { rule: 'below_crystallize_cost_baseline', cost_benefit: costBenefit, baseline: t.crystallizeCostBaseline },
    };
  }

  // 全部晋升条件满足
  return {
    verdict: 'promote',
    basis: {
      rule: 'promote_all_conditions_met',
      n_runs,
      success_rate,
      new_branch_rate,
      cost_benefit: costBenefit,
    },
  };
}

/**
 * INV-5 固化优先级 = 频率 × 失败率。先固化 LLM 最易点飞的高频片段。
 * @param {{n_runs:number, success_rate:number}} param0
 * @returns {number}
 */
export function crystallizePriority({ n_runs, success_rate } = {}) {
  const runs = num(n_runs);
  const rate = num(success_rate);
  return runs * (1 - rate);
}
