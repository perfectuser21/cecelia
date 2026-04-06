/**
 * topic-selector.js
 *
 * AI 驱动的内容选题引擎。
 * 调用 Claude API 基于品牌画像和历史选题，自动生成每日内容选题建议。
 *
 * 输出：选题对象数组，每个对象含：
 *   keyword          - 选题核心关键词
 *   content_type     - 内容类型（如 'solo-company-case'）
 *   title_candidates - 标题备选列表（3 个）
 *   hook             - 开头钩子文案（50 字内）
 *   why_hot          - 选题理由（热点/账号画像匹配度说明）
 *   priority_score   - 优先级分数 0-1
 */

import { callLLM } from './llm-caller.js';
import { getHighPerformingTopics } from './topic-heat-scorer.js';
import { queryWeeklyROI } from './content-analytics.js';

// ─── 品牌画像常量 ────────────────────────────────────────────────────────────

const BRAND_KEYWORDS = ['能力', '系统', '一人公司', '小组织', 'AI驱动', '能力下放', '能力放大'];
const BRAND_BANNED = ['coding', '搭建', 'agent workflow', 'builder', 'Cecelia', '智能体搭建', '代码部署'];
const BRAND_VOICE = '帮助个人和小组织，用 AI 拥有过去只有公司才有的能力';
const TARGET_AUDIENCE = '企业主 A 类（年营收 100-1000 万，想用 AI 降本增效）+ 副业创业 B 类（有本职工作，想用 AI 建副业）';
// 所有内容类型均需在 DB 中配置 notebook_id 方可产出内容。
// solo-company-case 已配置；ai-tools-review 和 ai-workflow-guide 共用同一 notebook_id（notebook 在各次 pipeline 之间清空复用）。
const AVAILABLE_CONTENT_TYPES = ['solo-company-case', 'ai-tools-review', 'ai-workflow-guide'];
const TARGET_TOPIC_COUNT = 10;

// ─── Prompt 构建 ─────────────────────────────────────────────────────────────

/**
 * 提取「AI一人公司」垂类当前热点话题上下文。
 * 通过 LLM 合成当前该垂类的主要讨论方向，注入选题 Prompt。
 *
 * @returns {Promise<string>} 热点上下文段落，格式化后可直接嵌入 Prompt
 */
async function buildHotspotContext() {
  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const hotspotPrompt = `今天是 ${today}。
请列出目前「AI一人公司 / 个人用AI提效 / AI副业创业」垂类在中文社交媒体（微信、抖音、小红书、知乎）上正在热烈讨论的 5 个话题方向。

要求：
- 每个方向一行，格式：「方向关键词：一句话说明为什么现在热」
- 聚焦创业者/企业主/副业人群的真实痛点
- 只输出 5 行，不要其他文字`;

  try {
    const { text } = await callLLM('cortex', hotspotPrompt, { maxTokens: 400, timeout: 20000 });
    if (text && text.trim().length > 10) {
      return `\n【垂类当前热点话题方向】（结合这些方向选题，不要照搬，要与品牌定位结合）\n${text.trim()}\n`;
    }
  } catch {
    // 热点提取失败不影响主流程
  }
  return '';
}

/**
 * 查询近 7 日各平台高ROI内容特征，生成可注入 Prompt 的上下文段落。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>}
 */
export async function get7DayROIContext(pool) {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const rows = await queryWeeklyROI(pool, start, end);
    if (!rows || rows.length === 0) return '';

    const lines = rows
      .filter(r => r.content_count > 0)
      .map(r => `- ${r.platform}：${r.content_count}篇内容，平均 ${r.avg_views_per_content} 播放，互动率 ${r.engagement_rate}‰`)
      .join('\n');

    return lines
      ? `\n【近7日实际发布数据参考】（基于此优先选择高互动潜力话题）\n${lines}\n`
      : '';
  } catch {
    return '';
  }
}

/**
 * 构建选题生成 Prompt
 * @param {string[]} recentKeywords - 近 7 日已使用的关键词列表（用于去重）
 * @param {Array<{topic_keyword: string, heat_score: number}>} highPerformingTopics - 历史高热话题（正向参考）
 * @param {string} [hotspotContext] - 垂类热点上下文（由 buildHotspotContext 生成）
 * @param {string} [roiContext] - 近7日ROI数据上下文（由 get7DayROIContext 生成）
 * @returns {string}
 */
