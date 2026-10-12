/**
 * notion-relay-projection.js — 接力棒·投影（PR3，主理人 2026-09-23 拍板）
 *
 * 三面模型口径下的两根新血管：
 *   1. project 根 → Notion「Projects」库（镜子 🔒）：一页 = 一条链。属性：Status / AI Project /
 *      Run ID / Remark（几棒完成、几条待拍板）；正文：目标、有序子任务、待拍板、最近交接。
 *      指纹存 tasks.notion_props.project_digest，没变不推；页被删自动重建。
 *   2. 接力棒待拍板决策（decisions.status='pending', trigger='handoff'）→ Notion「决策」库草案
 *      （入口 ✍️ 方向改 both）：主理人在 Notion 把 状态 改成「已决定」，入口回灌更新同一行并
 *      自动登记「执行拍板」子任务挂根——链自己往下走。
 */
import { createHash } from 'node:crypto';
import { notionReq as defaultNotionReq, getToken } from './recurring-notion-sync.js';
import { isWrongDatabaseError } from './lib/notion-projection-engine.js';
import { normalizeBrief } from './lib/project-brief.js';
import { PROJECTS_DB, PROJECT_STATUS_TO_NOTION, brainHuman, humanProps, HUMAN_COLUMNS } from './lib/project-notion-human.js';
import { pullProjects, ingestProjectPage } from './project-notion-ingest.js';
export { PROJECTS_DB, PROJECT_STATUS_TO_NOTION };


export const DECISIONS_INLET_DB = 'f93e1918-56c1-4f31-9a41-36aa76a1c9c2';
export const BRAIN_PUBLIC_URL = process.env.BRAIN_PUBLIC_URL || 'http://100.79.41.61:5221';

const STATUS_GLYPH = Object.freeze({ completed: '✅', in_progress: '🔄', queued: '⏳', blocked: '⛔', failed: '❌', cancelled: '🚫', canceled: '🚫' });
const MAX_BLOCKS = 60;
const RT_MAX = 1900;

function rt(text) {
  return [{ type: 'text', text: { content: String(text ?? '').slice(0, RT_MAX) } }];
}
function heading(text) { return { object: 'block', type: 'heading_2', heading_2: { rich_text: rt(text) } }; }
function para(text) { return { object: 'block', type: 'paragraph', paragraph: { rich_text: rt(text) } }; }
function bullet(text) { return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(text) } }; }

export function digestOf(props, blocks) {
  return createHash('sha1').update(JSON.stringify({ p: props, b: blocks })).digest('hex');
}

/**
 * 一条链的快照：有序子任务 / 待拍板 / 最近交接。
 * 棒1（决策 ee4842a6/3feeae3e）：root 现在是 projects 行，全部按 project_id 取
 * （不再是 tasks.parent_task_id 递归——root.id 是 projects.id，不是 task id）。
 */
export async function buildProjectSnapshot(pool, root) {
  const { rows: children } = await pool.query(
    `SELECT id, title, status, task_type, sequence_no, completed_at,
            result->'handoff'->>'verdict' AS verdict,
            result->'handoff'->'done'->>0 AS last_done
       FROM tasks WHERE project_id = $1::uuid AND task_type <> 'project'
      ORDER BY sequence_no NULLS LAST, created_at`,
    [root.id]
  );
  const { rows: pending } = await pool.query(
    `SELECT id, topic, decision, priority, created_at FROM decisions
      WHERE status = 'pending' AND trigger = 'handoff' AND context->>'project_id' = $1
      ORDER BY created_at DESC LIMIT 20`,
    [String(root.id)]
  );
  const { rows: logRows } = await pool.query(
    `SELECT e AS entry FROM tasks t,
            jsonb_array_elements(COALESCE(t.result->'handoff_log', '[]'::jsonb)) e
      WHERE t.project_id = $1::uuid AND t.task_type <> 'project'
      ORDER BY e->>'at' DESC LIMIT 10`,
    [root.id]
  );
  return { children, pending, log: logRows.map((r) => r.entry) };
}

export function buildProjectProps(root, snap) {
  const total = snap.children.length;
  const done = snap.children.filter((c) => c.status === 'completed').length;
  const latest = snap.log[0];
  const remark = [
    total ? `${done}/${total} 棒完成` : '尚无子任务',
    snap.pending.length ? `待拍板 ${snap.pending.length}` : null,
    latest ? `最近：${String(latest.done?.[0] || latest.title || '').slice(0, 80)}` : null,
  ].filter(Boolean).join(' · ');
  return {
    Name: { title: rt(String(root.title || root.name || root.id).slice(0, 180)) },
    ...humanProps(brainHuman(root, root.notion_props?.human_baseline)),
    'AI Project': { checkbox: true },
    'Run ID': { rich_text: rt(`brain:${root.id}`) },
    'AI 进展': { rich_text: rt(remark) },
  };
}

