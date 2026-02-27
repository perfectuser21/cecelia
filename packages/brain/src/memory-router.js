/**
 * Memory Router - 记忆路由层
 *
 * 根据对话内容识别意图类型，决定激活哪类记忆：
 *   self_reflection  → episodic memory（memory_stream）优先
 *   task_query       → semantic memory（learnings + tasks）优先
 *   status_check     → recent events 优先
 *   general          → 全类型均衡加载
 *
 * 轻量实现：关键词匹配，不调 LLM，零延迟。
 */

/* global console */

// ============================================================
// 意图类型定义
// ============================================================

export const INTENT_TYPES = {
  SELF_REFLECTION: 'self_reflection', // 你在想什么？你有什么感受？
  TASK_QUERY: 'task_query',           // 任务状态、学习记录、历史经验
  STATUS_CHECK: 'status_check',       // 系统状态、CI、告警
  GENERAL: 'general',                 // 默认
};

/** 意图 → 记忆激活策略 */
export const MEMORY_STRATEGY = {
  [INTENT_TYPES.SELF_REFLECTION]: {
    semantic: false,   // 语义记忆（tasks + learnings）
    episodic: true,    // 片段记忆（memory_stream 反思洞察）
    events: false,     // 近期事件
    episodicBudget: 500,
    semanticBudget: 0,
    eventsBudget: 0,
  },
  [INTENT_TYPES.TASK_QUERY]: {
    semantic: true,
    episodic: true,
    events: false,
    episodicBudget: 200,
    semanticBudget: 600,
    eventsBudget: 0,
  },
  [INTENT_TYPES.STATUS_CHECK]: {
    semantic: false,
    episodic: false,
    events: true,
    episodicBudget: 0,
    semanticBudget: 0,
    eventsBudget: 600,
  },
  [INTENT_TYPES.GENERAL]: {
    semantic: true,
    episodic: true,
    events: true,
    episodicBudget: 250,
    semanticBudget: 400,
    eventsBudget: 150,
  },
};

// ============================================================
// 意图关键词库
// ============================================================

const SELF_REFLECTION_KEYWORDS = [
  '你在想什么', '你有什么感受', '你觉得', '你怎么看', '你的感受',
  '你最近', '你有没有', '你想', '你了解', '你认识',
  '你的想法', '你的状态', '你的记忆', '你记得', '反思', '洞察',
  '你是谁', '你的性格', '你怎么理解', 'self', 'reflection',
];

const TASK_QUERY_KEYWORDS = [
  '任务', '任务状态', '进度', '学过', '学习', '经验', '之前',
  '上次', '历史', '做过', '完成了', '失败', '问题', '怎么解决',
  '怎么做', '有没有类似', '经验', 'PR', 'CI', 'bug', '错误',
  '教训', '记录', '知道怎么', 'task', 'learning',
];

const STATUS_CHECK_KEYWORDS = [
  '状态', '系统', '告警', '监控', '健康', '运行', '当前',
  '现在', '最新', '情况', '怎么样了', '有没有问题', '正常',
  '服务', 'CPU', '内存', 'queue', '队列', 'status', 'health',
];

// ============================================================
// 核心函数
// ============================================================

/**
 * 根据消息内容识别记忆路由意图
 * @param {string} message - 用户消息
 * @param {string} [mode='chat'] - 对话模式
 * @returns {{ intentType: string, strategy: Object }}
 */
export function routeMemory(message, mode = 'chat') {
  if (!message || typeof message !== 'string') {
    return {
      intentType: INTENT_TYPES.GENERAL,
      strategy: MEMORY_STRATEGY[INTENT_TYPES.GENERAL],
    };
  }

  const lower = message.toLowerCase();

  // 按优先级匹配（self_reflection > task_query > status_check > general）
  const scores = {
    [INTENT_TYPES.SELF_REFLECTION]: countKeywords(lower, SELF_REFLECTION_KEYWORDS),
    [INTENT_TYPES.TASK_QUERY]: countKeywords(lower, TASK_QUERY_KEYWORDS),
    [INTENT_TYPES.STATUS_CHECK]: countKeywords(lower, STATUS_CHECK_KEYWORDS),
  };

  const maxScore = Math.max(...Object.values(scores));

  // 无明显意图 → general
  if (maxScore === 0) {
    const intentType = INTENT_TYPES.GENERAL;
    return { intentType, strategy: MEMORY_STRATEGY[intentType] };
  }

  // 取最高分意图
  const intentType = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])[0][0];

  console.log(`[memory-router] intent=${intentType} scores=${JSON.stringify(scores)}`);

  return {
    intentType,
    strategy: MEMORY_STRATEGY[intentType],
  };
}

/**
 * 统计消息中匹配到的关键词数量
 * @param {string} lower - 小写消息
 * @param {string[]} keywords
 * @returns {number}
 */
function countKeywords(lower, keywords) {
  return keywords.reduce((count, kw) => count + (lower.includes(kw.toLowerCase()) ? 1 : 0), 0);
}

export { countKeywords as _countKeywords };
