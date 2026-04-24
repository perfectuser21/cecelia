/**
 * strategy-session-parser.js
 *
 * 解析 /strategy-session skill 产出的 JSON 块。
 * 输入：execution output 字符串
 * 输出：{ meeting_summary, key_tensions, krs } 或 null（解析失败）
 */

/**
 * 从 execution output 中提取并解析 strategy_session JSON 块。
 *
 * 支持两种格式：
 * 1. ```json ... ``` 代码块
 * 2. 整个 output 直接是 JSON
 *
 * @param {string} output - execution 产出字符串
 * @returns {{ meeting_summary: string, key_tensions: string[], krs: Array<{title: string, domain?: string, priority?: string}> } | null}
 */
export function parseStrategySessionOutput(output) {
  if (!output || typeof output !== 'string') return null;

  // 尝试匹配 ```json ... ``` 块
  const jsonBlockMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      if (parsed && typeof parsed === 'object') {
        return normalizeOutput(parsed);
      }
    } catch {
      // JSON 解析失败，继续尝试其他方式
    }
  }

  // 尝试直接解析整个 output 作为 JSON
  try {
    const parsed = JSON.parse(output.trim());
    if (parsed && typeof parsed === 'object' && (parsed.krs !== undefined || parsed.meeting_summary !== undefined)) {
      return normalizeOutput(parsed);
    }
  } catch {
    // 非 JSON 格式
  }

  return null;
}

/**
 * 标准化解析结果，确保字段类型正确。
 * @param {object} parsed
 * @returns {{ meeting_summary: string, key_tensions: string[], krs: Array }}
 */
function normalizeOutput(parsed) {
  return {
    meeting_summary: typeof parsed.meeting_summary === 'string' ? parsed.meeting_summary : '',
    key_tensions: Array.isArray(parsed.key_tensions) ? parsed.key_tensions : [],
    krs: Array.isArray(parsed.krs) ? parsed.krs : [],
  };
}
