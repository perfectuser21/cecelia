/**
 * notion-gtd-sync.js — 秋米中文 GTD 表 ↔ 英文 Tasks 库 双向同步（决策 b8abd28c，PR2 入口刀）
 *
 * 人从 Notion 进、机器从 Brain 进、Notion 永远是投影。
 *  - zh→en：中文「委派 ∧ 任务号空 ∧ 未归档 ∧ 创建时间≥since」→ 英文库建行（Description 前缀 [zh:<id32>]）
 *           → 中文任务号写 en:<id32> 占位（谁先写谁赢，与旧 us-vps 脚本并存期互斥）
 *  - en→zh：英文原生 Delegated（无 [zh:]、无 brain:、无 [en-native]）→ 中文表建行（备注 [en:<id32>]，任务号 en:占位）
 *  - 入账（Task 4）：notion-push-sync.ingestDelegatedPage 认标记 → Brain qiumi_task
 *  - 回写/急停（Task 5）：pushQiumiStatus / applyOwnerStops
 * 铁律：中文「收集/下一个行动/阻塞/淘汰」永不写、除急停外永不读（ZH_QUERY_FILTER 只含 委派）。
 * 页 id 只放 payload，不碰 tasks.notion_id（canonical 投影 projection/notion.js 会覆盖它）。
 */
import { notionReq as defaultNotionReq } from './recurring-notion-sync.js';
import { withBackoff } from './lib/notion-backoff.js';
import {
  QIUMI_STATUS_MAP, ZH_HUMAN_ONLY_STATUSES, zhPriorityToBrain, zhWriteFor,
} from './lib/qiumi-status-map.js';
import { blockTask, unblockTask } from './task-updater.js';
import { recordProjectionCommand } from './projection/commands.js';

export const GTD_DB_ID = process.env.NOTION_GTD_DB_ID || 'c69c40c2-ba63-8271-badf-01c5410d8929';
export const EN_TASKS_DB = 'd5bc40c2-ba63-82ef-965a-8153b7ad81a0';

export const ZH_MARK_RE = /\[zh:([0-9a-f]{32})\]/;
export const EN_MARK_RE = /\[en:([0-9a-f]{32})\]/;
export const EN_NATIVE_MARK = '[en-native]';
export const BRAIN_MARK_RE = /brain:([0-9a-f-]{36})/;

