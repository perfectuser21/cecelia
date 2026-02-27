/**
 * Memory Utils - 记忆工具函数
 *
 * 轻量工具，无外部依赖，供 memory-retriever / learning / reflection 共用。
 * 独立文件避免循环依赖。
 */

/**
 * 生成 L0 摘要：取 content 前 100 字符作为快速过滤摘要
 * @param {string} content
 * @returns {string} 最多 100 字符的摘要
 */
export function generateL0Summary(content) {
  if (!content) return '';
  return content.replace(/\s+/g, ' ').trim().slice(0, 100);
}
