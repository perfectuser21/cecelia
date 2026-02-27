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

/**
 * 异步生成 L1 结构化摘要并写入 memory_stream（fire-and-forget）
 *
 * L1 格式（200-300字）：
 *   **核心事实**：[1-2句关键信息]
 *   **背景场景**：[触发场景或时间]
 *   **关键判断**：[这条记忆说明了什么]
 *   **相关实体**：[涉及的人/系统/任务]
 *
 * 调用方式：fire-and-forget，不 await，不阻塞主流程。
 *
 * @param {number|string} recordId - memory_stream.id
 * @param {string} content - 记忆全文（L2）
 * @param {import('pg').Pool} pool - pg Pool
 * @returns {void}
 */
export function generateMemoryStreamL1Async(recordId, content, pool) {
  if (!recordId || !content || !pool) return;

  Promise.resolve().then(async () => {
    try {
      const { callLLM } = await import('./llm-caller.js');

      const prompt = `你是 Cecelia 的记忆整理系统。请将以下记忆内容提炼为结构化 L1 摘要（200字以内）。

记忆内容：
${content.slice(0, 1500)}

请严格按照以下格式输出，每项一行：
**核心事实**：[1-2句最关键的信息]
**背景场景**：[这条记忆发生的场景或触发条件]
**关键判断**：[这条记忆说明了什么，对决策有何意义]
**相关实体**：[涉及的人/系统/任务名称]

要求：简洁、结构化、不超过200字。`;

      const result = await callLLM('memory', prompt, {
        timeout: 30000,
        maxTokens: 300,
      });

      if (!result?.text) return;

      await pool.query(
        'UPDATE memory_stream SET l1_content = $1 WHERE id = $2',
        [result.text.trim(), recordId]
      );
    } catch (err) {
      console.warn(`[memory-utils] L1 generation failed for record ${recordId}:`, err.message);
    }
  });
}
