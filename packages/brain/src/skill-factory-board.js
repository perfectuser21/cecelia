/**
 * 技能工厂看板（任务 1b3c0000；决策 bf7d8753 / 5826ddd7 / 6ec463c3 / 1b469079 / 9b3b027b，五块模型 de6dff5d）。
 *
 * Brain 阶段任务 → Notion「技能工厂看板」库，一条流程一行（单向投影，Notion 只看不改）。
 * 阶段任务 = payload.stage 或正文【执行参数】「阶段：试跑/探索/验证/沉淀/重跑/固化/退役」的任务；
 * 执行单（带「计数阶段任务」或挂在阶段任务下）与审计单不算阶段任务。同一流程取最新一张阶段任务。
 * 连续通过 = 工位 bin/count_streak.py 同一套规则（只数挂在阶段任务下的执行单 + 审计单）；子任务读不到写「无法计数」，不当 0。
 * 运行结果 blocked 取 result.delivery.claimed_result（Brain 任务状态不收 blocked，执行者只能以 failed 落库）。
 * 库 id 只认 notion_projection_map 里 vessel=BOARD_VESSEL 的登记，没登记整段跳过；页身份 = projection_links + 「Brain ID」列。
 */
import { createHash } from 'node:crypto';
import { getToken as defaultGetToken, notionReq as defaultNotionReq } from './recurring-notion-sync.js';
import { propsDigest, isPageGoneError } from './lib/notion-projection-engine.js';

export const BOARD_VESSEL = 'skill-factory-board';
const LINK_TARGET = 'notion-skill-factory';
const LINK_TYPE = 'skill_factory_flow';
const GATE_INTERVAL_MS = 300_000;
let lastRunAt = 0;
/** 测试用：重置自 gate */
export function _resetSkillFactoryBoardGate() { lastRunAt = 0; }

const STAGES = ['试跑', '探索', '验证', '沉淀', '固化', '退役'];
const STAGE_EN = Object.freeze({ trial: '试跑', explore: '探索', verify: '验证', distill: '沉淀', rerun: '沉淀', solidify: '固化', retire: '退役' });
const COUNTING = Object.freeze({ 验证: 10, 沉淀: 30 }); // 默认 K（决策 6ec463c3），阶段任务【执行参数】K 优先
const RESULTS = ['success', 'failed', 'blocked', '进行中', '排队中', '已取消', '未运行'];

/** Notion 库列（建库与推送共用） */
export const BOARD_DB_PROPS = Object.freeze({
  '流程': { title: {} },
  '树上坐标': { rich_text: {} },
  '当前阶段': { select: { options: STAGES.map(name => ({ name })) } },
  'skill@版本': { rich_text: {} },
  '连续通过': { rich_text: {} },
  '最近运行结果': { select: { options: RESULTS.map(name => ({ name, color: { success: 'green', failed: 'red', blocked: 'orange' }[name] || 'default' })) } },
  '卡点': { rich_text: {} },
  '裁判结论': { rich_text: {} },
  '生产版本': { rich_text: {} },
  '最近更新': { date: {} },
  '阶段任务': { url: {} },
  '阶段任务ID': { rich_text: {} },
  'Brain ID': { rich_text: {} },
});

const PARAM_BLOCK = /【执行参数】([\s\S]*?)(?:【执行参数结束】|$)/;
const PARAM_LINE = /^\s*([^:：\n]+?)\s*[:：]\s*(.*?)\s*$/;
/** 取正文【执行参数】块里的「键：值」行；键 Skill / skill 统一成 skill（同 count_streak.py parse_params） */
export function parseParams(body) {
  const m = PARAM_BLOCK.exec(body || '');
  const out = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const lm = PARAM_LINE.exec(line);
    if (!lm) continue;
    const key = lm[1].trim().toLowerCase() === 'skill' ? 'skill' : lm[1].trim();
    out[key] = lm[2].trim();
  }
  return out;
}