/**
 * brief → Notion blocks（棒2）：目标/现状/已知事实/未决问题/变更日志最近 10 条。
 * fallbackGoal：brief.goal 还没人写过（新建项目/老项目未走过 brief_delta）时，退回 projects.description
 * ——不能因为上了 brief 就让存量项目页突然"目标"变空。
 */
function buildBriefBlocks(brief, fallbackGoal) {
  const b = normalizeBrief(brief);
  const blocks = [];
  blocks.push(heading('目标'));
  blocks.push(para(b.goal || fallbackGoal || '（未写目标）'));
  blocks.push(heading('现状'));
  blocks.push(para(b.status || '（未写现状）'));
  blocks.push(heading('已知事实'));
  if (!b.facts.length) blocks.push(para('（无）'));
  for (const f of b.facts.slice(-8)) blocks.push(bullet(f));
  blocks.push(heading('未决问题'));
  const openQs = b.open_questions.filter((q) => !q.closed_by_task);
  if (!openQs.length) blocks.push(para('（无）'));
  for (const q of openQs.slice(0, 8)) blocks.push(bullet(q.text));
  blocks.push(heading('变更日志（最近 10 条）'));
  const recent = b.changelog.slice(-10).reverse();
  if (!recent.length) blocks.push(para('（无）'));
  for (const e of recent) {
    const when = String(e.at || '').slice(0, 16).replace('T', ' ');
    blocks.push(bullet(`${when} · ${e.kind} · ${e.summary}`));
  }
  return blocks;
}

export function buildProjectBody(root, snap) {
  const blocks = [...buildBriefBlocks(root.brief, root.description)];
  blocks.push(heading(`链（${snap.children.length} 棒）`));
  if (!snap.children.length) blocks.push(para('还没有子任务。下一棒会由上一棒的 handoff.next_steps 自动登记。'));
  for (const c of snap.children.slice(0, 25)) {
    const glyph = STATUS_GLYPH[c.status] || '•';
    const tail = c.last_done ? ` — ${String(c.last_done).slice(0, 90)}` : '';
    blocks.push(bullet(`${c.sequence_no ?? '?'}. ${glyph} ${c.title}${tail}`));
  }
  blocks.push(heading(`待拍板（${snap.pending.length}）`));
  if (!snap.pending.length) blocks.push(para('没有等你的事。'));
  for (const d of snap.pending.slice(0, 10)) blocks.push(bullet(`[${d.priority || 'P2'}] ${d.topic} — 去「决策」库把状态改成「已决定」并写结论`));
  blocks.push(heading('最近交接'));
  if (!snap.log.length) blocks.push(para('还没有交接记录。'));
  for (const e of snap.log.slice(0, 10)) {
    const when = String(e.at || '').slice(0, 16).replace('T', ' ');
    const first = e.done?.[0] ? `：${String(e.done[0]).slice(0, 100)}` : '';
    blocks.push(bullet(`${when} · ${e.title || e.task_id} · ${e.verdict || '-'}${first}`));
  }
  blocks.push(para(`状态、优先级、备注、截止日期和 AI 参与可编辑，每 5 分钟与 Brain 同步。项目记录：${BRAIN_PUBLIC_URL}/api/brain/projects/${root.id}`));
  return blocks.slice(0, MAX_BLOCKS);
}

/** 整页正文替换：删旧块再追加（镜子页，正文完全由 Brain 拥有） */
export async function replacePageBody(notionReq, token, pageId, blocks) {
  const existing = await notionReq(token, `/blocks/${pageId}/children?page_size=100`, 'GET');
  for (const b of existing?.results || []) {
    await notionReq(token, `/blocks/${b.id}`, 'DELETE');
  }
  if (blocks.length) await notionReq(token, `/blocks/${pageId}/children`, 'PATCH', { children: blocks });
}

// 页被删(404)、页/库进回收站(400 archived ancestor)，或 legacy notion_id 指向错库(400 schema 不符，
// 如旧 Cecelia Tasks 库页) → PATCH 永远失败，都放弃旧页、在 Projects 库重建
function isGone(err) {
  return /404|Could not find|archived ancestor/i.test(String(err?.message || '')) || isWrongDatabaseError(err);
}

