// 合同对抗的代码判分与收敛走势（纯函数）。
// 设计原则（主理人决策，勿改；决策 02d8e749，记忆 harness-gan-design）：GAN 不设轮数上限，无限转直到代码判 APPROVED；
// 「能无上限地走，但最终要收敛——越来越小，不能越来越大」：发散/震荡由走势判出，强制通过 + P1 升级，不靠轮数封顶。
// detectTrend 移植自 packages/brain/src/workflows/harness-gan.graph.js detectConvergenceTrend（同算法，维度换成 QA 视角）。

/** QA 视角 5 个评分维度（0–10 整数），评审文档 `## 评分` 段按此逐行给分。 */
export const RUBRIC_DIMS = ['意图对齐', '可验证', '场景覆盖', '回归风险', '可执行'];
export const THRESHOLD = 7;

const num = (v) => (typeof v === 'number' ? v : Number.NaN);

/**
 * 最近 3 轮走势：'insufficient_data'（<3 轮，继续）| 'oscillating'（任一维度高低高/低高低）
 * | 'diverging'（任一维度连续两轮严格走低，或规格行数连续两轮净增长且总分没涨）| 'converging'。
 * history = [{ scores: {维度: 分}, specLines?: number }, ...]
 */
export function detectTrend(history) {
  if (!Array.isArray(history) || history.length < 3) return 'insufficient_data';
  const last3 = history.slice(-3);
  if (!last3.every((e) => e && e.scores && typeof e.scores === 'object')) return 'insufficient_data';
  const [a, b, c] = last3;
  const triples = RUBRIC_DIMS
    .map((d) => [num(a.scores[d]), num(b.scores[d]), num(c.scores[d])])
    .filter((t) => !t.some(Number.isNaN));
  if (triples.some(([x, y, z]) => (x > y && z > y) || (x < y && z < y))) return 'oscillating';
  if (triples.some(([x, y, z]) => x > y && y > z)) return 'diverging';
  // 越写越大且没变好才算发散（原规则注释：「合同逐轮膨胀且评分未全过 = 典型发散」）；按 QA 意见补内容、总分在涨的不算
  const [la, lb, lc] = [num(a.specLines), num(b.specLines), num(c.specLines)];
  const total = (e) => RUBRIC_DIMS.reduce((sum, d) => sum + (Number.isNaN(num(e.scores[d])) ? 0 : e.scores[d]), 0);
  if (![la, lb, lc].some(Number.isNaN) && la < lb && lb < lc && total(c) <= total(a)) return 'diverging';
  return 'converging';
}

/**
 * 原地打转（审计 #27，旧 reviewer「Pivot vs Refine」）：最近一轮总分没高于上一轮 → true，下一轮要求评审写 `## 换思路`。
 * 只是加信息、不判结局；结局仍由 detectTrend 的发散/震荡决定。
 */
export function stalled(history) {
  if (!Array.isArray(history) || history.length < 2) return false;
  const total = (e) => RUBRIC_DIMS.reduce((sum, d) => sum + (Number.isNaN(num(e?.scores?.[d])) ? 0 : e.scores[d]), 0);
  return total(history.at(-1)) <= total(history.at(-2));
}

/** 代码判分（不信 AI 自报结论）：5 维全部 ≥ THRESHOLD 且没有仍开着的阻断/重要问题 → approved。 */
export function decide({ scores, openIssues }) {
  const reasons = [];
  for (const d of RUBRIC_DIMS) {
    const v = num(scores?.[d]);
    if (Number.isNaN(v)) reasons.push(`score_missing:${d}`);
    else if (v < THRESHOLD) reasons.push(`score_low:${d}=${v}`);
  }
  for (const i of openIssues ?? []) reasons.push(`open_issue:${i.id}`);
  return { approved: reasons.length === 0, reasons };
}
