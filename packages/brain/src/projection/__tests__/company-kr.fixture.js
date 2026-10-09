import { vi } from 'vitest';
import { COMPANY_FORMULA, COMPANY_GOALS, COMPANY_GOAL_DATABASE, COMPANY_KR_CATALOG, COMPANY_KR_DATABASE, companyMetric } from '../../lib/company-kr-metrics.js';

export function fixture() {
  const source = COMPANY_KR_CATALOG[0];
  const task = { id: 'registered-import', result: {} };
  const kr = { id: 'kr', title: source.title, objective_id: 'objective', unit: source.unit, status: 'active', updated_at: '2026-10-01T00:00:00Z', metadata: { metric_mode: 'company_formula_v1', company_metric: companyMetric(0, 1, 5), company_status: 'Open', imported_snapshot: { task_id: task.id }, validation_state: 'unverified' }, custom_props: { company_notion: { page_id: source.page_id, database_id: COMPANY_KR_DATABASE, goal_id: source.goal_id, area_ids: [] } } };
  const page = { id: source.page_id, parent: { database_id: COMPANY_KR_DATABASE }, last_edited_time: '2026-10-01T00:00:00Z', properties: { Name: { title: [{ plain_text: source.title }] }, Goal: { relation: [{ id: source.goal_id }] }, Area: { relation: [] }, Current: { number: 1 }, Target: { number: 5 }, Start: { number: 0 }, Status: { status: { name: 'Open' } } } };
  const rows = [kr], pages = [page]; let lockHeld = false;
  const query = vi.fn(async (sql, args = []) => {
    if (sql.includes('pg_try_advisory_lock')) { const acquired = !lockHeld; if (acquired) lockHeld = true; return { rows: [{ acquired }] }; }
    if (sql.includes('pg_advisory_unlock')) { lockHeld = false; return { rows: [{}] }; }
    if (sql.includes('FROM notion_projection_map')) return { rows: [{ notion_db_id: COMPANY_KR_DATABASE, vessel: 'notion-company-key-results', face: 'inlet' }] };
    if (sql.includes('FROM tasks')) return { rows: [structuredClone(task)] };
    if (sql.includes('FROM objectives')) return { rows: [{ id: 'objective', title: COMPANY_GOALS[0].title, metadata: { source_system: 'notion-company-okr' }, custom_props: { company_notion: { database_id: COMPANY_GOAL_DATABASE } } }] };
    if (sql.includes('FROM key_results')) return { rows: structuredClone(sql.includes('WHERE id=$1') ? rows.filter(r => r.id === args[0]) : rows) };
    if (sql.startsWith('UPDATE tasks')) { task.result = JSON.parse(args[1]); return { rows: [] }; }
    if (sql.startsWith('UPDATE key_results')) {
      const row = rows.find(r => r.id === args[0]);
      for (const value of args) {
        if (typeof value === 'string' && value.startsWith('{')) {
          const obj = JSON.parse(value);
          if (obj.metric_mode) row.metadata = obj;
          if (obj.company_notion) row.custom_props = obj;
        }
      }
      if (sql.includes('title=$2')) { row.title = args[1]; row.status = args[2]; row.unit = args[3]; row.objective_id = args[4]; }
      return { rows: [structuredClone(row)] };
    }
    return { rows: [] };
  });
  const schema = { properties: Object.fromEntries(Object.entries({ Name: 'title', Current: 'number', Target: 'number', Start: 'number', Progress: 'formula', Goal: 'relation', Area: 'relation', Status: 'status' }).map(([key, type]) => [key, { type, ...(key === 'Progress' ? { formula: { expression: COMPANY_FORMULA } } : {}) }])) };
  const notionReq = vi.fn(async (_token, path, method, body) => {
    if (path === `/databases/${COMPANY_KR_DATABASE}`) { if (method === 'PATCH') for (const [key, value] of Object.entries(body.properties)) schema.properties[key] = { type: Object.keys(value)[0], ...value }; return structuredClone(schema); }
    if (path.endsWith('/query')) return { results: structuredClone(pages.filter(p => !p.archived && !p.in_trash)), has_more: false };
    const p = pages.find(p => path.endsWith(p.id));
    if (p) { if (method === 'PATCH') Object.assign(p.properties, body.properties); return structuredClone(p); }
    const goal = COMPANY_GOALS.find(g => path.endsWith(g.page_id));
    if (goal) return { id: goal.page_id, parent: { database_id: COMPANY_GOAL_DATABASE }, properties: { Name: { title: [{ plain_text: goal.title }] }, Area: { relation: [] } } };
    throw new Error('page unavailable');
  });
  return { pool: { query, connect: async () => ({ query, release() {} }) }, notionReq, rows, pages, task, kr, page, schema };
}

