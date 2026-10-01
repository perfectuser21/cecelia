import { notionReq as defaultNotionReq } from '../recurring-notion-sync.js';
import { COMPANY_GOAL_DATABASE, COMPANY_KR_DATABASE, COMPANY_KR_CATALOG, COMPANY_FORMULA, companyKrView, rawDecimal } from '../lib/company-kr-metrics.js';

export const configuredCompanyToken = () => process.env.NOTION_API_KEY || process.env.NOTION_API_TOKEN || process.env.NOTION_INBOX_TOKEN;
export const COMPANY_AI_PROPERTIES = { 'AI建议': { rich_text: {} }, 'AI观测值': { number: {} }, 'AI建议目标': { number: {} }, 'AI建议当前': { number: {} }, 'AI分析时间': { date: {} }, 'AI分析状态': { rich_text: {} }, Unit: { rich_text: {} } };
const text = p => (p?.title || p?.rich_text || []).map(v => v.plain_text ?? v.text?.content ?? '').join('');
const areas = p => (p?.Area?.relation || []).map(v => v.id).sort();
const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.replaceAll('-', '').toLowerCase() === b.replaceAll('-', '').toLowerCase();
export function companyPageBelongs(page) { return sameId(page.parent?.database_id, COMPANY_KR_DATABASE); }

