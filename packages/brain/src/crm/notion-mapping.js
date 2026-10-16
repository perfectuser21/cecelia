function invalid() { throw Object.assign(new Error('CRM Notion schema mismatch'), { code: 'invalid_schema' }); }
const text = items => (items ?? []).map(x => x.plain_text ?? x.text?.content ?? '').join('');
export const DEFAULT_FIELDS = Object.freeze({
  name: '客户名称', customer_id: '客户ID', profile: null,
  manual: { notes: '人工备注', summary: '客户摘要', requirement: '核心需求', concern: '当前顾虑', next_action: '下一步动作' },
});
export function fieldConfig(binding) { return { ...DEFAULT_FIELDS, ...binding.fields }; }

function valueOf(property, type) {
  if (!property || property.type !== type) invalid();
  if (['title', 'rich_text'].includes(type)) return text(property[type]);
  if (type === 'select') return property.select?.name ?? null;
  if (type === 'number' || type === 'checkbox') return property[type];
  if (type === 'date') return property.date?.start ?? null;
  invalid();
}
export function parseCustomerPage(page, binding) {
  const fields = fieldConfig(binding), props = page.properties ?? {};
  if (!page.id || !Number.isFinite(Date.parse(page.last_edited_time))) invalid();
  const display_name = valueOf(props[fields.name], 'title').trim();
  if (!display_name) invalid();
  const manual_fields = {};
  for (const [key, descriptor] of Object.entries(fields.manual ?? {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) invalid();
    const { property, type } = typeof descriptor === 'string'
      ? { property: descriptor, type: 'rich_text' } : descriptor;
    if (props[property] !== undefined) manual_fields[key] = valueOf(props[property], type);
  }
  return {
    page_id: page.id, display_name, manual_fields,
    external_customer_id: props[fields.customer_id] ? (valueOf(props[fields.customer_id], 'rich_text').trim() || null) : undefined,
    source_edited_at: page.last_edited_time, source_archived: page.in_trash === true,
  };
}
function richText(content) {
  if (typeof content !== 'string' || content.length > 100000) invalid();
  const chunks = content.match(/[\s\S]{1,2000}/gu) ?? [''];
  return { rich_text: chunks.map(value => ({ type: 'text', text: { content: value } })) };
}
export function buildCustomerProperties(customer, binding) {
  const fields = fieldConfig(binding), properties = {};
  if (fields.profile && customer.profile_managed === true) properties[fields.profile] = richText(customer.profile_markdown);
  if (fields.brain_id) properties[fields.brain_id] = richText(customer.id);
  return properties;
}
export function parseRelatedPage(page, fields, customerPageId) {
  const relation = page.properties?.[fields.customer_relation];
  if (relation?.type !== 'relation' || relation.has_more || relation.relation.length !== 1 ||
      relation.relation[0].id.replaceAll('-', '') !== customerPageId.replaceAll('-', '')) invalid();
  return page;
}

export function validateCustomerSchema(schema, binding) {
  const fields = fieldConfig(binding), props = schema.properties ?? {};
  if (props[fields.name]?.type !== 'title') invalid();
  for (const key of ['customer_id', 'profile', 'brain_id']) {
    if (fields[key] && props[fields[key]]?.type !== 'rich_text') invalid();
  }
  const used = [fields.name, fields.customer_id, fields.profile, fields.brain_id].filter(Boolean);
  for (const descriptor of Object.values(fields.manual ?? {})) {
    const { property, type } = typeof descriptor === 'string' ? { property: descriptor, type: 'rich_text' } : descriptor;
    if (!['rich_text', 'select', 'number', 'checkbox', 'date'].includes(type) || props[property]?.type !== type) invalid();
    used.push(property);
  }
  if (new Set(used).size !== used.length) invalid();
}
