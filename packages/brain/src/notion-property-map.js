/**
 * Notion DB 属性映射表 — 2026-06-11 实查
 *
 * 来源：Notion API GET /databases/:id 返回的 properties 字段
 * 任何 Notion schema 变更 → 只需改这一个文件
 */

// DB ID → 已知属性 key 白名单
export const NOTION_PROPERTY_MAP = {
  // AI Notes DB（185c40c2-ba63-828c-973f-81a9c4582cd6）
  // 实查属性：Title(title), Type(select), Date(date) — 无 Initiative ID
  aiNotes: {
    dbId: '185c40c2-ba63-828c-973f-81a9c4582cd6',
    allowedKeys: ['Title', 'Type', 'Date'],
  },

  // Tasks DB（d5bc40c2-ba63-82ef-965a-8153b7ad81a0）
  // 实查属性：Name(title), Project(relation) — 注意 title 属性名是 Name 不是 Title
  // Status(status) 存在于 DB schema 但不通过 API 写入（防 Bug 2 回归）
  notionTask: {
    dbId: 'd5bc40c2-ba63-82ef-965a-8153b7ad81a0',
    allowedKeys: ['Name', 'Project'],
  },

  // Step Links DB（369c40c2-ba63-81e2-b95a-e5e3d0592676）
  // 实查属性：Name(title), Status(select), Journey(relation), Step(relation), Phase(select), Notes(rich_text)
  // Order 属性已于 2026-06-10 重构时移除
  stepLinks: {
    dbId: '369c40c2-ba63-81e2-b95a-e5e3d0592676',
    allowedKeys: ['Name', 'Status', 'Journey', 'Step', 'Phase', 'Notes'],
  },
};

/**
 * 从 Notion properties 对象中剔除不在白名单内的属性，返回剔除结果和 warnings。
 *
 * @param {Record<string, any>} properties - 原始 Notion properties 对象
 * @param {string[]} allowedKeys - 允许的属性 key 列表
 * @returns {{ props: Record<string, any>, warnings: string[] }}
 */
export function stripUnknownProperties(properties, allowedKeys) {
  const props = {};
  const warnings = [];

  for (const [key, value] of Object.entries(properties)) {
    if (allowedKeys.includes(key)) {
      props[key] = value;
    } else {
      warnings.push(`skip unknown property: "${key}" (not in schema)`);
    }
  }

  return { props, warnings };
}
