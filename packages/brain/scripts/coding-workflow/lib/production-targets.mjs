// 共享预览桥的生产地址限制；与自主 coding 工作流无关。
export const PRODUCTION_TARGET_RE = /:5221\b|\b(?:localhost|127\.0\.0\.1)\s+5221\b|100\.79\.41\.61|\bus-vps\b/;
export const PRODUCTION_ASSIGN_RE = /\b[A-Za-z_][A-Za-z0-9_]*=['"]?\S*(?::5221\b|100\.79\.41\.61|\bus-vps\b)/;

export function productionMatchers(patterns = null) {
  if (!Array.isArray(patterns) || patterns.length === 0) return { target: PRODUCTION_TARGET_RE, assign: PRODUCTION_ASSIGN_RE };
  const alt = patterns.join('|');
  return { target: new RegExp(alt), assign: new RegExp(`\\b[A-Za-z_][A-Za-z0-9_]*=['"]?\\S*(?:${alt})`) };
}
