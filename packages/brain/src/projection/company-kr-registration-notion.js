/** 公司KR登记的定向镜子：复用现有库，仅投影已登记的这一条工作流。 */
import { notionReq as defaultNotionReq } from '../recurring-notion-sync.js';
import { configuredCompanyToken } from './company-kr-notion.js';
import { readWorkflowActivities } from '../lib/workflow-read-service.js';
import { companyKrSpec } from '../lib/company-kr-registration.js';
import { propsDigest } from '../lib/notion-projection-engine.js';
import { buildBackboneActivityProps } from '../activity-contract-sync.js';

export const REGISTRATION_DATABASES = {
  workflows: '3d9c40c2-ba63-8145-bfa8-f4c0c006e0af',
  steps: '3d9c40c2-ba63-8195-a41b-f529056a4aa8',
  activities: 'c213e387-b2ae-45a4-98c0-4a66fe3408be',
  runs: '3d3c40c2-ba63-81cb-985d-f44b05e787ee',
};
const rich = text => ({ rich_text: [{ text: { content: String(text ?? '').slice(0, 1900) } }] });
const title = text => ({ title: [{ text: { content: text } }] });
const relation = id => ({ relation: id ? [{ id }] : [] });
const compact = id => String(id || '').replaceAll('-', '');
const textOf = (page, key) => (page.properties?.[key]?.rich_text || []).map(x => x.plain_text ?? x.text?.content ?? '').join('');
const paragraph = text => ({ object: 'block', type: 'paragraph', paragraph: rich(text) });

export const workflowProperties = row => ({ Workflow: title(row.name), '版本': rich(row.version) });
export const stepProperties = (row, workflowId) => ({
  '步骤': title(`KR · ${row.readback.name || row.key}`), '顺序': { number: row.step_order },
  '所属Workflow': relation(workflowId), Staging: rich(`${row.key}\n${row.readback.implementation}`),
  '有确定性判定?': { select: { name: row.executor_kind === 'agent' ? '部分' : '有' } },
});
export const runProperties = (row, runtimeId) => ({
  Name: title(`公司 KR 分析 · ${row.run_id}`), RunId: rich(row.run_id),
  Status: { select: { name: row.status } }, StartedAt: { date: { start: new Date(row.started_at).toISOString() } },
  Minutes: { number: row.ended_at ? (new Date(row.ended_at) - new Date(row.started_at)) / 60000 : null },
  Workflow: relation(runtimeId),
});

/** 本地映射丢失时按既有身份找回；重复/错库不得抢写。 */
export async function upsertRegistrationPage(pool, token, { table, row, dbId, properties, filter, children, verifyRecovered, notionReq = defaultNotionReq }) {
  const link = (await pool.query(`SELECT external_id,content_hash FROM projection_links WHERE target='notion' AND entity_type=$1 AND entity_id=$2`, [table, row.id])).rows[0];
  const hash = propsDigest({ database_id: dbId, properties });
  let pageId = link?.external_id;
  if (pageId) {
    let page;
    try { page = await notionReq(token, `/pages/${pageId}`, 'GET'); }
    catch (error) { if (error.status !== 404 && !/404/.test(error.message)) throw error; }
    if (page && compact(page.parent?.database_id) !== compact(dbId)) throw new Error('登记投影映射指向错误数据库');
    if (!page || page.archived || page.in_trash) pageId = null;
    else if (link.content_hash === hash) return pageId;
  }
  if (!pageId) {
    const found = await notionReq(token, `/databases/${dbId}/query`, 'POST', { filter, page_size: 2 });
    if (found.has_more || found.results?.length > 1) throw new Error(`登记存在重复投影: ${table}/${row.id}`);
    const recovered = found.results?.[0];
    if (recovered && verifyRecovered && !await verifyRecovered(recovered)) throw new Error('同名页面缺少本登记身份，拒绝抢占');
    pageId = recovered?.id;
  }
  if (pageId) {
    const owner = (await pool.query(`SELECT entity_type,entity_id FROM projection_links WHERE target='notion' AND external_id=$1`, [pageId])).rows[0];
    if (owner && (owner.entity_type !== table || owner.entity_id !== row.id)) throw new Error('Notion 页面已有其它登记归属');
  }
  const page = pageId
    ? await notionReq(token, `/pages/${pageId}`, 'PATCH', { properties })
    : await notionReq(token, '/pages', 'POST', { parent: { database_id: dbId }, properties, ...(children ? { children } : {}) });
  pageId = page.id || pageId;
  if (!pageId) throw new Error('Notion 未返回登记页面ID');
  await pool.query(`INSERT INTO projection_links(target,entity_type,entity_id,external_id,content_hash,last_synced_at)
    VALUES('notion',$1,$2,$3,$4,NOW()) ON CONFLICT(target,entity_type,entity_id)
    DO UPDATE SET external_id=EXCLUDED.external_id,content_hash=EXCLUDED.content_hash,last_synced_at=NOW(),updated_at=NOW()`, [table, row.id, pageId, hash]);
  return pageId;
}

