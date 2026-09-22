/**
 * notion-inlet-ingest.js — ✍️ 入口血管（三面模型 PR②b，决策 297ffee5）
 *
 * 入口库人写、Brain 收；机器不写入口库（受理凭据在 Brain 的 notion_ingest_receipts）。
 * 幂等：收据按 notion_page_id（文件类按 page#file）；页面 last_edited_time 更新 → 再收并在收据 history 留痕（冲突人赢）。
 * 两条血管：
 *   「决策」库(f93e) → decisions（只收 状态=已决定；类型→category 对齐 CHECK 白名单；made_by=user）
 *   员工「Ai超级员工系统｜Skill库」→ skill_evals（下载 zip → 复用 /api/skill-eval/upload 的校验/去重/排队）
 * 库 id 与开关来自 notion_projection_map（face=inlet, direction=ingest, status=active）。
 */
import { notionReq as defaultNotionReq, getToken } from './recurring-notion-sync.js';
import { loadProjectionMap } from './lib/notion-projection-registry.js';

export const NOTION_TYPE_TO_CATEGORY = Object.freeze({
  '战略': 'governance', '项目': 'scope-decision', '流程': 'process',
  '系统': 'technical', '人员': 'governance', '其他': 'general',
});

const text = (prop) => (prop?.[prop?.type] ?? prop?.rich_text ?? prop?.title ?? [])
  .map((t) => t.plain_text ?? t.text?.content ?? '').join('').trim();
const sel = (prop) => prop?.select?.name ?? prop?.status?.name ?? null;

/** 「决策」库一页 → decisions 行；非「已决定」返回 null */
export function mapDecisionPage(page) {
  const p = page?.properties ?? {};
  if (sel(p['状态']) !== '已决定') return null;
  const topic = text(p['决策']);
  if (!topic) return null;
  const conclusion = text(p['结论']);
  const reason = [text(p['理由']), text(p['背景']) && `背景：${text(p['背景'])}`].filter(Boolean).join('\n');
  return {
    topic,
    decision: conclusion || topic,
    reason: reason || null,
    category: NOTION_TYPE_TO_CATEGORY[sel(p['类型'])] ?? 'decision',
    decided_at: p['决策日期']?.date?.start ?? null,
    made_by: 'user',
    author: 'notion-inlet',
    source_ref: `notion:${page.id}`,
  };
}

async function getReceipt(pool, key) {
  const { rows } = await pool.query(
    `SELECT notion_page_id, brain_table, brain_id, last_edited_time, history
       FROM notion_ingest_receipts WHERE notion_page_id = $1`, [key]);
  return rows[0] ?? null;
}
async function putReceipt(pool, { key, dbId, table, brainId, lastEdited }) {
  await pool.query(
    `INSERT INTO notion_ingest_receipts (notion_page_id, notion_db_id, brain_table, brain_id, last_edited_time, ingested_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (notion_page_id) DO UPDATE SET brain_id = EXCLUDED.brain_id, last_edited_time = EXCLUDED.last_edited_time, ingested_at = NOW()`,
    [key, dbId, table, brainId, lastEdited]);
}
async function queryAll(notionReq, token, dbId, body) {
  const out = []; let cursor;
  do {
    const r = await notionReq(token, `/databases/${dbId}/query`, 'POST', { page_size: 50, ...(cursor ? { start_cursor: cursor } : {}), ...body });
    out.push(...(r?.results ?? []));
    cursor = r?.has_more ? r?.next_cursor : null;
  } while (cursor && out.length < 500);
  return out;
}

/** 「决策」库 → decisions */
export async function ingestDecisionsInlet(pool, token, { dbId, notionReq = defaultNotionReq, log = console } = {}) {
  const stat = { inserted: 0, updated: 0, skipped: 0, failed: 0, resolved: 0 };
  const pages = await queryAll(notionReq, token, dbId, {
    filter: { property: '状态', select: { equals: '已决定' } },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
  });
  for (const page of pages) {
    try {
      const row = mapDecisionPage(page);
      if (!row) { stat.skipped++; continue; }
      const edited = new Date(page.last_edited_time);
      const rc = await getReceipt(pool, page.id);
      if (rc && new Date(rc.last_edited_time).getTime() >= edited.getTime()) { stat.skipped++; continue; }
      // 接力棒：这页是 Brain 推出去的待拍板（decisions.notion_id 命中且仍 pending）
      // → 更新同一行为 active（人赢），并自动登记「执行拍板」子任务挂链根，链自己往下走
      const pend = await pool.query(
        `SELECT id, context, priority FROM decisions WHERE notion_id = $1 AND status = 'pending' AND trigger = 'handoff'`,
        [page.id]);
      if (!rc && pend.rows[0]) {
        const d = pend.rows[0];
        await pool.query(
          `UPDATE decisions SET status = 'active', topic = $2, decision = $3, reason = COALESCE($4, reason), category = $5,
                  made_by = 'user', decided_at = COALESCE($6, NOW()), updated_at = NOW() WHERE id = $1`,
          [d.id, row.topic, row.decision, row.reason, row.category, row.decided_at]);
        await putReceipt(pool, { key: page.id, dbId, table: 'decisions', brainId: d.id, lastEdited: edited });
        const ctx = d.context && typeof d.context === 'object' ? d.context : {};
        if (ctx.root_task_id) {
          try {
            const { createRoutedTask } = await import('./work-routing-store.js');
            await createRoutedTask(pool, {
              source: 'child', source_id: `decision:${d.id}`,
              title: `执行拍板：${row.topic}`.slice(0, 200),
              description: `主理人结论：${row.decision}\n（决策 ${d.id}，来自任务 ${ctx.task_id || '-'}）`,
              requested_task_type: 'data', declared_domain: 'operations', mutation_intent: 'none',
              parent_task_id: ctx.root_task_id,
              metadata: { lane: 'AI', from_decision: d.id, relay_pending_resolved: true },
              task: { status: 'queued', priority: d.priority || 'P2', trigger_source: 'child' },
            });
          } catch (err) {
            log.warn(`[notion-inlet] 拍板 ${d.id} 已收，执行子任务登记失败: ${err.message}`);
          }
        }
        stat.resolved = (stat.resolved || 0) + 1;
        continue;
      }
      if (!rc) {
        const { rows } = await pool.query(
          `INSERT INTO decisions (category, topic, decision, reason, made_by, author, status, decided_at, source_ref)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8) RETURNING id`,
          [row.category, row.topic, row.decision, row.reason, row.made_by, row.author, row.decided_at, row.source_ref]);
        await putReceipt(pool, { key: page.id, dbId, table: 'decisions', brainId: rows[0].id, lastEdited: edited });
        stat.inserted++;
      } else {
        // 人改了 → 人赢；被覆盖前的值留痕进收据 history
        const prev = (await pool.query(`SELECT topic, decision, reason, category FROM decisions WHERE id = $1`, [rc.brain_id])).rows[0] ?? null;
        await pool.query(
          `UPDATE decisions SET topic = $2, decision = $3, reason = $4, category = $5, decided_at = COALESCE($6, decided_at), updated_at = NOW() WHERE id = $1`,
          [rc.brain_id, row.topic, row.decision, row.reason, row.category, row.decided_at]);
        await pool.query(
          `UPDATE notion_ingest_receipts
              SET last_edited_time = $2, ingested_at = NOW(),
                  history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', NOW(), 'overwritten', $3::jsonb))
            WHERE notion_page_id = $1`,
          [page.id, edited, JSON.stringify(prev)]);
        stat.updated++;
      }
    } catch (err) {
      stat.failed++;
      log.warn(`[notion-inlet] 决策 ${page.id} 收账失败: ${err.message}`);
    }
  }
  return stat;
}

