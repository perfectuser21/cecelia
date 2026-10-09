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

export const PROJECTS_DB = 'd83c40c2-ba63-8323-8dc7-01cc291c4d9b';
export const DECISIONS_INLET_DB = 'f93e1918-56c1-4f31-9a41-36aa76a1c9c2';
export const BRAIN_PUBLIC_URL = process.env.BRAIN_PUBLIC_URL || 'http://100.79.41.61:5221';

export const PROJECT_STATUS_TO_NOTION = Object.freeze({
  queued: 'Not Started',
  pending: 'Not Started',
  in_progress: 'In Progress',
  blocked: 'On Hold',
  paused: 'On Hold',
  failed: 'On Hold',
  completed: 'Completed',
  cancelled: 'Discard',
  canceled: 'Discard',
});

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
    Name: { title: rt(String(root.title || root.id).slice(0, 180)) },
    Status: { status: { name: PROJECT_STATUS_TO_NOTION[root.status] || 'In Progress' } },
    'AI Project': { checkbox: true },
    'Run ID': { rich_text: rt(`brain:${root.id}`) },
    Remark: { rich_text: rt(remark) },
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
  blocks.push(para(`镜子 🔒 由 Brain 每 5 分钟刷新；改这页不会改真身。真身：${BRAIN_PUBLIC_URL}/api/brain/projects/${root.id}`));
  return blocks.slice(0, MAX_BLOCKS);
}

/** 整页正文替换：删旧块再追加（镜子页，正文完全由 Brain 拥有） */
export async function replacePageBody(notionReq, token, pageId, blocks) {
  const existing = await notionReq(token, `/blocks/${pageId}/children?page_size=100`, 'GET');
  for (const b of existing?.results || []) {
    try { await notionReq(token, `/blocks/${b.id}`, 'DELETE'); } catch { /* 已删/无权限：忽略 */ }
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
  const { rows: rawRoots } = await pool.query(
    `SELECT id, name AS title, description, status, brief, notion_props
       FROM projects
      WHERE status NOT IN ('cancelled','canceled','archived')
         OR updated_at > NOW() - INTERVAL '7 days'
      ORDER BY updated_at DESC LIMIT 30`
  );
  for (const raw of rawRoots) {
    const root = { ...raw, notion_id: raw.notion_props?.notion_id ?? null };
    try {
      const snap = await buildProjectSnapshot(pool, root);
      const props = buildProjectProps(root, snap);
      const body = buildProjectBody(root, snap);
      const digest = digestOf(props, body);
      if (root.notion_id && root.notion_props?.project_digest === digest) { stat.skipped++; continue; }
      let pageId = root.notion_id;
      if (pageId) {
        try {
          await notionReq(token, `/pages/${pageId}`, 'PATCH', { properties: props });
          await replacePageBody(notionReq, token, pageId, body);
        } catch (err) {
          if (!isGone(err)) throw err;
          pageId = null; // 页被删 → 重建
        }
      }
      if (!pageId) {
        const page = await notionReq(token, '/pages', 'POST', { parent: { database_id: dbId }, properties: props, children: body });
        pageId = page.id;
      }
      await pool.query(
        `UPDATE projects SET
                notion_props = COALESCE(notion_props,'{}'::jsonb) || jsonb_build_object('notion_id', $2::text, 'project_digest', $3::text, 'project_db', $4::text)
          WHERE id = $1::uuid`,
        [root.id, pageId, digest, dbId]
      );
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

/** 调度入口：挂在 legacy 推送之后。token 缺失静默返回。 */
export async function runRelayProjection(pool, deps = {}) {
  let token;
  try { token = deps.token || getToken(); } catch { return { ok: false, reason: 'no_token' }; }
  const projects = await pushProjectRoots(pool, token, deps);
  const decisions = await pushPendingDecisions(pool, token, deps);
  return { ok: true, projects, decisions };
}
