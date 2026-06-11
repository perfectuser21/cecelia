/**
 * Notion DB 属性名映射（2026-06-11 实查）
 * 集中管理各 DB 的合法属性名清单，统一 stripUnknownProperties 剔除+warn 策略。
 */

// AI Notes DB: 185c40c2-ba63-828c-973f-81a9c4582cd6
// Tasks DB:    d5bc40c2-ba63-82ef-965a-8153b7ad81a0
// Step Links:  369c40c2-ba63-81e2-b95a-e5e3d0592676
export const NOTION_PROPERTY_MAP = {
  aiNotes: {
    dbId: '185c40c2-ba63-828c-973f-81a9c4582cd6',
    allowedKeys: ['Title', 'Type', 'Date'],
  },
  notionTask: {
    dbId: 'd5bc40c2-ba63-82ef-965a-8153b7ad81a0',
    // Status intentionally omitted — Bug 2 回归防护
    allowedKeys: ['Name', 'Project'],
  },
  stepLinks: {
    dbId: '369c40c2-ba63-81e2-b95a-e5e3d0592676',
    allowedKeys: ['Name', 'Status', 'Journey', 'Step', 'Phase', 'Notes'],
  },
};

/**
 * 从 properties 对象中剔除不在 allowedKeys 白名单里的属性，
 * 返回 { props, warnings }。
 * @param {object} properties - Notion properties payload
 * @param {string[]} allowedKeys - 合法属性名白名单
 * @returns {{ props: object, warnings: string[] }}
 */
export function stripUnknownProperties(properties, allowedKeys) {
  const props = {};
  const warnings = [];
  for (const [key, value] of Object.entries(properties)) {
    if (allowedKeys.includes(key)) {
      props[key] = value;
    } else {
      warnings.push(`skip: '${key}' not in schema (allowed: ${allowedKeys.join(', ')})`);
    }
  }
  return { props, warnings };
}
