import { validateCrmMarkdown } from './markdown.js';
/** Immutable CRM communications are projected only to explicitly configured existing sources. */
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function fault(code) { return Object.assign(new Error(`CRM children: ${code}`), { code }); }
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) throw fault('invalid_input'); return value.toLowerCase(); }
const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.replaceAll('-', '').toLowerCase() === b.replaceAll('-', '').toLowerCase();
const plain = values => (values ?? []).map(value => value.plain_text ?? value.text?.content ?? '').join('');
const EXTRA_TYPES = { report_type: 'select', period_start: 'date', period_end: 'date', direction: 'select', source_account: 'rich_text', native_id: 'rich_text' };
const extras = config => Object.entries(EXTRA_TYPES).filter(([key]) => config?.[key] !== undefined);
function configFor(binding, name) {
  const config = binding.fields?.[name];
  if (config === undefined || config === null) return null;
  uuid(config.data_source_id);
  const keys = name === 'messages' ? ['direction', 'source_account', 'native_id'] : ['report_type', 'period_start', 'period_end'];
  if (extras(config).some(([key]) => !keys.includes(key))) throw fault('invalid_schema');
  const names = [config.id, config.title, config.customer_relation, ...extras(config).map(([key]) => config[key])];
  if (names.some(value => typeof value !== 'string' || !value.trim()) || new Set(names).size !== names.length) throw fault('invalid_schema');
  if (sameId(config.data_source_id, binding.data_source_id)) throw fault('invalid_schema');
  return config;
}
function validateSchema(schema, config, binding) {
  const properties = schema?.properties ?? {};
  if (!sameId(schema?.id, config.data_source_id) || properties[config.id]?.type !== 'rich_text' ||
      properties[config.title]?.type !== 'title' || properties[config.customer_relation]?.type !== 'relation' ||
      !sameId(properties[config.customer_relation]?.relation?.data_source_id, binding.data_source_id)) throw fault('invalid_schema');
  if (extras(config).some(([key, type]) => properties[config[key]]?.type !== type)) throw fault('invalid_schema');
}
function validatePage(page, row, config, customer) {
  const properties = page?.properties ?? {}, relation = properties[config.customer_relation];
  if (!page?.id || !UUID.test(page.id) || page.in_trash || page.archived ||
      !sameId(page.parent?.data_source_id, config.data_source_id) ||
      properties[config.id]?.type !== 'rich_text' || plain(properties[config.id].rich_text) !== row.id ||
      properties[config.title]?.type !== 'title' || relation?.type !== 'relation' || relation.has_more ||
      !Array.isArray(relation.relation) || relation.relation.length !== 1 ||
      !sameId(relation.relation[0].id, customer.source_page_id)) throw fault('external_identity_conflict');
  return page;
}
const rich = content => [{ type: 'text', text: { content } }];
const reportType = value => ({ daily: '日报', weekly: '周报', monthly: '月报' }[value] ?? '进展报告');
function day(value) {
  // pg DATE values are local-midnight calendar dates, not UTC instants.
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw fault('invalid_input');
  if (value instanceof Date) {
    return [parsed.getFullYear(), String(parsed.getMonth() + 1).padStart(2, '0'), String(parsed.getDate()).padStart(2, '0')].join('-');
  }
  return parsed.toISOString().slice(0, 10);
}
function propertiesFor(row, config, customer, kind) {
  const title = `${customer.display_name}｜${kind === 'messages' ? '沟通原文' : `${reportType(row.type)} ${day(row.period_start)}（版本${row.version}）`}`.slice(0, 1900);
  return {
    [config.id]: { rich_text: rich(row.id) },
    [config.title]: { title: rich(title) },
    [config.customer_relation]: { relation: [{ id: customer.source_page_id }] },
    ...extraPropertiesFor(row, config),
  };
}
function extraPropertiesFor(row, config) {
  const values = {
    report_type: () => ({ select: { name: reportType(row.type) } }),
    period_start: () => ({ date: { start: day(row.period_start) } }),
    period_end: () => ({ date: { start: day(row.period_end) } }),
    direction: () => ({ select: { name: row.direction === 'inbound' ? '客户' : '客服' } }),
    source_account: () => ({ rich_text: rich(row.account_id) }),
    native_id: () => ({ rich_text: rich(row.message_id) }),
  };
  return Object.fromEntries(extras(config).map(([key]) => [config[key], values[key]()]));
}
function matchesProperty(actual, expected) {
  const type = Object.keys(expected)[0];
  if (actual?.type !== type) return false;
  if (type === 'rich_text') return plain(actual.rich_text) === plain(expected.rich_text);
  if (type === 'select') return actual.select?.name === expected.select.name;
  if (type === 'date') return actual.date?.start === expected.date.start;
  return false;
}
async function ensureExtraProperties(request, page, row, config, customer) {
  const expected = extraPropertiesFor(row, config);
  const changed = Object.fromEntries(Object.entries(expected).filter(([key, value]) => !matchesProperty(page.properties[key], value)));
  if (Object.keys(changed).length) {
    try { await request(`/pages/${uuid(page.id)}`, 'PATCH', { properties: changed }); }
    catch (error) { if (error.code === 'notion_async_pending') return null; throw error; }
    const updated = await request(`/pages/${uuid(page.id)}`);
    if (!sameId(updated?.id, page.id)) throw fault('external_identity_conflict');
    validatePage(updated, row, config, customer);
    if (Object.entries(expected).some(([key, value]) => !matchesProperty(updated.properties[key], value))) throw fault('projection_readback_mismatch');
  }
  return page.id;
}
function code(value) {
  const content = String(value ?? ''), runs = content.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return `${fence}\n${content}\n${fence}`;
}
function messageMarkdown(row) {
  const direction = { inbound: '客户', outbound: '客服' }[row.direction] ?? '未知';
  const precision = { exact: '准确时间', minute: '精确到分钟', day: '精确到日期', unknown: '时间待核验' }[row.time_precision] ?? '时间待核验';
  return `# 沟通原文\n\n来源微信账号：\n${code(row.account_id)}\n\n方向：${direction}\n\n发生时间：${new Date(row.occurred_at).toISOString()}（${precision}）\n\n## 原始消息\n\n${code(row.text)}\n\n<details>\n<summary>来源依据</summary>\n\n原生消息ID：\n${code(row.message_id)}\n\n</details>`;
}
function reportMarkdown(row, messages) {
  validateCrmMarkdown(row.markdown);
  const refs = (row.message_ids ?? []).map(id => {
    const source = messages.get(id);
    return `- [原始沟通 ${id}](https://www.notion.so/${uuid(source.notion_page_id).replaceAll('-', '')})`;
  });
  return `${row.markdown}\n\n---\n\n报告版本：${row.version}\n\n报告周期：${day(row.period_start)} ～ ${day(row.period_end)}\n\n## 依据原始沟通\n\n${refs.length ? refs.join('\n') : '本报告尚无关联的原始消息。'}`;
}

