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
 * 需要明确指定执行位置（location 字段）的任务类型。
 * 这些类型依赖外部执行节点，未指定 location 时容易路由到不可用节点后无限重试。
 */
const LOCATION_REQUIRED_TASK_TYPES = ['codex_dev', 'arch_review', 'architecture_design', 'architecture_scan'];

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

/**
 * 验证任务执行环境依赖（拆分标准检查）。
 *
 * codex_dev / arch_review 等类型依赖外部执行节点，拆解时必须明确指定执行位置，
 * 否则路由到不可用节点后会进入 repeated_failure 死循环。
 * 根因来自 2025-05-16 任务失败分析（task 76effb76 / 3b81416b）。
 *
 * @param {{ task_type?: string, location?: string, payload?: object }} task
 * @returns {{ valid: boolean, reasons: string[] }}
 */
export function validateExecutionDependencies(task) {
  const reasons = [];
  if (!task || typeof task !== 'object') return { valid: true, reasons: [] };

  const taskType = task.task_type || '';
  if (LOCATION_REQUIRED_TASK_TYPES.includes(taskType)) {
    const location = task.location || task.payload?.location;
    if (!location) {
      reasons.push(
        `task_type=${taskType} 需要明确指定 location 字段（如 xian/local），` +
        '未指定时路由失败将导致 repeated_failure 死循环'
      );
    }
  }

  return { valid: reasons.length === 0, reasons };
}

export { MIN_DESCRIPTION_LENGTH, ACTION_KEYWORDS, LOCATION_REQUIRED_TASK_TYPES };
