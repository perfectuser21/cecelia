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
import { notionReq as defaultNotionReq, getToken } from './recurring-notion-sync.js';
import { pullMarkedNotionTasks, fetchNotionPageContent } from './notion-push-sync.js';
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
/** OpenClaw 排单派发回执（dispatchOpenClawFromNotion 注入的 run id）——这类行是英文库自有工作流，不是待回填的原生行 */
export const OPC_RUN_MARK_RE = /run:notion-/;

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
    opcDispatched: OPC_RUN_MARK_RE.test(description),
    createdAt: page.created_time ?? null,
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

/**
 * 按标记反查目标库里已存在的镜像行（page_size=1）。
 * 建行与"在源页打占位标记"是两次 Notion 请求、不可能原子：占位 PATCH 挂掉（429/网络/进程被杀）
 * 后源行仍满足 filter，下一轮会再建一行——同一条任务在目标库留两条，且两条都会各自入账。
 * 所以 POST 之前必须先按标记查一次：命中就只补写源页占位，把"非原子"收敛成幂等。
 */
async function findByMark(notionReq, token, dbId, property, mark) {
  const resp = await withBackoff(() => notionReq(token, `/databases/${dbId}/query`, 'POST', {
    page_size: 1, filter: { property, rich_text: { contains: mark } },
  }));
  return resp?.results?.[0] ?? null;
}

export async function syncZhToEn(pool, token, {
  notionReq = defaultNotionReq, fetchPageContent, now = () => new Date(), sinceIso = null,
} = {}) {
  const filter = { and: [...ZH_QUERY_FILTER.and] };
  if (sinceIso) filter.and.push({ timestamp: 'created_time', created_time: { on_or_after: sinceIso } });
  const pages = await queryAll(notionReq, token, GTD_DB_ID, filter);
  let created = 0; let skipped = 0; let repaired = 0;
  for (const page of pages) {
    const zh = parseZhPage(page);
    // 二次校验：filter 与真值不一致时以真值为准（并存期旧脚本可能刚写了任务号）
    if (zh.status !== '委派' || zh.taskNo || zh.archived || !zh.title
      || (sinceIso && zh.createdAt && zh.createdAt < sinceIso)) { skipped += 1; continue; }
    const mirrored = await findByMark(notionReq, token, EN_TASKS_DB, 'Description', `[zh:${zh.id32}]`);
    const stamp = (enId) => withBackoff(() => notionReq(token, `/pages/${zh.id}`, 'PATCH', {
      properties: { 'OpenClaw任务号': { rich_text: text(`en:${id32(enId)}`) } },
    }));
    if (mirrored) { await stamp(mirrored.id); repaired += 1; continue; }
    const content = fetchPageContent ? await fetchPageContent(token, zh.id) : '';
    const enPage = await withBackoff(() => notionReq(token, '/pages', 'POST', buildEnPageFromZh(zh, content)));
    await stamp(enPage.id);
    created += 1;
    void now;
  }
  return { created, skipped, repaired };
}