/** 连续通过计数，逐行对照 count_streak.py count_streak；runs 按时间从旧到新 */
export function countStreak(runs, k) {
  const res = { k, streak: 0, reached: false, current: null, counted: [], voided: [], pending: [], unverifiable: [], duplicate_input: [], reset_by: null };
  const newest = [...runs].reverse();
  const head = newest.find(r => r.skill);
  if (!head) { res.pending = newest.filter(r => r.verdict == null).map(r => r.id); return res; }
  res.current = { skill: head.skill, slice_digest: head.slice_digest ?? null };
  const seen = new Set();
  for (const r of newest) {
    if (r.verdict == null) { res.pending.push(r.id); continue; }
    if (!r.skill || !r.input) { res.unverifiable.push(r.id); continue; }
    if (r.skill !== res.current.skill) { res.reset_by = { run: r.id, reason: `版本变了：${r.skill} → ${res.current.skill}` }; break; }
    if ((r.slice_digest ?? null) !== res.current.slice_digest) { res.reset_by = { run: r.id, reason: `处置表片指纹变了：${r.slice_digest} → ${res.current.slice_digest}` }; break; }
    if (r.verdict === 'pass') {
      if (seen.has(r.input)) { res.duplicate_input.push(r.id); continue; }
      seen.add(r.input); res.counted.push(r.id); continue;
    }
    if (r.external_cause) { res.voided.push(r.id); continue; }
    res.reset_by = { run: r.id, reason: '失败（非外部原因）' }; break;
  }
  res.streak = res.counted.length;
  res.reached = res.streak >= k;
  return res;
}