export async function projectCompanyKrRegistration(pool, { token = configuredCompanyToken(), notionReq = defaultNotionReq } = {}) {
  if (!token) return { skipped: true, reason: 'not_configured' };
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', ['company-kr-registration-notion'])).rows[0]?.locked;
    if (!locked) return { skipped: true, reason: 'in_flight' };
    return await projectRows(client, token, notionReq);
  } finally {
    let destroy = false;
    try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['company-kr-registration-notion']); }
    catch { destroy = true; }
    client.release(destroy);
  }
}

async function projectRows(pool, token, notionReq) {
  const w = (await pool.query(`SELECT w.*,o.notion_id AS runtime_notion_id FROM workflows w JOIN ops_workflows o ON o.workflow_id=w.id
    WHERE w.key=$1 AND o.source='scheduler' AND o.wf_id=$2`, [companyKrSpec.key, companyKrSpec.runtime])).rows[0];
  if (!w?.runtime_notion_id) throw new Error('正式工作流或运行时投影未就绪');
  const dbs = REGISTRATION_DATABASES;
  const wf = await upsertRegistrationPage(pool, token, { table: 'workflows', row: w, dbId: dbs.workflows,
    properties: workflowProperties(w), filter: { property: 'Workflow', title: { equals: w.name } }, notionReq,
    verifyRecovered: async page => {
      const blocks = await notionReq(token, `/blocks/${page.id}/children?page_size=100`, 'GET');
      return blocks.results?.some(b => (b.paragraph?.rich_text || []).some(x => (x.plain_text ?? x.text?.content) === `Brain workflows:${w.id}`));
    },
    children: [paragraph(`Brain workflows:${w.id}`), paragraph('归属：Cecelia → 管家价值流 → G5 战略 OKR → 公司 KR 分析。'),
      paragraph('启动：Brain 的 Notion 同步周期；按启用状态、每日时刻及正式版本去重。分析员：MMV 的 OpenClaw company-kr-analyst。'),
      paragraph('主理人在 Notion 填正式数字；AI 读取正式目标与已有证据，建议写入独立列，由主理人决定是否采纳。'),
      paragraph(`运行明细：https://app.notion.com/p/${compact(w.runtime_notion_id)}\nKR 表：https://app.notion.com/p/684c40c2ba6383a7b6ba8161f110a18c`),
      paragraph('步骤登记可查 Workflow Steps；活动登记可查 Backbone Activities。历史运行没有逐步骤 span，不据工作流定义补造执行事实。')],
  });
  const activities = await readWorkflowActivities(pool,w.id);
  const steps = activities.flatMap(a => a.steps.map(s => ({...s,executor_kind:a.executor_kind})));
  const stepIds = new Map();
  for (const row of steps) {
    const properties = stepProperties(row, wf);
    const id = await upsertRegistrationPage(pool, token, { table: 'steps', row, dbId: dbs.steps, properties,
      filter: { and: [{ property: '所属Workflow', relation: { contains: wf } }, { property: '步骤', title: { equals: properties['步骤'].title[0].text.content } }] },
      verifyRecovered: page => textOf(page, 'Staging').split('\n')[0] === row.key,
      children: [paragraph(row.readback.asserts), paragraph(row.readback.implementation)], notionReq });
    stepIds.set(row.id, id);
  }
  const agent = (await pool.query(`SELECT notion_id FROM ops_agents WHERE source='openclaw' AND host_alias='mmv' AND name=$1`, [companyKrSpec.agent])).rows[0];
  for (const row of activities) {
    const properties = { ...buildBackboneActivityProps(row),
      Steps: { relation: steps.filter(s => s.activity_id === row.id).map(s => ({ id: stepIds.get(s.id) })) },
      ...(row.executor_kind === 'agent' && agent?.notion_id ? { Agent: relation(agent.notion_id) } : {}),
    };
    const key = `${row.capability_key}.${row.activity_key}`;
    const pageId = await upsertRegistrationPage(pool, token, { table: 'journey_steps', row, dbId: dbs.activities,
      properties, filter: { property: 'Key', rich_text: { equals: key } }, notionReq,
      verifyRecovered: page => textOf(page, 'Key') === key,
    });
    await pool.query('UPDATE journey_steps SET notion_id=$2,notion_synced_at=NOW(),notion_digest=$3 WHERE id=$1', [row.id, pageId, propsDigest(properties)]);
  }
  const runs = (await pool.query(`SELECT * FROM task_runs WHERE workflow_id=$1 ORDER BY started_at DESC LIMIT 100`, [w.id])).rows;
  for (const row of runs) {
    await upsertRegistrationPage(pool, token, { table: 'task_runs', row, dbId: dbs.runs, properties: runProperties(row, w.runtime_notion_id),
      filter: { property: 'RunId', rich_text: { equals: row.run_id } }, notionReq,
      verifyRecovered: page => textOf(page, 'RunId') === row.run_id,
      children: [paragraph(`工作流：https://app.notion.com/p/${compact(wf)}\nBrain task_id：${row.task_id}`), paragraph('本页记录这一次真实分析执行；未采集逐步骤执行时间，不填步骤通过记录。')],
    });
  }
  return { workflow_id: w.id, notion_workflow_id: wf, activities: activities.length, steps: steps.length, runs: runs.length };
}