async function ensurePage(request, row, config, customer, kind, markdown) {
  if (row.notion_page_id) {
    const page = await request(`/pages/${uuid(row.notion_page_id)}`);
    if (!sameId(page?.id, row.notion_page_id)) throw fault('external_identity_conflict');
    validatePage(page, row, config, customer);
    return ensureExtraProperties(request, page, row, config, customer);
  }
  const response = await request(`/data_sources/${uuid(config.data_source_id)}/query`, 'POST', {
    page_size: 2, filter: { property: config.id, rich_text: { equals: row.id } },
  });
  if (!Array.isArray(response?.results) || response.request_status?.type === 'incomplete') throw fault('incomplete_query');
  if (response.results.length > 1 || response.has_more === true) throw fault('duplicate_external_record');
  if (response.has_more !== false) throw fault('incomplete_query');
  let pageId;
  if (response.results.length === 1) {
    // Fetch again: query rows may be stale, incomplete, or later moved by a person.
    pageId = uuid(response.results[0].id);
  } else {
    let created;
    try {
      created = await request('/pages', 'POST', {
        parent: { type: 'data_source_id', data_source_id: config.data_source_id },
        properties: propertiesFor(row, config, customer, kind), markdown,
      });
    } catch (error) {
      if (error.code === 'notion_async_pending') return null;
      throw error;
    }
    if (created?.object === 'async_task' || !created?.id || !UUID.test(created.id)) return null;
    pageId = created.id;
  }
  const page = await request(`/pages/${pageId}`);
  if (!sameId(page?.id, pageId)) throw fault('external_identity_conflict');
  validatePage(page, row, config, customer);
  return ensureExtraProperties(request, page, row, config, customer);
}

