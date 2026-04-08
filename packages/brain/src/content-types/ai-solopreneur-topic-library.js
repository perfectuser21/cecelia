/**
 * ai-solopreneur-topic-library.js
 *
 * 「AI一人公司」精选主题库。
 * 包含 30+ 个精选关键词，覆盖：成功人物案例、商业模式、AI工具应用、
 * 副业赛道、效率方法论等方向。
 *
 * 用途：作为 topic-selection-scheduler 的种子词库，
 * 每日随机抽取若干关键词注入 LLM 选题 Prompt，保证内容质量和方向一致性。
 *
 * 更新策略：每季度人工审核一次，补充新兴案例，移除过时内容。
 */

/**
 * AI一人公司主题关键词库
 * 分类：人物案例 / 商业模式 / AI工具 / 副业赛道 / 方法论
 */
export const AI_SOLOPRENEUR_TOPICS = [
  // ─── 成功人物案例 ───────────────────────────────────────────
  { keyword: 'Justin Welsh 一人公司月入百万',      category: 'case', content_type: 'solo-company-case' },
  { keyword: '李继刚 AI创作独立创业',               category: 'case', content_type: 'solo-company-case' },
  { keyword: 'Pieter Levels 独立开发者月入50万',    category: 'case', content_type: 'solo-company-case' },
  { keyword: 'Dan Koe 数字创作者一人公司',           category: 'case', content_type: 'solo-company-case' },
  { keyword: '中国独立博主AI辅助年入百万',           category: 'case', content_type: 'solo-company-case' },
  { keyword: 'Sahil Lavingia 独立创业零员工',        category: 'case', content_type: 'solo-company-case' },
  { keyword: 'Naval Ravikant 个人杠杆理论实践',      category: 'case', content_type: 'solo-company-case' },
  { keyword: '国内副业博主AI工具月入3万',            category: 'case', content_type: 'solo-company-case' },

  // ─── 商业模式 ───────────────────────────────────────────────
  { keyword: 'AI驱动的数字产品被动收入',             category: 'business', content_type: 'ai-tools-review' },
  { keyword: '知识IP变现一人公司路径',               category: 'business', content_type: 'solo-company-case' },
  { keyword: 'SaaS工具一人独立开发到盈利',           category: 'business', content_type: 'solo-company-case' },
  { keyword: 'Newsletter订阅制一人媒体',             category: 'business', content_type: 'solo-company-case' },
  { keyword: '在线课程一人公司年收入百万',           category: 'business', content_type: 'solo-company-case' },
  { keyword: 'AI辅助咨询服务一人接单百万',           category: 'business', content_type: 'ai-workflow-guide' },
  { keyword: '数字产品+内容矩阵复利增长',            category: 'business', content_type: 'solo-company-case' },

  // ─── AI工具应用 ─────────────────────────────────────────────
  { keyword: 'Claude API 一人公司自动化工作流',      category: 'tools', content_type: 'ai-tools-review' },
  { keyword: 'AI写作工具替代5人内容团队',            category: 'tools', content_type: 'ai-tools-review' },
  { keyword: 'Notion AI 个人知识管理到商业变现',     category: 'tools', content_type: 'ai-tools-review' },
  { keyword: 'AI视频生成工具一人制作全流程',         category: 'tools', content_type: 'ai-tools-review' },
  { keyword: 'Zapier+AI自动化收入流',                category: 'tools', content_type: 'ai-workflow-guide' },
  { keyword: 'Cursor AI编程一人开发产品上线',        category: 'tools', content_type: 'ai-tools-review' },
  { keyword: 'AI客服系统让一人公司服务1000客户',     category: 'tools', content_type: 'ai-workflow-guide' },

  // ─── 副业赛道 ───────────────────────────────────────────────
  { keyword: 'AI提示词工程师副业月入2万',            category: 'side-hustle', content_type: 'ai-workflow-guide' },
  { keyword: '用AI做小红书帮企业代运营',             category: 'side-hustle', content_type: 'ai-workflow-guide' },
  { keyword: 'AI翻译外包副业一人接单',               category: 'side-hustle', content_type: 'ai-workflow-guide' },
  { keyword: 'AI生成短视频内容矩阵副业',             category: 'side-hustle', content_type: 'ai-tools-review' },
  { keyword: 'ChatGPT辅助写作接稿月入过万',         category: 'side-hustle', content_type: 'ai-workflow-guide' },

  // ─── 方法论 ─────────────────────────────────────────────────
  { keyword: '一人公司的能力杠杆系统',               category: 'methodology', content_type: 'solo-company-case' },
  { keyword: 'AI放大个人生产力的底层逻辑',           category: 'methodology', content_type: 'ai-workflow-guide' },
  { keyword: '小组织用AI对抗大公司的方法',           category: 'methodology', content_type: 'solo-company-case' },
  { keyword: '从打工人到一人公司的转型路径',         category: 'methodology', content_type: 'solo-company-case' },
  { keyword: '个人品牌×AI工具=被动收入飞轮',        category: 'methodology', content_type: 'solo-company-case' },
  { keyword: '年收入百万的独立创作者工作系统',       category: 'methodology', content_type: 'solo-company-case' },
];

/**
 * 随机抽取 N 个不重复主题，可按 category 过滤
 *
 * @param {number} n - 抽取数量
 * @param {{ excludeKeywords?: string[], categories?: string[] }} [opts]
 * @returns {Array<{keyword: string, category: string, content_type: string}>}
 */
export function sampleTopics(n = 5, opts = {}) {
  const { excludeKeywords = [], categories = [] } = opts;

  let pool = AI_SOLOPRENEUR_TOPICS;

  if (categories.length > 0) {
    pool = pool.filter(t => categories.includes(t.category));
  }

  if (excludeKeywords.length > 0) {
    pool = pool.filter(t => !excludeKeywords.some(ex =>
      t.keyword.includes(ex) || ex.includes(t.keyword.substring(0, 4))
    ));
  }

  // Fisher-Yates shuffle，取前 n 个
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.slice(0, Math.min(n, arr.length));
}