export const PUSH_QIUMI_QUERY = `
    SELECT id, status, error_message, result,
           payload->>'notion_zh_page_id' AS zh_page_id,
           payload->>'notion_page_id'    AS en_page_id
      FROM tasks
     WHERE payload->>'notion_zh_page_id' IS NOT NULL
       -- 只有 qiumi_task 这一层代表中文表那一行。派生出去的 device_job 子任务有自己的生命周期，
       -- 放进来就会拿子任务状态去改同一行：子 queued 把行推回「委派」（下轮同步当新行二次入账）、
       -- 子完成抢在父任务前写「已完成」、子失败写「推迟」并清空 OpenClaw任务号（急停与重排的唯一锚）。
       -- 第一道闸是子任务根本不继承 notion_zh_page_id（routing/qiumi-router.js），这是第二道。
       AND task_type = 'qiumi_task'
       AND ((notion_props->>'qiumi_pushed_status') IS DISTINCT FROM status
            OR notion_props ? 'qiumi_human_hold')
     ORDER BY (notion_props ? 'qiumi_human_hold') ASC, updated_at DESC
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
    // hold 非空 = 本轮放弃推送是因为人工占着中文页：留保留标记，下轮无论 Brain 状态变没变都要重扫。
    // 推送成功则必须把标记减掉，否则这行会永远留在扫描集合里。
    const stamp = (hold = null) => (hold
      ? pool.query(
        `UPDATE tasks SET notion_props = COALESCE(notion_props,'{}'::jsonb)
           || jsonb_build_object('qiumi_pushed_status', $2::text, 'qiumi_human_hold', $3::text) WHERE id=$1`,
        [t.id, t.status, hold],
      )
      : pool.query(
        `UPDATE tasks SET notion_props = (COALESCE(notion_props,'{}'::jsonb)
           || jsonb_build_object('qiumi_pushed_status', $2::text)) - 'qiumi_human_hold' WHERE id=$1`,
        [t.id, t.status],
      ));
    const map = QIUMI_STATUS_MAP[t.status];
    if (!map || !map.zh) { await stamp(); skippedNoMap += 1; continue; }
    const zhPage = await withBackoff(() => notionReq(token, `/pages/${t.zh_page_id}`, 'GET'));
    const zhStatus = zhPage?.properties?.['状态']?.status?.name ?? null;
    if (ZH_HUMAN_ONLY_STATUSES.includes(zhStatus)) { await stamp(zhStatus); skippedHuman += 1; continue; }
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
  const ignored = []; // 急停没落地的行——不计数也要说出来，别静默
  const [discarded, holds, redelegated] = await Promise.all(
    OWNER_STOP_FILTERS.map((filter) => queryAll(notionReq, token, GTD_DB_ID, filter)),
  );
  const taskIdOf = (page) => parseZhPage(page).taskNo.match(BRAIN_MARK_RE)?.[1] ?? null;
  for (const page of discarded) {
    const id = taskIdOf(page);
    if (!id) continue;
    // externalId 必须与"人编辑页面"无关：带 last_edited_time 的话，页面每被碰一次就是一条新命令，
    // 而任务早已 cancelled → 状态机一路 rejected，projection_commands 每轮涨一条死命令。
    // 消解不能靠清中文页的任务号（人工态行 AI 永不写，主理人铁律），只能靠固定键 + ON CONFLICT。
    await recordProjectionCommand(pool, {
      target: 'notion', externalId: `${page.id}:cancel_requested`, entityType: 'tasks',
      entityId: id, commandType: 'cancel_requested', payload: { source: 'qiumi_owner_stop' },
    });
    cancelled += 1;
  }
  for (const page of holds) {
    const id = taskIdOf(page);
    if (!id) continue;
    const r = await blockTask(id, { reason: 'owner_hold', detail: '主理人在中文表拖到阻塞' });
    if (r?.success) { held += 1; continue; }
    const reason = r?.error || 'block_failed';
    ignored.push({ id, action: 'hold', reason });
    console.warn(`[notion-gtd-sync] 急停未生效 task=${id} action=hold reason=${reason}`);
  }
  for (const page of redelegated) {
    const id = taskIdOf(page);
    if (!id) continue;
    const { rows } = await pool.query('SELECT id, status, blocked_reason FROM tasks WHERE id=$1', [id]);
    const t = rows[0];
    if (t?.status === 'blocked' && t.blocked_reason === 'owner_hold') {
      const r = await unblockTask(id);
      if (r?.success) { resumed += 1; continue; }
      const reason = r?.error || 'unblock_failed';
      ignored.push({ id, action: 'resume', reason });
      console.warn(`[notion-gtd-sync] 急停未生效 task=${id} action=resume reason=${reason}`);
    }
  }
  return { cancelled, held, resumed, ignored };
}

/**
 * 英文库 Delegated 原生行 → 中文表回填。
 * 英文 Tasks 库不是秋米专属：主理人自己的排单、排班员 v1a 的排期行、OpenClaw 已派发行都住在里面。
 * 只按 Status=Delegated 捞，会把这些统统镜像成中文 GTD 行——中文表是主理人每天看的台面，
 * 污染它比漏同步严重得多。故四道跳过（标记行/原生标记/已入账 + 下面三条）全部 fail-closed。
 */
export async function syncEnToZh(pool, token, {
  notionReq = defaultNotionReq, fetchPageContent, now = () => new Date(), sinceIso = null,
} = {}) {
  const filter = { and: [{ property: 'Status', status: { equals: 'Delegated' } }] };
  // ③ 并存期窗口：与 syncZhToEn 同源，英文库存量 Delegated 行不进本刀
  if (sinceIso) filter.and.push({ timestamp: 'created_time', created_time: { on_or_after: sinceIso } });
  const pages = await queryAll(notionReq, token, EN_TASKS_DB, filter);
  const nowMs = now().getTime();
  let created = 0; let skipped = 0; let repaired = 0;
  for (const page of pages) {
    const en = parseEnPage(page);
    // ① OpenClaw 已派发行：英文库自有工作流的中间态，不是人新写的原生任务
    // ② Plan Date 在未来：排班员的排期意图，到点后再回填（与 ingestDelegatedPage 的时间窗同语义）
    if (en.zhId32 || en.enNative || en.brainTaskId || !en.name
      || en.opcDispatched
      || (en.planDate && new Date(en.planDate).getTime() > nowMs)
      || (sinceIso && en.createdAt && en.createdAt < sinceIso)) { skipped += 1; continue; }
    const mirrored = await findByMark(notionReq, token, GTD_DB_ID, '备注', `[en:${en.id32}]`);
    // 建行与打标记非原子：中文行已在（上一轮 POST 成功、PATCH 挂了）就只补英文页的 [en-native]
    if (!mirrored) {
      const content = fetchPageContent ? await fetchPageContent(token, en.id) : '';
      await withBackoff(() => notionReq(token, '/pages', 'POST', buildZhPageFromEn(en, content)));
    }
    await withBackoff(() => notionReq(token, `/pages/${en.id}`, 'PATCH', {
      properties: { Description: { rich_text: text(`${en.description} ${EN_NATIVE_MARK}`.trim()) } },
    }));
    if (mirrored) repaired += 1; else created += 1;
  }
  return { created, skipped, repaired };
}

/** 单步失败只 warn 不抛：一条通道挂掉不能拖垮同一轮里剩下的四条。 */
const safe = async (label, fn) => {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[notion-gtd] ${label} 失败: ${err.message}`);
    return { error: err.message };
  }
};