/** 完整分页后才给complete；新空行与无效Goal独立反馈。 */
export async function readCompanySnapshot({ token = configuredCompanyToken(), notionReq = defaultNotionReq } = {}) {
  if (!token) throw new Error('Notion token未配置');
  const schema = await notionReq(token, `/databases/${COMPANY_KR_DATABASE}`, 'GET');
  const fields = { Name: 'title', Current: 'number', Target: 'number', Start: 'number', Progress: 'formula', Goal: 'relation', Area: 'relation', Status: 'status' };
  for (const [name, type] of Object.entries(fields)) if (schema.properties?.[name]?.type !== type) throw new Error(`公司库列类型不符:${name}`);
  if (schema.properties.Progress.formula?.expression?.replace(/\s/g, '') !== COMPANY_FORMULA.replace(/\s/g, '')) throw new Error('公司原公式发生变化，拒绝另算口径');
  const pages = [], cursors = new Set(); let cursor;
  do {
    const result = await notionReq(token, `/databases/${COMPANY_KR_DATABASE}/query`, 'POST', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    if (!Array.isArray(result.results)) throw new Error('公司库快照不完整');
    pages.push(...result.results);
    if (result.has_more && (!result.next_cursor || cursors.has(result.next_cursor))) throw new Error('公司库分页不完整');
    cursor = result.has_more ? result.next_cursor : null;
    if (cursor) cursors.add(cursor);
  } while (cursor);
  if (new Set(pages.map(p => p.id)).size !== pages.length) throw new Error('公司库sourcepage重复');
  const records = [], goals = new Map(), errors = [];
  for (const page of pages) {
    if (!companyPageBelongs(page)) throw new Error('公司页来源库归属不符');
    if (page.archived || page.in_trash) continue;
    try {
      const p = page.properties;
      if (p.Goal?.relation?.length !== 1 || p.Goal?.has_more || p.Area?.has_more) throw new Error('待补充完整Goal与Area来源');
      const goalId = p.Goal.relation[0].id;
      if (!goals.has(goalId)) {
        const goal = await notionReq(token, `/pages/${goalId}`, 'GET');
        if (!sameId(goal.parent?.database_id, COMPANY_GOAL_DATABASE)) throw new Error('Goal来源库归属不符');
        if (goal.archived || goal.in_trash || goal.properties?.Area?.has_more) throw new Error('Goal来源不可用');
        goals.set(goalId, { page_id: goalId, database_id: COMPANY_GOAL_DATABASE, title: text(goal.properties.Name), area_ids: areas(goal.properties), status: goal.properties.Status?.status?.name ?? null });
      }
      const seed = COMPANY_KR_CATALOG.find(c => sameId(c.page_id, page.id));
      const unit = seed?.unit || text(p.Unit).trim();
      if (!unit) throw new Error('待填写Unit单位口径');
      if (!text(p.Name).trim()) throw new Error('待填写KR名称');
      if ([p.Start?.number, p.Current?.number, p.Target?.number].some(v => rawDecimal(v) === null)) throw new Error('待填写正式Start/Current/Target');
      records.push({ page_id: page.id, database_id: COMPANY_KR_DATABASE, title: text(p.Name), goal_id: goalId, area_ids: areas(p), unit,
        start: p.Start.number, current: p.Current.number, target: p.Target.number, status: p.Status.status?.name ?? null,
        updated_at: page.last_edited_time, editor: page.last_edited_by?.id ?? null, properties: p });
    } catch (error) { errors.push({ page_id: page.id, error: error.message, properties: page.properties }); }
  }
  return { records, goals: [...goals.values()], errors, pages, schema, complete: true };
}

export async function ensureCompanyAiSchema(token, notionReq, schema) {
  const missing = {};
  for (const [name, spec] of Object.entries(COMPANY_AI_PROPERTIES)) {
    const existing = schema.properties?.[name];
    if (existing && existing.type !== Object.keys(spec)[0]) throw new Error(`公司AI列类型不符:${name}`);
    if (!existing) missing[name] = spec;
  }
  if (Object.keys(missing).length) await notionReq(token, `/databases/${COMPANY_KR_DATABASE}`, 'PATCH', { properties: missing });
}

const rich = value => ({ rich_text: value ? [{ text: { content: value.slice(0, 1900) } }] : [] });
export function companyAiProperties(kr) {
  const view = companyKrView(kr), a = view.advice, analysis = view.analysis;
  let status = a ? (a.stale ? '建议已过期：正式值已更新' : '待主理人决定') : '尚无分析';
  if (analysis?.status === 'failed') status = `分析失败：${analysis.error || '请查看任务回执'}`;
  else if (['queued', 'in_progress', 'stale'].includes(analysis?.status)) status = { queued: '分析排队中', in_progress: '分析中', stale: '建议已过期：正式值已更新' }[analysis.status];
  else if (!a && ['completed', 'completed_no_pr'].includes(analysis?.status)) status = '分析完成，尚无有效建议';
  if (a?.stale) status = '建议已过期：正式值已更新';
  if (!view.active) status = '已暂停或完成：停止分析';
  if (view.sync_error) status = `同步待处理：${view.sync_error.reason}`;
  const summary = a ? `${a.stale ? '【已过期】\n' : ''}${a.reason}\n${(a.evidence || []).map(e => `${e.fact}（${e.source}）`).join('\n')}\n正式版本：${a.formal_revision}` : '';
  return { 'AI建议': rich(summary), 'AI观测值': { number: view.observation?.current_value == null ? null : Number(view.observation.current_value) },
    'AI建议目标': { number: a?.suggested_target == null ? null : Number(a.suggested_target) },
    'AI建议当前': { number: a?.suggested_current == null ? null : Number(a.suggested_current) },
    'AI分析时间': { date: a?.analyzed_at ? { start: a.analyzed_at } : null }, 'AI分析状态': rich(status) };
}

function comparable(property) {
  if ('rich_text' in property) return text(property);
  if ('number' in property) return property.number;
  if ('date' in property) return property.date?.start ? Date.parse(property.date.start) : null;
  return null;
}
export async function projectCompanyAi(token, notionReq, pageId, before, properties) {
  const changed = Object.fromEntries(Object.entries(properties).filter(([key, value]) => !before?.[key] || comparable(before[key]) !== comparable(value)));
  if (!Object.keys(changed).length) return false;
  await notionReq(token, `/pages/${pageId}`, 'PATCH', { properties: changed });
  return true;
}
export const companySyncErrorProperties = error => ({ 'AI分析状态': rich(`同步待处理：${error}`) });
