/** 从 LLM 输出文本提取首个 JSON 对象；纯 JSON / 夹杂文字均可；解析失败或非对象返回 null。 */
export function extractJsonObject(text) {
  try { const p = JSON.parse(text); if (p && typeof p === 'object' && !Array.isArray(p)) return p; } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}