/**
 * 一轮完整同步，顺序固定：zh→en → en→zh → 入账 → 急停 → 回写。
 * 顺序要紧：先把人写的行同步成英文行，再入账拿 task id，急停排在回写前——
 * 否则本轮刚被主理人拖到「淘汰」的行会先被回写成「进行中」，人机互踩。
 */
export async function runGtdSyncOnce(pool, {
  token = null, env = process.env, notionReq = defaultNotionReq,
  syncZhToEn: zhToEnFn = syncZhToEn, syncEnToZh: enToZhFn = syncEnToZh,
  pullMarked = pullMarkedNotionTasks, applyOwnerStops: stopsFn = applyOwnerStops,
  pushQiumiStatus: pushFn = pushQiumiStatus, onStep = () => {},
} = {}) {
  // 取 token 也算一步：凭据没配/取不到时整轮五步统一报 notion_token_missing 并返回，
  // 不抛——抛出去会穿过定时回调变成未捕获 rejection，整个循环从此哑掉。
  let tok = token;
  if (!tok) {
    try {
      tok = getToken();
    } catch (err) {
      console.warn(`[notion-gtd] 取 Notion token 失败: ${err.message}`);
      tok = null;
    }
  }
  if (!tok) {
    const e = Object.freeze({ error: 'notion_token_missing' });
    return { zhToEn: e, enToZh: e, ingest: e, stops: e, push: e, at: new Date().toISOString() };
  }
  const sinceIso = env.QIUMI_SYNC_SINCE || null;
  const common = { notionReq, fetchPageContent: fetchNotionPageContent };
  // 每步前上报步名：整轮超时时唯一能说出"卡在哪"的证据（09-24 卡死 8.4h 事后无法复原就是缺这个）
  onStep('zh→en');
  const zhToEn = await safe('zh→en', () => zhToEnFn(pool, tok, { ...common, sinceIso }));
  onStep('en→zh');
  const enToZh = await safe('en→zh', () => enToZhFn(pool, tok, { ...common, sinceIso }));
  onStep('入账');
  const ingest = await safe('入账', () => pullMarked(pool, tok, { env }));
  onStep('急停');
  const stops = await safe('急停', () => stopsFn(pool, tok, { notionReq }));
  onStep('回写');
  const push = await safe('回写', () => pushFn(pool, tok, { notionReq }));
  onStep(null);
  return { zhToEn, enToZh, ingest, stops, push, at: new Date().toISOString() };
}

let loopTimer = null;
let lastRun = null;
/** 最后一轮**真正跑完**的时刻；超时的轮不推进。活性只认它，不认哨兵时间戳（handler 立即返回，哨兵每分钟都新）。 */
let lastCompletedAt = null;

/** 模块级单例重置（测试用；vitest 侧一般靠 vi.resetModules()）。 */
export function __resetGtdSyncLoopForTest() { loopTimer = null; lastRun = null; lastCompletedAt = null; }