export const id32 = (id) => String(id || '').replace(/-/g, '').toLowerCase();
const text = (content) => [{ type: 'text', text: { content: String(content ?? '').slice(0, 1900) } }];
const plain = (arr) => (arr ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('').trim();
const rel = (p) => (p?.relation ?? []).map((r) => r.id);

/** 只查「委派」——四个人工态从不进这个 filter（变异守卫钉住） */
export const ZH_QUERY_FILTER = Object.freeze({
  and: [
    { property: '状态', status: { equals: '委派' } },
    { property: 'OpenClaw任务号', rich_text: { is_empty: true } },
    { property: '归档', checkbox: { equals: false } },
  ],
});

export function parseZhPage(page) {
  const p = page?.properties ?? {};
  return {
    id: page.id,
    id32: id32(page.id),
    title: plain(p['名称']?.title),
    remark: plain(p['备注']?.rich_text),
    status: p['状态']?.status?.name ?? null,
    taskNo: plain(p['OpenClaw任务号']?.rich_text),
    priorityRaw: p['优先级']?.select?.name ?? null,
    priority: zhPriorityToBrain(p['优先级']?.select?.name),
    dueAt: p['预期完成日期']?.date?.start ?? null,
    channel: p['执行通道']?.select?.name ?? null,
    agentWorkflowIds: rel(p['执行 Agent / Workflow']),
    skillIds: rel(p['使用 Skill']),
    businessTaskIds: rel(p['AI 业务任务']),
    ownerIds: (p['负责人']?.people ?? []).map((u) => u.id),
    archived: p['归档']?.checkbox === true,
    createdAt: p['创建时间']?.created_time ?? page.created_time ?? null,
    lastEditedTime: page.last_edited_time ?? null,
  };
}

export function parseEnPage(page) {
  const p = page?.properties ?? {};
  const description = plain(p.Description?.rich_text);
  return {
    id: page.id,
    id32: id32(page.id),
    name: plain(p.Name?.title),
    description,
    status: p.Status?.status?.name ?? null,
    planDate: p['Plan Date']?.date?.start ?? null,
    zhId32: description.match(ZH_MARK_RE)?.[1] ?? null,
    enNative: description.includes(EN_NATIVE_MARK),
    brainTaskId: description.match(BRAIN_MARK_RE)?.[1] ?? null,
    lastEditedTime: page.last_edited_time ?? null,
  };
}

export function buildEnPageFromZh(zh, pageContent = '') {
  const desc = [`[zh:${zh.id32}]`, zh.remark, pageContent].filter(Boolean).join(' ');
  const properties = {
    Name: { title: text(`[${zh.priority}] ${zh.title}`) },
    Description: { rich_text: text(desc) },
    Status: { status: { name: 'Delegated' } },
  };
  if (zh.dueAt) properties['Plan Date'] = { date: { start: zh.dueAt } };
  return { parent: { database_id: EN_TASKS_DB }, properties };
}

export function buildZhPageFromEn(en, pageContent = '') {
  const title = en.name.replace(/^\[P[0-3]\]\s*/, '');
  const remark = [`[en:${en.id32}]`, en.description, pageContent].filter(Boolean).join(' ');
  const properties = {
    '名称': { title: text(title) },
    '备注': { rich_text: text(remark) },
    '状态': { status: { name: '委派' } },
    'OpenClaw任务号': { rich_text: text(`en:${en.id32}`) },
  };
  if (en.planDate) properties['预期完成日期'] = { date: { start: en.planDate } };
  return { parent: { database_id: GTD_DB_ID }, properties };
}

async function queryAll(notionReq, token, dbId, filter, sorts) {
  const results = [];
  let cursor = null;
  do {
    const body = { filter, page_size: 50 };
    if (sorts) body.sorts = sorts;
    if (cursor) body.start_cursor = cursor;
    const resp = await withBackoff(() => notionReq(token, `/databases/${dbId}/query`, 'POST', body));
    results.push(...(resp?.results ?? []));
    cursor = resp?.has_more ? resp.next_cursor : null;
  } while (cursor);
  return results;
}

export async function syncZhToEn(pool, token, {
  notionReq = defaultNotionReq, fetchPageContent, now = () => new Date(), sinceIso = null,
} = {}) {
  const filter = { and: [...ZH_QUERY_FILTER.and] };
  if (sinceIso) filter.and.push({ timestamp: 'created_time', created_time: { on_or_after: sinceIso } });
  const pages = await queryAll(notionReq, token, GTD_DB_ID, filter);
  let created = 0; let skipped = 0;
  for (const page of pages) {
    const zh = parseZhPage(page);
    // 二次校验：filter 与真值不一致时以真值为准（并存期旧脚本可能刚写了任务号）
    if (zh.status !== '委派' || zh.taskNo || zh.archived || !zh.title
      || (sinceIso && zh.createdAt && zh.createdAt < sinceIso)) { skipped += 1; continue; }
    const content = fetchPageContent ? await fetchPageContent(token, zh.id) : '';
    const enPage = await withBackoff(() => notionReq(token, '/pages', 'POST', buildEnPageFromZh(zh, content)));
    await withBackoff(() => notionReq(token, `/pages/${zh.id}`, 'PATCH', {
      properties: { 'OpenClaw任务号': { rich_text: text(`en:${id32(enPage.id)}`) } },
    }));
    created += 1;
    void now;
  }
  return { created, skipped };
}

export const PUSH_QIUMI_QUERY = `
    SELECT id, status, error_message, result,
           payload->>'notion_zh_page_id' AS zh_page_id,
           payload->>'notion_page_id'    AS en_page_id
      FROM tasks
     WHERE payload->>'notion_zh_page_id' IS NOT NULL
       AND (notion_props->>'qiumi_pushed_status') IS DISTINCT FROM status
     ORDER BY updated_at DESC
     LIMIT 50`;

const resultTextOf = (result) => {
  const r = result?.receipt ?? result ?? {};
  return String(r.finalAssistantVisibleText ?? r.text ?? r.summary ?? '').slice(0, 1900);
};
const bizToday = () => new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10); // 业务日早 4 点切