function buildTopicPrompt(recentKeywords = [], highPerformingTopics = [], hotspotContext = '', roiContext = '') {
  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const recentList = recentKeywords.length > 0
    ? recentKeywords.map(k => `- ${k}`).join('\n')
    : '（暂无历史记录）';

  const highHeatSection = highPerformingTopics.length > 0
    ? `\n【有实证的高热话题方向】（过去4周实际获得高互动，可参考延伸，不要照搬）\n${highPerformingTopics.map(t => `- ${t.topic_keyword}（热度 ${t.heat_score.toFixed(0)} 分）`).join('\n')}\n`
    : '';

  return `你是一位专注于"一人公司/个人IP/AI能力放大"领域的内容策划师。

今天是 ${today}，请为以下账号生成今日内容选题建议。

【账号品牌定位】
核心理念：${BRAND_VOICE}
目标受众：${TARGET_AUDIENCE}
核心关键词：${BRAND_KEYWORDS.join('、')}
禁用词汇：${BRAND_BANNED.join('、')}

【近 7 日已用选题】（请避免重复或相似的主题）
${recentList}
${highHeatSection}${roiContext}${hotspotContext}
【任务要求】
请生成 ${TARGET_TOPIC_COUNT} 个内容选题，每个选题必须：
1. 与"一人公司/AI能力放大/小组织效能"主题强相关
2. 有明确的目标受众痛点或收益点
3. 不使用禁用词汇
4. 与近期历史选题不重复

【输出格式】
严格输出 JSON 数组，不要有任何其他文字，格式如下：
[
  {
    "keyword": "选题核心关键词（5-10字）",
    "content_type": "solo-company-case",
    "title_candidates": ["标题备选1", "标题备选2", "标题备选3"],
    "hook": "开头钩子文案，不超过50字，第一句话就要抓住读者",
    "why_hot": "选题理由：说明为什么现在这个话题有共鸣，与账号画像的匹配点",
    "priority_score": 0.85
  }
]

输出 ${TARGET_TOPIC_COUNT} 个选题，priority_score 根据共鸣度、及时性、账号匹配度综合评分（0-1）。`;
}

// ─── 主函数 ──────────────────────────────────────────────────────────────────

/**
 * 生成每日内容选题
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池（用于查询历史选题）
 * @returns {Promise<Array<{keyword, content_type, title_candidates, hook, why_hot, priority_score}>>}
 */
export async function generateTopics(pool) {
  const [recentKeywords, highPerformingTopics, hotspotContext, roiContext] = await Promise.all([
    getRecentKeywords(pool),
    getHighPerformingTopics(pool).catch(() => []),
    buildHotspotContext(),
    get7DayROIContext(pool).catch(() => ''),
  ]);
  const prompt = buildTopicPrompt(recentKeywords, highPerformingTopics, hotspotContext, roiContext);

  const { text } = await callLLM('cortex', prompt, {
    maxTokens: 2048,
    timeout: 60000,
  });

  const topics = parseTopicsJson(text);
  if (!topics || topics.length === 0) {
    console.warn('[topic-selector] LLM 返回无法解析的内容，返回空数组');
    return [];
  }

  return topics
    .sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0))
    .slice(0, TARGET_TOPIC_COUNT)
    .map(normalizeTopicItem);
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 查询近 7 日已使用的关键词
 * @param {import('pg').Pool} pool
 * @returns {Promise<string[]>}
 */
async function getRecentKeywords(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT keyword FROM topic_selection_log
       WHERE selected_date >= CURRENT_DATE - INTERVAL '7 days'
       ORDER BY selected_date DESC
       LIMIT 50`
    );
    return rows.map(r => r.keyword);
  } catch {
    return [];
  }
}

/**
 * 从 LLM 输出文本中解析 JSON 数组
 * @param {string} text
 * @returns {Array|null}
 */
function parseTopicsJson(text) {
  if (!text) return null;

  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }

  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try {
      const parsed = JSON.parse(codeBlock[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
  }

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * 标准化单个选题对象，确保必填字段存在且合法
 * @param {object} item
 * @returns {object}
 */
function normalizeTopicItem(item) {
  return {
    keyword: String(item.keyword || '').trim().substring(0, 50),
    content_type: AVAILABLE_CONTENT_TYPES.includes(item.content_type)
      ? item.content_type
      : AVAILABLE_CONTENT_TYPES[0],
    title_candidates: Array.isArray(item.title_candidates)
      ? item.title_candidates.slice(0, 3).map(t => String(t).substring(0, 50))
      : [],
    hook: String(item.hook || '').substring(0, 100),
    why_hot: String(item.why_hot || '').substring(0, 200),
    priority_score: Math.min(1, Math.max(0, Number(item.priority_score) || 0.5)),
  };
}
