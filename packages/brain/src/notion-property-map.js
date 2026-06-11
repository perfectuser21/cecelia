// Notion DB 属性映射常量（2026-06-10 查询日期）
// 用于三处 Notion 推送端点的属性过滤，防止旧属性名导致 400

export const NOTION_PROPERTY_MAP = {
  // AI Notes DB (185c40c2-ba63-828c-973f-81a9c4582cd6)
  // 查询日期: 2026-06-10，当前属性: Title, Type, Date
  aiNotes: {
    allowedKeys: ['Title', 'Type', 'Date'],
  },

  // Tasks DB (d5bc40c2-ba63-82ef-965a-8153b7ad81a0)
  // 查询日期: 2026-06-10，Title 已重命名为 Name；Status 不是 property（写入 children）
  notionTask: {
    allowedKeys: ['Name', 'Area', 'Journey', 'Sprint'],
    // 注意: Status 不在此列表（Bug 2 保护 — Status 只能写入 page children, 不是 DB property）
  },

  // Step Links DB (369c40c2-ba63-81e2-b95a-e5e3d0592676)
  // 查询日期: 2026-06-10，Order 属性已删除
  stepLinks: {
    allowedKeys: ['Name', 'Status', 'Journey', 'Step'],
  },
};

/**
 * 从 Notion properties 对象中剔除未知属性，返回清理后的属性和警告列表。
 *
 * @param {Record<string, unknown>} properties - 待推送的 Notion properties 对象
 * @param {string[]} allowedKeys - 该 DB 允许的属性名列表
 * @returns {{ props: Record<string, unknown>, warnings: string[] }}
 */
export function stripUnknownProperties(properties, allowedKeys) {
  const props = {};
  const warnings = [];

  for (const [key, value] of Object.entries(properties)) {
    if (allowedKeys.includes(key)) {
      props[key] = value;
    } else {
      warnings.push(`${key} skipped: not in schema`);
    }
  }

  return { props, warnings };
}
