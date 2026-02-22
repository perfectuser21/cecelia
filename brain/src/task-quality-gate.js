/**
 * Task Quality Gate - 任务描述质量门控
 *
 * 验证拆解产出的 task description 是否足够具体，
 * 防止模糊描述的任务进入队列浪费执行资源。
 *
 * 最低要求：
 *   1. description >= 100 字符
 *   2. 包含至少一个行动关键词（文件/修改/实现/设计/测试/创建/添加/删除/修复）
 *
 * 触发位置：decomposition-checker.js createDecompositionTask()
 */

/** 行动关键词列表（中文 + 英文） */
const ACTION_KEYWORDS = [
  // 中文
  '文件', '修改', '实现', '设计', '测试', '创建', '添加', '删除', '修复',
  '重构', '优化', '配置', '部署', '迁移', '集成', '验证', '分析', '调研',
  '拆解', '拆分', '补充', '扩展', '升级',
  // 英文
  'file', 'modify', 'implement', 'design', 'test', 'create', 'add', 'delete', 'fix',
  'refactor', 'optimize', 'configure', 'deploy', 'migrate', 'integrate', 'verify',
  'API', 'endpoint', 'migration', 'schema',
];

/** 最低描述长度 */
const MIN_DESCRIPTION_LENGTH = 100;

/**
 * 验证任务描述质量。
 *
 * @param {string} description - 任务描述
 * @returns {{ valid: boolean, reasons: string[] }} 验证结果
 */
export function validateTaskDescription(description) {
  const reasons = [];

  if (!description || typeof description !== 'string') {
    return { valid: false, reasons: ['description 为空或非字符串'] };
  }

  // 检查长度
  if (description.length < MIN_DESCRIPTION_LENGTH) {
    reasons.push(`description 长度 ${description.length} < 最低 ${MIN_DESCRIPTION_LENGTH} 字符`);
  }

  // 检查是否包含行动关键词
  const lowerDesc = description.toLowerCase();
  const hasActionKeyword = ACTION_KEYWORDS.some(kw => lowerDesc.includes(kw.toLowerCase()));
  if (!hasActionKeyword) {
    reasons.push('description 缺少行动关键词（如：文件/修改/实现/设计/测试/创建/API 等）');
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

export { MIN_DESCRIPTION_LENGTH, ACTION_KEYWORDS };