/**
 * projects 行 → Projects 库。返回 {pushed, skipped, failed}。
 * 棒1（决策 ee4842a6/3feeae3e）：数据源从 tasks(task_type='project') 改为 projects 表；
 * Notion 页 id / 指纹不再是 tasks 顶层列，挪进 projects.notion_props（该表没有独立 notion_id 列）。
 */
export async function pushProjectRoots(pool, token, { notionReq = defaultNotionReq, dbId = PROJECTS_DB, log = console } = {}) {
  const stat = { pushed: 0, skipped: 0, failed: 0 };
  const { rows: roots } = await pool.query('SELECT *, name AS title FROM projects ORDER BY updated_at DESC, id');
  for (let root of roots) {
    try {
      const snap = await buildProjectSnapshot(pool, root);
      let props = buildProjectProps(root, snap);
      const body = root.metadata?.source === 'notion' ? [] : buildProjectBody(root, snap);
      const bodyDigest = digestOf({}, body);
      let digest = digestOf(props, body);
      let pageId = root.notion_props?.notion_id;
      if (pageId && root.notion_props?.project_digest === digest) { stat.skipped++; continue; }
      let page;
      if (pageId) {
        try {
          page = await notionReq(token, `/pages/${pageId}`, 'GET');
          if (page.archived || page.in_trash ||
              (page.parent?.database_id && page.parent.database_id.replaceAll('-', '') !== dbId.replaceAll('-', ''))) {
            pageId = null;
            page = null;
          }
        } catch (err) {
          if (!isGone(err)) throw err;
          pageId = null;
        }
      }
      if (!pageId) {
        // 上轮建页成功但保存 notion_id 失败，按稳定 Run ID 找回，禁止再次建页。
        const found = await notionReq(token, `/databases/${dbId}/query`, 'POST', {
          filter: { property: 'Run ID', rich_text: { equals: `brain:${root.id}` } }, page_size: 100,
        });
        page = (found.results || []).find(p => !p.archived && !p.in_trash);
        pageId = page?.id;
      }
      if (pageId) {
        // 在覆盖任何人工列前重读并落库；行锁避免覆盖同时发生的 API 编辑。
        root = await ingestProjectPage(pool, token, page, { notionReq, dbId, log }) || root;
        props = buildProjectProps(root, snap);
        digest = digestOf(props, body);
      }
      const values = brainHuman(root, root.notion_props?.human_baseline);
      await pool.query(`UPDATE projects SET notion_props = notion_props || jsonb_build_object('pending_human_push', $2::jsonb) WHERE id = $1`,
        [root.id, JSON.stringify(values)]);
      const outgoing = { ...props };
      if (pageId) {
        const baselineProps = humanProps(root.notion_props?.human_baseline || values);
        for (const col of HUMAN_COLUMNS) {
          if (col === 'AI 参与' && !page.properties?.[col]?.select) continue;
          if (JSON.stringify(outgoing[col]) === JSON.stringify(baselineProps[col])) delete outgoing[col];
        }
        try { await notionReq(token, `/pages/${pageId}`, 'PATCH', { properties: outgoing }); }
        catch (err) {
          if (!isGone(err)) throw err;
          pageId = null;
          page = null;
        }
      }
      if (!pageId) {
        const created = await notionReq(token, '/pages', 'POST', { parent: { database_id: dbId }, properties: props, children: body });
        pageId = created.id;
      }
      // 属性一成功就落基线，正文失败不得把自写回声当成人工编辑。
      await pool.query(`UPDATE projects SET notion_props = (notion_props - 'pending_human_push') ||
        jsonb_build_object('human_baseline', $2::jsonb, 'notion_id', $3::text, 'project_db', $4::text) WHERE id = $1`,
        [root.id, JSON.stringify(values), pageId, dbId]);
      if (page && body.length && root.notion_props?.body_digest !== bodyDigest) await replacePageBody(notionReq, token, pageId, body);
      await pool.query(`UPDATE projects SET notion_props = notion_props ||
        jsonb_build_object('notion_id', $2::text, 'project_digest', $3::text, 'project_db', $4::text, 'body_digest', $5::text) WHERE id = $1`,
        [root.id, pageId, digest, dbId, bodyDigest]);
      stat.pushed++;
    } catch (err) {
      stat.failed++;
      log.warn(`[relay-projection] project ${root.id} 推送失败: ${err.message}`);
    }
  }
  return stat;
}