/** Brain → 中文页（zh 通道 ≤50/轮）+ 英文页 Status。人工态行只更指纹不写页。 */
export async function pushQiumiStatus(pool, token, { notionReq = defaultNotionReq, today = bizToday } = {}) {
  const { rows } = await pool.query(PUSH_QIUMI_QUERY);
  let pushed = 0; let skippedHuman = 0; let skippedNoMap = 0;
  for (const t of rows) {
    const map = QIUMI_STATUS_MAP[t.status];
    if (!map || !map.zh) { skippedNoMap += 1; continue; }
    const zhPage = await withBackoff(() => notionReq(token, `/pages/${t.zh_page_id}`, 'GET'));
    const zhStatus = zhPage?.properties?.['状态']?.status?.name ?? null;
    const stamp = () => pool.query(
      `UPDATE tasks SET notion_props = COALESCE(notion_props,'{}'::jsonb) || jsonb_build_object('qiumi_pushed_status', $2::text) WHERE id=$1`,
      [t.id, t.status],
    );
    if (ZH_HUMAN_ONLY_STATUSES.includes(zhStatus)) { await stamp(); skippedHuman += 1; continue; }
    const write = zhWriteFor(t.status, { reason: t.error_message || '', resultText: resultTextOf(t.result), today: today() });
    await withBackoff(() => notionReq(token, `/pages/${t.zh_page_id}`, 'PATCH', write));
    if (t.en_page_id && map.en) {
      await withBackoff(() => notionReq(token, `/pages/${t.en_page_id}`, 'PATCH', { properties: { Status: { status: { name: map.en } } } }));
    }
    await stamp();
    pushed += 1;
  }
  return { pushed, skippedHuman, skippedNoMap };
}

/** 急停三个查询：只读三个人工动作态，且必须 OpenClaw任务号 以 brain: 开头（归属铁律） */
export const OWNER_STOP_FILTERS = Object.freeze(['淘汰', '阻塞', '委派'].map((s) => Object.freeze({
  and: [
    { property: '状态', status: { equals: s } },
    { property: 'OpenClaw任务号', rich_text: { starts_with: 'brain:' } },
  ],
})));

/** 主理人急停：淘汰→cancel_requested、阻塞→owner_hold、从阻塞拖回委派→unblock。 */
export async function applyOwnerStops(pool, token, { notionReq = defaultNotionReq } = {}) {
  let cancelled = 0; let held = 0; let resumed = 0;
  const [discarded, holds, redelegated] = await Promise.all(
    OWNER_STOP_FILTERS.map((filter) => queryAll(notionReq, token, GTD_DB_ID, filter)),
  );
  const taskIdOf = (page) => parseZhPage(page).taskNo.match(BRAIN_MARK_RE)?.[1] ?? null;
  for (const page of discarded) {
    const id = taskIdOf(page);
    if (!id) continue;
    await recordProjectionCommand(pool, {
      target: 'notion', externalId: `${page.id}:${page.last_edited_time}`, entityType: 'tasks',
      entityId: id, commandType: 'cancel_requested', payload: { source: 'qiumi_owner_stop' },
    });
    cancelled += 1;
  }
  for (const page of holds) {
    const id = taskIdOf(page);
    if (!id) continue;
    const r = await blockTask(id, { reason: 'owner_hold', detail: '主理人在中文表拖到阻塞' });
    if (r?.success) held += 1;
  }
  for (const page of redelegated) {
    const id = taskIdOf(page);
    if (!id) continue;
    const { rows } = await pool.query('SELECT id, status, blocked_reason FROM tasks WHERE id=$1', [id]);
    const t = rows[0];
    if (t?.status === 'blocked' && t.blocked_reason === 'owner_hold') {
      const r = await unblockTask(id);
      if (r?.success) resumed += 1;
    }
  }
  return { cancelled, held, resumed };
}

export async function syncEnToZh(pool, token, {
  notionReq = defaultNotionReq, fetchPageContent, now = () => new Date(),
} = {}) {
  const pages = await queryAll(notionReq, token, EN_TASKS_DB, {
    property: 'Status', status: { equals: 'Delegated' },
  });
  let created = 0; let skipped = 0;
  for (const page of pages) {
    const en = parseEnPage(page);
    if (en.zhId32 || en.enNative || en.brainTaskId || !en.name) { skipped += 1; continue; }
    const content = fetchPageContent ? await fetchPageContent(token, en.id) : '';
    await withBackoff(() => notionReq(token, '/pages', 'POST', buildZhPageFromEn(en, content)));
    await withBackoff(() => notionReq(token, `/pages/${en.id}`, 'PATCH', {
      properties: { Description: { rich_text: text(`${en.description} ${EN_NATIVE_MARK}`.trim()) } },
    }));
    created += 1;
    void now;
  }
  return { created, skipped };
}