/** 员工 Skill 库(zip) → /api/skill-eval/upload → skill_evals */
export async function ingestStaffSkillInlet(pool, token, {
  dbId, notionReq = defaultNotionReq, fetchFn = globalThis.fetch,
  brainBaseUrl = `http://localhost:${process.env.PORT || 5221}`,
  evalToken = process.env.EVAL_PROXY_TOKEN || '', log = console,
} = {}) {
  const stat = { uploaded: 0, skipped: 0, failed: 0 };
  const pages = await queryAll(notionReq, token, dbId, { filter: { property: 'Skill压缩包', files: { is_not_empty: true } } });
  for (const page of pages) {
    const p = page.properties ?? {};
    const skillName = text(p['Skill名称']) || 'unknown';
    const platform = p['适用平台']?.multi_select?.[0]?.name ?? null;
    const submitter = p['开发人员']?.people?.[0]?.name ?? null;
    for (const f of p['Skill压缩包']?.files ?? []) {
      const key = `${page.id}#${f.name}`;
      try {
        if (await getReceipt(pool, key)) { stat.skipped++; continue; }
        const url = f.file?.url ?? f.external?.url;
        if (!url || !/\.zip$/i.test(f.name)) { stat.skipped++; continue; }
        const dl = await fetchFn(url);
        if (!dl.ok) throw new Error(`下载 ${f.name} 失败: ${dl.status}`);
        const buf = Buffer.from(await dl.arrayBuffer());
        const form = new FormData();
        form.append('file', new Blob([buf], { type: 'application/zip' }), f.name);
        form.append('skill_name', skillName);
        if (platform) form.append('platform', platform);
        if (submitter) form.append('submitter', submitter);
        const res = await fetchFn(`${brainBaseUrl}/api/skill-eval/upload`, {
          method: 'POST', headers: { 'X-Eval-Proxy-Token': evalToken }, body: form,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`upload ${res.status}: ${json.error || ''}`);
        await putReceipt(pool, { key, dbId, table: 'skill_evals', brainId: json.task_id ?? null, lastEdited: new Date(page.last_edited_time) });
        stat.uploaded++;
      } catch (err) {
        stat.failed++;
        log.warn(`[notion-inlet] 员工skill ${key} 收账失败: ${err.message}`);
      }
    }
  }
  return stat;
}

const HANDLERS = { decisions: ingestDecisionsInlet, skill_evals: ingestStaffSkillInlet };
const GATE_MS = parseInt(process.env.NOTION_INLET_INGEST_INTERVAL_MS || String(5 * 60 * 1000), 10);
let lastRunAt = 0;

/** 调度入口（scheduler-jobs 每 60s 调，自 gate 5min）：遍历注册表里 active 的 inlet 血管 */
export async function runNotionInletIngest(pool, { now = Date.now, notionReq = defaultNotionReq } = {}) {
  if (now() - lastRunAt < GATE_MS) return { skipped: true };
  lastRunAt = now();
  let token;
  try { token = getToken(); } catch { return { ok: false, reason: 'no_token' }; }
  let map;
  try { map = await loadProjectionMap(pool); } catch { return { ok: false, reason: 'registry_unavailable' }; }
  const results = {};
  for (const r of map.byFace.inlet) {
    if (r.status !== 'active' || !['ingest', 'both'].includes(r.direction)) continue;
    const handler = HANDLERS[r.brain_table];
    if (!handler) continue;
    try { results[r.brain_table] = await handler(pool, token, { dbId: r.notion_db_id, notionReq }); }
    catch (err) { results[r.brain_table] = { error: err.message }; }
  }
  return { ok: true, results };
}
