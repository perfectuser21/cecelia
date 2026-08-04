/**
 * rubric-trend.js —— 案卷式 GAN 的 rubric 趋势观测安全网（PR-B，issue ce42f68f / 决策 ba33fc68）。
 *
 * 语义 SSOT：docs/superpowers/specs/2026-08-04-gan-case-file-design.md §数据流 4。
 * 背景：Reviewer skill 9.11.0 承诺"发散由代码判 diverging/oscillating 强制 APPROVED"，
 * 该兜底在 LangGraph→Kernel 重写时丢失（r17 四轮零收敛实锤：R2 47分→R3 46分多维走低仍继续对抗）。
 * 对齐旧实现 packages/brain/src/workflows/harness-gan.graph.js detectConvergenceTrend，
 * 但输入形态换成 gan_case_file 表行（case-file-store.js loadCaseFile 的返回形状），
 * 不再是内存态 rubricHistory —— 案卷落库即 SSOT，不吃内存态就能跨重启/跨 attempt 存活。
 *
 * 阈值口径（审查 F2(a) 拍板，2026-08-04）——立法本意"无上限、只拦真发散"，
 * 单点小抖动不算：
 *   - oscillating：方向命中高低高/低高低（严格不等式）**且**两腿幅度都 ≥2
 *     （|a-b|>=2 且 |b-c|>=2）。10→9→10 这种 1 分抖动不算。
 *   - diverging：满足其一即算——
 *       (i) 单维两连降（a>b>c，严格）且累计跌幅 a-c >= 2；
 *       (ii) ≥2 个维度同时两连降（a>b>c，严格），不限单维幅度
 *            （多维同时走低本身就是发散信号，不需要单维幅度门槛）。
 *
 * 纯函数：不做任何 IO/Date.now/随机数（derive.js 确定性纪律同款要求）。
 */

const OSCILLATION_LEG_MIN = 2;
const SINGLE_DIM_DROP_MIN = 2;
const MULTI_DIM_DECLINE_COUNT_MIN = 2;

/**
 * JSONB 数值取值：null（显式 JSON null，例如 optional 维度未填）必须视为"缺失"而非 0。
 * `Number(null) === 0` 是原生 JS 的经典陷阱——会把"这个维度没打分"误判成"打了 0 分"，
 * 造成假发散（F4：null→0 假发散 bug）。undefined 本来就 Number(undefined)===NaN，
 * 這里统一显式处理，不依赖隐式转换。
 */
function numericOrNaN(value) {
  return value == null ? NaN : Number(value);
}

/**
 * @param {Array<{round: number, author_role: string, rubric_scores: object|null}>} caseFileRows
 *   gan_case_file 全量行（不要求预先排序/预先过滤角色）。
 * @returns {'insufficient_data'|'converging'|'diverging'|'oscillating'}
 */
export function detectRubricTrend(caseFileRows) {
  if (!Array.isArray(caseFileRows)) return 'insufficient_data';

  // 只取 reviewer 角色且带结构化 rubric_scores 的行，按 round 升序。
  const reviewerRounds = caseFileRows
    .filter((row) => (
      row
      && row.author_role === 'reviewer'
      && row.rubric_scores != null
      && typeof row.rubric_scores === 'object'
      && Number.isInteger(row.round)
    ))
    .sort((a, b) => a.round - b.round);

  if (reviewerRounds.length < 3) return 'insufficient_data';

  // 最近 3 轮（round 可能不连续——只看"最近 3 次 reviewer 有效评分"，非"最近 3 个 round 号"）。
  const [a, b, c] = reviewerRounds.slice(-3);

  // 维度集合从三轮 rubric_scores 的 key 并集取，不写死固定维度数组：
  // 案卷是 SSOT，reviewer SKILL 改维度不需要同步改这个文件（对齐设计文档"7 维度对齐 reviewer
  // SKILL"的耦合教训——旧实现用固定 RUBRIC_DIMENSIONS 数组，改维度需要两处同步）。
  const dims = new Set([
    ...Object.keys(a.rubric_scores),
    ...Object.keys(b.rubric_scores),
    ...Object.keys(c.rubric_scores),
  ]);

  let twoConsecutiveDeclineCount = 0;
  let bigSingleDimDrop = false;

  for (const dim of dims) {
    const va = numericOrNaN(a.rubric_scores[dim]);
    const vb = numericOrNaN(b.rubric_scores[dim]);
    const vc = numericOrNaN(c.rubric_scores[dim]);
    // 非数值容错（字符串/null/undefined/NaN）：跳过该维度，不崩不算发散依据。
    if ([va, vb, vc].some((n) => Number.isNaN(n))) continue;

    // oscillating 优先于 diverging（对齐旧 detectConvergenceTrend 语义）：
    // 高低高（a>b 且 c>b）或 低高低（a<b 且 c<b），严格不等式，且两腿幅度都 >= 2 才算
    // （F2(a)：只是方向对但幅度只有 1 分的小抖动不算真发散）。
    const highLowHigh = va > vb && vc > vb;
    const lowHighLow = va < vb && vc < vb;
    const legsBigEnough = Math.abs(va - vb) >= OSCILLATION_LEG_MIN
      && Math.abs(vb - vc) >= OSCILLATION_LEG_MIN;
    if ((highLowHigh || lowHighLow) && legsBigEnough) return 'oscillating';

    // diverging 候选：任一维度连续 2 轮严格下降（a>b>c）。
    if (va > vb && vb > vc) {
      twoConsecutiveDeclineCount += 1;
      if (va - vc >= SINGLE_DIM_DROP_MIN) bigSingleDimDrop = true;
    }
  }

  if (bigSingleDimDrop || twoConsecutiveDeclineCount >= MULTI_DIM_DECLINE_COUNT_MIN) {
    return 'diverging';
  }
  return 'converging';
}