export function buildPendingDecisionProps(d, { rootNotionId = null } = {}) {
  const ctx = d.context && typeof d.context === 'object' ? d.context : {};
  const bg = [d.reason, ctx.task_title ? `来自任务：${ctx.task_title}` : null].filter(Boolean).join('\n');
  return {
    '决策': { title: rt(String(d.topic || '').slice(0, 180)) },
    '状态': { select: { name: '草案' } },
    '类型': { select: { name: '项目' } },
    '结论': { rich_text: rt(d.decision || '') },
    '背景': { rich_text: rt(bg) },
    '来源': { url: `${BRAIN_PUBLIC_URL}/api/brain/tasks/${ctx.task_id || ''}` },
    ...(rootNotionId ? { '项目': { relation: [{ id: rootNotionId }] } } : {}),
  };
}

/**
 * 待拍板决策 → 「决策」库草案（只推一次；主理人改状态后由入口回灌接手）。
 * 棒1（决策 ee4842a6/3feeae3e）：项目页现在是 projects 行，Notion 页 id 存在
 * projects.notion_props.notion_id 里（不是 tasks.notion_id）。context.project_id 是新写法；
 * 老决策只有 root_task_id（指向历史 task_type=project 根）时，通过该根 task 的 project_id 兼容找到同一行。
 */
export async function pushPendingDecisions(pool, token, { notionReq = defaultNotionReq, dbId = DECISIONS_INLET_DB, log = console } = {}) {
  const stat = { pushed: 0, failed: 0 };
  const { rows } = await pool.query(
    `SELECT d.id, d.topic, d.decision, d.reason, d.context, d.priority, r.notion_props->>'notion_id' AS root_notion_id
       FROM decisions d
       LEFT JOIN tasks t ON t.id::text = d.context->>'root_task_id'
       LEFT JOIN projects r ON r.id::text = COALESCE(d.context->>'project_id', t.project_id::text)
      WHERE d.status = 'pending' AND d.trigger = 'handoff' AND d.notion_id IS NULL
      ORDER BY d.created_at LIMIT 20`
  );
  for (const d of rows) {
    try {
      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: dbId },
        properties: buildPendingDecisionProps(d, { rootNotionId: d.root_notion_id }),
      });
      await pool.query(`UPDATE decisions SET notion_id = $2, notion_synced_at = NOW() WHERE id = $1`, [d.id, page.id]);
      stat.pushed++;
    } catch (err) {
      stat.failed++;
      log.warn(`[relay-projection] 待拍板 ${d.id} 推送失败: ${err.message}`);
    }
  }
  return stat;
}

/** 调度入口：先拉后推；专用连接锁防多调度器同时导入。 */
export async function runRelayProjection(pool, deps = {}) {
  let token;
  try { token = deps.token || getToken(); } catch { return { ok: false, reason: 'no_token' }; }
  const notionReq = deps.notionReq || defaultNotionReq;
  const dbId = deps.dbId || PROJECTS_DB;
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('projects-notion-sync')) AS locked");
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { ok: false, reason: 'busy' };
    await ensureProjectColumns(token, notionReq, dbId);
    const pulled = await pullProjects(client, token, { ...deps, notionReq, dbId });
    if (pulled.failed) return { ok: false, reason: 'pull_failed', pulled };
    const projects = await pushProjectRoots(client, token, { ...deps, notionReq, dbId });
    const decisions = await pushPendingDecisions(client, token, { ...deps, notionReq, dbId: DECISIONS_INLET_DB });
    return { ok: projects.failed === 0 && decisions.failed === 0, pulled, projects, decisions };
  } finally {
    try { if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('projects-notion-sync'))"); }
    finally { client.release(); }
  }
}

export async function ensureProjectColumns(token, notionReq, dbId = PROJECTS_DB) {
  const db = await notionReq(token, `/databases/${dbId}`, 'GET');
  const required = { 'AI 参与': { select: { options: ['知情', '盯着', '介入'].map(name => ({ name })) } },
    'AI 进展': { rich_text: {} } };
  const missing = {};
  for (const [key, value] of Object.entries(required)) {
    if (!db.properties?.[key]) missing[key] = value;
    else if (db.properties[key].type !== Object.keys(value)[0]) throw new Error(`项目列 ${key} 类型不符`);
  }
  if (Object.keys(missing).length) await notionReq(token, `/databases/${dbId}`, 'PATCH', { properties: missing });
}