const ISO_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const validSince = (v) => typeof v === 'string' && ISO_RE.test(v.trim()) && !Number.isNaN(Date.parse(v.trim()));

export const DEFAULT_ROUND_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 30s 自循环（幂等）。默认关闭：QIUMI_SYNC_ENABLED!=='true' 时既不起定时器也不碰 Notion。
 * 与 us-vps 旧脚本并存期的起算点 QIUMI_SYNC_SINCE 必须由切换脚本写死进部署 env：
 * 缺失或非法即 fail-closed 不起循环。进程自己拿"当下"补一个，等于每次重启都换窗口——
 * 重启前那段时间建的行会被静默漏掉，且两台机器各算各的，账对不上。
 *
 * 整轮总超时（QIUMI_SYNC_ROUND_TIMEOUT_MS，默认 5min）：2026-09-24 00:41Z 一轮里某个 await
 * 永不返回，inFlight 永真，之后每 30s 的触发全部跳过、handler 仍回报 running，卡死 8.4h 无人知。
 * 单请求有超时不等于整轮有超时；超时即释放 inFlight、记下卡在哪一步，迟到的结果丢弃。
 */
export function ensureGtdSyncLoop(pool, {
  env = process.env, setIntervalFn = setInterval, setTimeoutFn = setTimeout, intervalMs,
  runOnce = runGtdSyncOnce,
} = {}) {
  if (env.QIUMI_SYNC_ENABLED !== 'true') return { started: false, running: false };
  if (loopTimer) return { started: false, running: true };
  if (!validSince(env.QIUMI_SYNC_SINCE)) {
    console.warn(`[notion-gtd] 未起循环：QIUMI_SYNC_SINCE 缺失或非法 ISO（当前 ${env.QIUMI_SYNC_SINCE ?? '<未设>'}），并存期起算点必须由部署 env 写死`);
    return { started: false, running: false, reason: 'missing_since' };
  }
  const ms = intervalMs ?? Number(env.QIUMI_SYNC_INTERVAL_MS || 30_000);
  const roundTimeoutMs = Number(env.QIUMI_SYNC_ROUND_TIMEOUT_MS || DEFAULT_ROUND_TIMEOUT_MS);
  let inFlight = false;
  let currentStep = null;
  let round = 0;
  loopTimer = setIntervalFn(async () => {
    if (inFlight) return; // 重入守卫：慢轮（Notion 退避）不许叠加
    inFlight = true;
    round += 1;
    const myRound = round;
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeoutFn(() => resolve({ __roundTimedOut: true }), roundTimeoutMs);
      if (typeof timer?.unref === 'function') timer.unref();
    });
    try {
      const result = await Promise.race([
        // 按轮次门控：被超时放弃的旧轮若还在后台跑，它迟到的 onStep 不得改写当前轮的步名
        runOnce(pool, { env, onStep: (s) => { if (myRound === round) currentStep = s; } }),
        timeout,
      ]);
      if (result?.__roundTimedOut) {
        const at = new Date().toISOString();
        console.warn(`[notion-gtd] 整轮超时 ${roundTimeoutMs}ms，卡在步骤「${currentStep ?? '未知'}」，释放 inFlight（第 ${myRound} 轮）`);
        lastRun = { error: 'round_timeout', step: currentStep, at };
      } else {
        lastRun = result;
        lastCompletedAt = result?.at ?? new Date().toISOString();
      }
    } catch (err) {
      // 兜底：runGtdSyncOnce 已逐步吞错，这里防的是它自己意外抛——
      // 定时回调里的 rejection 没人接，会变成未捕获异常把循环整死。
      console.warn('[notion-gtd] 本轮失败:', err.message);
      lastRun = { error: err.message, at: new Date().toISOString() };
    } finally {
      clearTimeout(timer);
      currentStep = null;
      inFlight = false;
    }
  }, ms);
  if (typeof loopTimer?.unref === 'function') loopTimer.unref();
  console.log(`[notion-gtd] 同步循环已启动（${ms}ms，since=${env.QIUMI_SYNC_SINCE}，整轮超时 ${roundTimeoutMs}ms）`);
  return { started: true, running: true };
}

/** scheduler-jobs handler：只确保循环在跑并回报上次结果，立即返回，不阻塞 60s 串行轮。liveness_at = 最后一轮真正跑完的时刻。 */
export async function gtdSyncJobHandler(pool, opts = {}) {
  const s = ensureGtdSyncLoop(pool, opts);
  return { loop: s.running ? 'running' : 'disabled', lastRun, liveness_at: lastCompletedAt };
}