const bodyOf = t => t?.payload?.qiumi_source?.body || t?.description || '';
/** 阶段：payload.stage（英文）优先，其次【执行参数】阶段（中文，重跑归沉淀）；认不出返回 null */
export function stageOf(task, params) {
  const en = STAGE_EN[String(task?.payload?.stage || '').toLowerCase()];
  if (en) return en;
  const zh = String(params?.['阶段'] || '').trim();
  if (zh === '重跑') return '沉淀';
  return STAGES.includes(zh) ? zh : null;
}
/** 流程名 = 树上坐标最后一段（段间是带空格的「 · 」，名字里的「·」不拆）；没坐标用 payload.flow_name，再不行用标题 */
export function flowNameOf(task, params) {
  const coord = params?.['树上坐标'];
  if (coord) return coord.split(/\s+·\s+/).pop().trim();
  return String(task?.payload?.flow_name || task?.title || '').trim();
}
const norm = s => String(s || '').replace(/\s+/g, '');
/** 流程行稳定身份：去空白后的流程名 md5 → uuid 形状（projection_links.entity_id 是 uuid） */
export function flowKey(name) {
  const h = createHash('md5').update(norm(name)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function runResult(task) {
  if (!task) return '未运行';
  const claimed = task.result?.delivery?.claimed_result || task.result?.claimed_result;
  if (task.status === 'blocked' || claimed === 'blocked') return 'blocked';
  if (['completed', 'completed_no_pr'].includes(task.status)) return 'success';
  if (task.status === 'failed') return 'failed';
  if (task.status === 'in_progress') return '进行中';
  if (task.status === 'queued') return '排队中';
  if (['cancelled', 'canceled'].includes(task.status)) return '已取消';
  return task.status || '未运行';
}
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** skill 字段可能是「名@版本」，也可能是整份 skill 正文（试跑交付 flow_skill_v1）：正文取 frontmatter name@version，否则截短 */
export function skillLabel(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const front = /^---\s*\n([\s\S]*?)\n---/.exec(s);
  if (front) {
    const field = k => (new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(front[1]) || [])[1]?.trim();
    if (field('name')) return field('version') ? `${field('name')}@${field('version')}` : field('name');
  }
  return clip(s.split('\n')[0], 80);
}
const firstSentence = s => String(s || '').split(/[。；;]/)[0].trim(); // 卡点只要一句话
const ts = v => (v ? new Date(v).getTime() : 0);

function summarizeJudgments(wf) {
  if (!wf) return { judge: '树上没找到这个流程', release: '树上没找到这个流程' };
  const acts = wf.activities || [];
  if (!acts.length) return { judge: '还没拆成 Activity，暂无裁判', release: '还没拆成 Activity，暂无生产版本' };
  const labels = [['converged', '收敛'], ['converging', '收敛中'], ['diverged', '发散'], ['no_data', '无数据'], [null, '未裁判']];
  const parts = labels.map(([v, l]) => [l, acts.filter(a => (a.verdict ?? null) === v).length]).filter(([, n]) => n).map(([l, n]) => `${l} ${n}`);
  const rel = (wf.releases || []).filter(r => acts.some(a => a.id === r.activity_id));
  const conv = rel.filter(r => r.ever_converged).length;
  return { judge: `${acts.length} 个 Activity：${parts.join(' · ')}`,
    release: `${acts.length} 个 Activity 中 ${rel.length} 个有生产版（收敛过 ${conv}，冷启动 ${rel.length - conv}）` };
}

/**
 * 纯函数：源数据 → 看板行。
 * data = { stageTasks: 候选阶段任务, children: 阶段任务的子任务（null=读不到）, followups: 同父任务下进行中的修复单, workflows: [{id,name,activities,releases}] }
 */
export function buildBoardRows(data) {
  const candidates = (data.stageTasks || []).map(t => ({ t, p: parseParams(bodyOf(t)) }))
    .filter(({ t, p }) => t.task_type !== 'audit' && !p['计数阶段任务'] && stageOf(t, p));
  const stageIds = new Set(candidates.map(c => c.t.id));
  const latestByFlow = new Map();
  for (const c of candidates) {
    if (c.t.parent_task_id && stageIds.has(c.t.parent_task_id)) continue; // 挂在阶段任务下的是执行单
    const key = flowKey(flowNameOf(c.t, c.p));
    const cur = latestByFlow.get(key);
    if (!cur || ts(c.t.created_at) > ts(cur.t.created_at)) latestByFlow.set(key, c);
  }
  const wfByName = new Map((data.workflows || []).map(w => [norm(w.name), w]));
  const rows = [];
  for (const [key, { t, p }] of latestByFlow) {
    const flow = flowNameOf(t, p), stage = stageOf(t, p), wf = wfByName.get(norm(flow)) || null;
    const kids = data.children == null ? null : data.children.filter(c => c.parent_task_id === t.id);
    const execs = (kids || []).filter(c => c.task_type !== 'audit').sort((a, b) => ts(a.created_at) - ts(b.created_at));
    // 连续通过
    let streakText;
    if (!(stage in COUNTING)) streakText = `${stage}阶段不计数`;
    else if (kids == null) streakText = '无法计数';
    else {
      const k = Number.parseInt(p.K, 10) || COUNTING[stage];
      const audits = new Map();
      for (const a of kids.filter(c => c.task_type === 'audit')) {
        const src = a.payload?.source_task_id;
        if (src && (!audits.has(src) || ts(a.created_at) > ts(audits.get(src).created_at))) audits.set(src, a);
      }
      const runs = execs.map(e => {
        const ep = parseParams(bodyOf(e)), v = audits.get(e.id)?.result?.verification || {};
        return { id: e.id, skill: ep.skill || v.skill, slice_digest: ep['处置表片指纹'] || v.slice_digest, input: ep['输入'] || v.input,
          verdict: audits.has(e.id) ? (v.verdict ?? null) : null, external_cause: v.external_cause };
      });
      const r = countStreak(runs, k);
      streakText = runs.length && !r.current ? '无法计数（执行单缺 skill 版本）' : `${r.streak}/${k}${r.reached ? ' 已达标' : ''}`;
    }
    const lastRun = execs.at(-1) || t;
    const lastParams = execs.length ? parseParams(bodyOf(lastRun)) : {};
    const delivered = t.result?.delivery?.flow_skill || t.result?.delivery?.flow_skill_v1 || t.payload?.flow_skill;
    const skill = skillLabel(lastParams.skill) || skillLabel(delivered) || `整流程 skill 未产出（本阶段用 ${p['使用 skill'] || p.skill || t.payload?.skill || '未写'}）`;
    const result = runResult(lastRun);
    const parentId = t.parent_task_id || t.payload?.parent_task_id;
    const fixes = (data.followups || []).filter(f => parentId && f.parent_task_id === parentId && f.id !== t.id && ts(f.created_at) >= ts(t.created_at)
      && ['queued', 'in_progress'].includes(f.status));
    const reason = ['success', '进行中', '排队中'].includes(result) ? '' :
      firstSentence(lastRun.result?.delivery?.fail_reason || lastRun.result?.fail_reason || lastRun.result?.error || lastRun.blocked_reason || lastRun.error_message);
    const fixText = fixes.map(f => `修复中：${clip(f.title || f.id, 40)}（${f.status === 'in_progress' ? '进行中' : '排队中'}）`).join('；');
    const { judge, release } = summarizeJudgments(wf);
    const updated = [t, ...(kids || []), ...fixes].map(x => x.updated_at || x.created_at).filter(Boolean).sort((a, b) => ts(b) - ts(a))[0] ?? null;
    rows.push({ key, flow, coord: p['树上坐标'] || flow, stage, stageTask: t, workflowId: wf?.id ?? null, skill, streakText, result,
      blocker: [reason, fixText].filter(Boolean).join('；'), judge, release, updated });
  }
  return rows.sort((a, b) => ts(b.updated) - ts(a.updated));
}

const rich = v => ({ rich_text: v ? [{ text: { content: String(v).slice(0, 1900) } }] : [] });
/** 看板行 → Notion properties（与 BOARD_DB_PROPS 同列） */
export function buildBoardProps(r) {
  const nid = r.stageTask.notion_id ? String(r.stageTask.notion_id).replaceAll('-', '') : null;
  return {
    '流程': { title: [{ text: { content: r.flow.slice(0, 200) } }] },
    '树上坐标': rich(r.coord),
    '当前阶段': { select: { name: r.stage } },
    'skill@版本': rich(r.skill),
    '连续通过': rich(r.streakText),
    '最近运行结果': { select: { name: r.result } },
    '卡点': rich(r.blocker),
    '裁判结论': rich(r.judge),
    '生产版本': rich(r.release),
    '最近更新': { date: r.updated ? { start: new Date(r.updated).toISOString() } : null },
    '阶段任务': { url: nid ? `https://www.notion.so/${nid}` : null },
    '阶段任务ID': rich(r.stageTask.id),
    'Brain ID': rich(r.key),
  };
}

const TASK_COLS = 'id,title,status,task_type,description,payload,result,parent_task_id,notion_id,blocked_reason,error_message,created_at,updated_at';
/** 读源（cecelia 库）：候选阶段任务 → 子任务 → 同父修复单 → 树上流程（Activity 最新裁判 + 生产指针） */
export async function loadBoardSource(pool) {
  const stageTasks = (await pool.query(`SELECT ${TASK_COLS} FROM tasks
    WHERE task_type IS DISTINCT FROM 'audit' AND created_at > now() - interval '180 days'
      AND (payload ? 'stage' OR (COALESCE(payload->'qiumi_source'->>'body', description) LIKE '%【执行参数】%'
        AND COALESCE(payload->'qiumi_source'->>'body', description) ~ '阶段\\s*[:：]'))
    ORDER BY created_at DESC LIMIT 500`)).rows;
  const ids = stageTasks.map(t => t.id);
  let children = null;
  try { children = (await pool.query(`SELECT ${TASK_COLS} FROM tasks WHERE parent_task_id = ANY($1::uuid[])`, [ids])).rows; }
  catch (err) { console.warn(`[skill-factory-board] 子任务读不到，连续通过写「无法计数」: ${err.message}`); }
  const parents = [...new Set(stageTasks.map(t => t.parent_task_id || t.payload?.parent_task_id).filter(Boolean))]
    .filter(id => /^[0-9a-f-]{36}$/i.test(id));
  const followups = parents.length ? (await pool.query(`SELECT ${TASK_COLS} FROM tasks
    WHERE parent_task_id = ANY($1::uuid[]) AND status IN ('queued','in_progress')`, [parents])).rows : [];
  const workflows = (await pool.query(`SELECT w.id, w.name,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.activity_id, 'verdict',
        (SELECT j.verdict FROM activity_judgments j WHERE j.activity_id = r.activity_id ORDER BY j.judged_at DESC, j.id DESC LIMIT 1)))
        FROM (SELECT DISTINCT activity_id FROM workflow_activity_refs WHERE workflow_id = w.id AND active) r), '[]'::jsonb) AS activities,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('activity_id', s.activity_id, 'version_no', v.version_no, 'ever_converged',
        EXISTS(SELECT 1 FROM activity_release_events e WHERE e.activity_id = s.activity_id AND e.to_version_id = s.production_version_id
          AND e.kind IN ('promote','group_promote') AND e.gate->>'converged' = 'true')))
        FROM activity_release_state s JOIN activity_versions v ON v.id = s.production_version_id
        WHERE s.activity_id IN (SELECT activity_id FROM workflow_activity_refs WHERE workflow_id = w.id AND active)), '[]'::jsonb) AS releases
    FROM workflows w`)).rows;
  return { stageTasks, children, followups, workflows };
}

async function resolveBoardDb(pool) {
  const { rows } = await pool.query(`SELECT notion_db_id FROM notion_projection_map
    WHERE vessel = $1 AND direction IN ('push','both') AND status = 'active' LIMIT 1`, [BOARD_VESSEL]);
  return rows[0]?.notion_db_id || null;
}
const saveLink = (pool, key, pageId, digest) => pool.query(`INSERT INTO projection_links(target,entity_type,entity_id,external_id,content_hash,last_synced_at)
  VALUES('${LINK_TARGET}','${LINK_TYPE}',$1,$2,$3,NOW()) ON CONFLICT(target,entity_type,entity_id) DO UPDATE SET
  external_id=EXCLUDED.external_id,content_hash=EXCLUDED.content_hash,last_synced_at=NOW(),updated_at=NOW()`, [key, pageId, digest]);

/** 推一行：内容指纹没变不写；链接页没了（404/回收站）清链接按 Brain ID 重找或重建；没链接先按 Brain ID 认领旧页，杜绝重复页 */
async function pushRow(pool, token, dbId, row, notionReq) {
  const properties = buildBoardProps(row), digest = propsDigest({ database_id: dbId, properties });
  const link = (await pool.query(`SELECT entity_id, external_id, content_hash FROM projection_links
    WHERE target='${LINK_TARGET}' AND entity_type='${LINK_TYPE}' AND entity_id=$1`, [row.key])).rows[0];
  if (link?.content_hash === digest) return 'unchanged';
  if (link) {
    try { await notionReq(token, `/pages/${link.external_id}`, 'PATCH', { properties }); await saveLink(pool, row.key, link.external_id, digest); return 'updated'; }
    catch (err) {
      if (!isPageGoneError(err) && !/can't edit block that is archived/i.test(err?.message || '')) throw err;
      await pool.query(`DELETE FROM projection_links WHERE target='${LINK_TARGET}' AND entity_type='${LINK_TYPE}' AND entity_id=$1`, [row.key]);
    }
  }
  const found = await notionReq(token, `/databases/${dbId}/query`, 'POST', { filter: { property: 'Brain ID', rich_text: { equals: row.key } }, page_size: 10 });
  const live = (found?.results || []).filter(p => !p.archived && !p.in_trash);
  if (live.length > 1) throw new Error(`技能工厂看板 Brain ID 重复页：${row.flow}`);
  if (live[0]) {
    await notionReq(token, `/pages/${live[0].id}`, 'PATCH', { properties });
    await saveLink(pool, row.key, live[0].id, digest);
    return 'updated';
  }
  const page = await notionReq(token, '/pages', 'POST', { parent: { database_id: dbId }, properties });
  if (!page?.id) throw new Error('技能工厂看板建页没返回 id');
  await saveLink(pool, row.key, page.id, digest);
  return 'created';
}

/** 定时入口（调度器每 60s 调，自 gate 5 分钟一轮）。返回 { skipped } 或 { rows, created, updated, unchanged, failed } */
export async function runSkillFactoryBoardPush(pool, deps = {}) {
  const { notionReq = defaultNotionReq, getToken = defaultGetToken, now = Date.now, loadSource = loadBoardSource } = deps;
  const nowMs = now();
  if (lastRunAt && nowMs - lastRunAt < GATE_INTERVAL_MS) return { skipped: true };
  lastRunAt = nowMs;
  const dbId = await resolveBoardDb(pool);
  if (!dbId) return { skipped: 'db_not_registered' };
  let token;
  try { token = getToken(); } catch { return { skipped: 'no_token' }; }
  const rows = buildBoardRows(await loadSource(pool));
  const stat = { rows: rows.length, created: 0, updated: 0, unchanged: 0, failed: 0, errors: [] };
  for (const row of rows) {
    try { stat[await pushRow(pool, token, dbId, row, notionReq)]++; }
    catch (err) { stat.failed++; stat.errors.push({ flow: row.flow, error: err.message }); }
  }
  if (stat.failed) throw new Error(`技能工厂看板 ${stat.failed}/${rows.length} 行推送失败：${stat.errors.map(e => `${e.flow}: ${e.error}`).join('；').slice(0, 500)}`);
  return stat;
}
