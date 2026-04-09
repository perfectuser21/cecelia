/**
 * topic-gap-analyzer.js
 *
 * 内容库缺口分析器。
 *
 * 分析近 7 日 content-pipeline tasks 的 content_type 分布，
 * 识别产出比例不足的内容类型，生成可注入 LLM Prompt 的"缺口信号"。
 *
 * 缺口定义：
 *   - 已知内容类型集合：KNOWN_CONTENT_TYPES
 *   - 近 7 日各类型 task 数量统计
 *   - 数量最少（含 0）的类型 = gap（最多返回 TOP 3）
 *
 * 输出字符串示例：
 *   "内容库缺口信号（近7日偏少）：ai-tools-review（0条）、ai-workflow-guide（1条）"
 */

/** 系统支持的内容类型 */
const KNOWN_CONTENT_TYPES = [
  'solo-company-case',
  'ai-tools-review',
  'ai-workflow-guide',
];

/** 分析窗口（天） */
const ANALYSIS_WINDOW_DAYS = 7;

/** 最多返回的缺口类型数量 */
const MAX_GAP_TYPES = 3;

/**
 * 获取内容库缺口信号。
 *
 * 查询近 ANALYSIS_WINDOW_DAYS 天内 content-pipeline tasks 的 content_type 分布，
 * 找出产出最少的类型，返回可直接注入 LLM Prompt 的字符串。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>} 缺口信号文本，为空字符串则表示无明显缺口
 */
export async function getContentGapSignal(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT
         payload->>'content_type' AS content_type,
         COUNT(*) AS cnt
       FROM tasks
       WHERE task_type = 'content-pipeline'
         AND created_at >= NOW() - INTERVAL '${ANALYSIS_WINDOW_DAYS} days'
         AND payload->>'content_type' IS NOT NULL
       GROUP BY payload->>'content_type'`
    );

    // 构建类型 → 数量映射
    const countMap = {};
    for (const ct of KNOWN_CONTENT_TYPES) {
      countMap[ct] = 0;
    }
    for (const row of rows) {
      if (row.content_type in countMap) {
        countMap[row.content_type] = parseInt(row.cnt, 10);
      }
    }

    // 按数量升序排列，取 TOP MAX_GAP_TYPES
    const sorted = Object.entries(countMap)
      .sort((a, b) => a[1] - b[1])
      .slice(0, MAX_GAP_TYPES);

    // 如果最少的类型数量已经 >= 平均值的 80%，认为无明显缺口
    const total = Object.values(countMap).reduce((s, v) => s + v, 0);
    const avg = total / KNOWN_CONTENT_TYPES.length;
    const minCount = sorted[0]?.[1] ?? 0;
    if (avg > 0 && minCount >= avg * 0.8) {
      return '';
    }

    const gapDesc = sorted
      .map(([ct, cnt]) => `${ct}（${cnt}条）`)
      .join('、');

    return `\n【内容库缺口信号（近${ANALYSIS_WINDOW_DAYS}日偏少）】${gapDesc}` +
      `\n→ 优先生成这些类型的选题，补充内容库不足\n`;
  } catch (err) {
    // 缺口分析失败不影响主流程
    console.warn('[topic-gap-analyzer] getContentGapSignal 失败（跳过）:', err.message);
    return '';
  }
}
