/**
 * handoff.js — 任务终态交接单（诊断方案 B，2026-07-02）
 *
 * 任务终态自动产一份"给下一个大脑读"的结构化交接单：
 *   - DB SSOT：tasks.result.handoff（JSONB 覆盖写，天然幂等）
 *   - 人读镜像：<HANDOFF_DOCS_DIR>/<yyyymmddHHMM>-<task8>.md（best-effort，不 git commit）
 * 下一次规划（runPlannerNode）按 journey 拉最近 N 份注入 prompt。
 *
 * 与既有件分工：A3 promote-regression 沉淀"行为"（golden_path/回归契约）、
 * harness-report 是给人看的报告；handoff 沉淀"进度与意图"。
 * Spec: docs/superpowers/specs/2026-07-02-handoff-automation-design.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { pushCaptureAtom } from './capture-inbox.js';

export const HANDOFF_SCHEMA_VERSION = 1;

const DEFAULT_DOCS_DIR = '/Users/administrator/perfect21/cecelia/docs/handoffs';
const MAX_ITEMS = 20;
const MAX_ITEM_LEN = 200;
const PROMPT_MAX_LEN = 2000;

// data_sources 固定基线：与 harness-planner Step 0.3/0.4 同源（A1）。
// 下一个大脑照单加载即可拿到本 line 的铁律 + 已验收行为 + 本单全文。
export const BASELINE_DATA_SOURCES = [
  'GET /api/brain/invariants?level=area',
  'GET /api/brain/invariants?target_type=journey_feature&target_id=<ability_id>',
  'GET /api/brain/journeys/<journey_id>/golden-paths',
  'GET /api/brain/tasks/<task_id>（result.handoff 本体）',
];

function clampList(list) {
  return (Array.isArray(list) ? list : [])
    .filter((x) => typeof x === 'string' && x.trim())
    .slice(0, MAX_ITEMS)
    .map((s) => (s.length > MAX_ITEM_LEN ? `${s.slice(0, MAX_ITEM_LEN)}…` : s));
}

export function buildHandoff(input = {}) {
  if (!input.task_id) throw new Error('buildHandoff: task_id is required');
  // 先 clamp 再判空：全为无效项（如 [42]）时也回落基线
  const dataSources = clampList(input.data_sources);
  return {
    schema_version: HANDOFF_SCHEMA_VERSION,
    task_id: input.task_id,
    initiative_id: input.initiative_id ?? null,
    journey_id: input.journey_id ?? null,
    title: input.title || '',
    verdict: input.verdict ?? null,
    done: clampList(input.done),
    not_done: clampList(input.not_done),
    next_steps: clampList(input.next_steps),
    data_sources: dataSources.length ? dataSources : clampList(BASELINE_DATA_SOURCES),
    decision_refs: clampList(input.decision_refs),
    artifacts: {
      pr_urls: clampList(input.artifacts?.pr_urls),
      sprint_dir: input.artifacts?.sprint_dir ?? null,
      branch: input.artifacts?.branch ?? null,
      docs: clampList(input.artifacts?.docs),
    },
    created_at: new Date().toISOString(),
  };
}

export function renderHandoffMarkdown(h) {
  const list = (arr, empty) => (arr.length ? arr.map((x) => `- ${x}`).join('\n') : `- （${empty}）`);
  return [
    `# Handoff：${h.title || h.task_id}`,
    '',
    `- task_id: ${h.task_id}`,
    `- initiative_id: ${h.initiative_id ?? 'N/A'}`,
    `- journey_id: ${h.journey_id ?? 'N/A'}`,
    `- verdict: ${h.verdict ?? 'N/A'}`,
    `- created_at: ${h.created_at}`,
    '',
    '## 完成了什么',
    list(h.done, '无'),
    '',
    '## 没完成什么',
    list(h.not_done, '无'),
    '',
    '## 下一步建议',
    list(h.next_steps, '无'),
    '',
    '## 数据源（下一个大脑要加载的）',
    list(h.data_sources, '无'),
    '',
    '## 关键决策引用',
    list(h.decision_refs, '无'),
    '',
    '## 产物指针',
    list(h.artifacts.pr_urls, '无 PR'),
    `- sprint_dir: ${h.artifacts.sprint_dir ?? 'N/A'}`,
    `- branch: ${h.artifacts.branch ?? 'N/A'}`,
    ...(h.artifacts.docs.length ? h.artifacts.docs.map((d) => `- doc: ${d}`) : []),
    '',
  ].join('\n');
}

/**
 * 推送 handoff capture_atom（saveHandoff 与 relay PATCH 路径共用，保证同口径）。
 * handoff 非普通非空对象（null/非 object/数组/keys==0）→ 返回 null，不写不抛。
 * 底层 pushCaptureAtom 吞错，本函数不阻塞任何主流程。
 */