export async function projectCustomerChildren(db, store, request, binding, customer) {
  uuid(binding.id); uuid(binding.tenant_id); uuid(binding.data_source_id); uuid(customer.id); uuid(customer.source_page_id);
  if (!sameId(binding.tenant_id, customer.tenant_id) || !sameId(binding.id, customer.binding_id)) throw fault('tenant_mismatch');
  if (typeof request !== 'function') throw fault('invalid_input');
  const configs = { messages: configFor(binding, 'messages'), reports: configFor(binding, 'reports') };
  if (configs.messages && configs.reports && sameId(configs.messages.data_source_id, configs.reports.data_source_id)) throw fault('invalid_schema');
  const messages = await store.listCustomerMessages(db, binding.tenant_id, customer.id);
  const reports = await store.listCustomerReports(db, binding.tenant_id, customer.id);
  for (const row of [...messages, ...reports]) {
    uuid(row.id);
    if (!sameId(row.tenant_id, binding.tenant_id) || !sameId(row.customer_id, customer.id)) throw fault('tenant_mismatch');
  }
  // Validate every configured vessel before creating anything in either source.
  for (const config of Object.values(configs).filter(Boolean)) {
    validateSchema(await request(`/data_sources/${uuid(config.data_source_id)}`), config, binding);
  }
  const result = { messages_projected: 0, reports_projected: 0, deferred: 0 };
  const messageMap = new Map(messages.map(row => [row.id, { ...row }]));
  for (const row of messages) {
    if (row.projection_pending === false && !extras(configs.messages).length) continue;
    if (!configs.messages) { result.deferred++; continue; }
    const pageId = await ensurePage(request, row, configs.messages, customer, 'messages', messageMarkdown(row));
    if (!pageId) { result.deferred++; continue; }
    if (!await store.markMessageProjected(db, binding.tenant_id, row.id, pageId)) { result.deferred++; continue; }
    messageMap.set(row.id, { ...row, notion_page_id: pageId, projection_pending: false });
    result.messages_projected++;
  }
  for (const row of reports) {
    if (row.projection_pending === false && !extras(configs.reports).length) continue;
    if (!configs.reports) { result.deferred++; continue; }
    if (!Array.isArray(row.message_ids) || row.message_ids.some(id => !messageMap.has(id))) throw fault('invalid_report_evidence');
    if (row.message_ids.some(id => !messageMap.get(id).notion_page_id || messageMap.get(id).projection_pending !== false)) { result.deferred++; continue; }
    // A report can link only source pages that have been verified in this run.
    for (const id of row.message_ids) {
      if (!configs.messages) throw fault('invalid_report_evidence');
      await ensurePage(request, messageMap.get(id), configs.messages, customer, 'messages', '');
    }
    const pageId = await ensurePage(request, row, configs.reports, customer, 'reports', reportMarkdown(row, messageMap));
    if (!pageId) { result.deferred++; continue; }
    if (!await store.markReportProjected(db, binding.tenant_id, row.id, pageId)) { result.deferred++; continue; }
    result.reports_projected++;
  }
  return result;
}