export async function pushHandoffAtom(pool, taskId, handoff) {
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff) || Object.keys(handoff).length === 0) {
    return null;
  }
  const asList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
  const done = asList(handoff.done);
  const notDone = asList(handoff.not_done);
  const nextSteps = asList(handoff.next_steps);
  const hasRealNextSteps =
    nextSteps.length > 0 && !(nextSteps.length === 1 && nextSteps[0] === '完成，无下一步');
  const subtype =
    handoff.verdict === 'PASS' && hasRealNextSteps ? 'PASS+NEXT' : (handoff.verdict ?? 'UNKNOWN');
  return pushCaptureAtom(pool, {
    content: [
      `handoff: ${handoff.title || taskId}`,
      `verdict=${handoff.verdict ?? 'N/A'}`,
      done.length ? `完成: ${done.join('; ')}` : '',
      notDone.length ? `未完成: ${notDone.join('; ')}` : '',
      nextSteps.length ? `下一步: ${nextSteps.join('; ')}` : '',
    ].filter(Boolean).join('\n'),
    targetType: 'handoff',
    targetSubtype: subtype,
    routedToTable: 'tasks',
    routedToId: taskId,
  });
}

/**
 * 保存交接单：先 DB（SSOT），成功后 best-effort 写 markdown 镜像。
 * DB 失败直接抛（调用方决定是否吞）；镜像失败仅 warn。
 */
export async function saveHandoff({ pool }, handoff) {
  const res = await pool.query(
    `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('handoff', $2::jsonb), updated_at = NOW()
     WHERE id = $1::uuid`,
    [handoff.task_id, JSON.stringify(handoff)]
  );
  // task 不存在 → UPDATE 影响 0 行：抛错（也就不写镜像），防"DB 没写成却有镜像"的分裂态
  if (res.rowCount === 0) throw new Error(`saveHandoff: task not found: ${handoff.task_id}`);
  // T10 统一收件箱：DB 主写成功后顺手推一条 atom（吞错，不阻塞镜像与返回；
  // 与 relay PATCH 路径共用 pushHandoffAtom 保证同口径）
  await pushHandoffAtom(pool, handoff.task_id, handoff);
  let mirrorPath = null;
  try {
    const dir = process.env.HANDOFF_DOCS_DIR || DEFAULT_DOCS_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const stamp = handoff.created_at.replace(/[-:T]/g, '').slice(0, 12);
    mirrorPath = path.join(dir, `${stamp}-${String(handoff.task_id).slice(0, 8)}.md`);
    fs.writeFileSync(mirrorPath, renderHandoffMarkdown(handoff));
  } catch (err) {
    console.warn(`[handoff] markdown mirror failed (non-fatal): ${err.message}`);
    mirrorPath = null;
  }
  return { dbWritten: true, mirrorPath };
}

/** 按 journey 拉最近 N 份 handoff（planner 注入用）。journeyId 缺失 → []（不查库）。 */
export async function getRecentHandoffs({ pool }, { journeyId, limit = 3, excludeTaskId = null } = {}) {
  if (!journeyId) return [];
  const params = [journeyId];
  let exclude = '';
  if (excludeTaskId) {
    params.push(excludeTaskId);
    exclude = `AND id != $${params.length}::uuid`;
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT id, title, completed_at, result->'handoff' AS handoff
     FROM tasks
     WHERE payload->>'journey_id' = $1 AND result ? 'handoff' ${exclude}
     ORDER BY completed_at DESC NULLS LAST
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

/** 压缩为 prompt 注入段：每份 ≤6 行，总长 ≤2000 字；空 → ''。 */
export function formatHandoffsForPrompt(rows) {
  if (!rows?.length) return '';
  const blocks = rows.map((r, i) => {
    const h = r.handoff || {};
    const lines = [`### Handoff ${i + 1}: ${h.title || r.title || r.id}（verdict=${h.verdict ?? 'N/A'}）`];
    for (const d of (h.done || []).slice(0, 3)) lines.push(`- ✅ ${d}`);
    for (const n of (h.not_done || []).slice(0, 2)) lines.push(`- ❌ ${n}`);
    for (const s of (h.next_steps || []).slice(0, 2)) lines.push(`- ➡️ ${s}`);
    return lines.join('\n');
  });
  let text = `\n\n## 最近 Handoff（本 line 交接，规划时不得与已完成项重复、优先响应 next_steps）\n${blocks.join('\n')}`;
  if (text.length > PROMPT_MAX_LEN) text = `${text.slice(0, PROMPT_MAX_LEN)}…`;
  return text;
}
