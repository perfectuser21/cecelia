/**
 * 沉淀技能（树+仓库 v3.0 第 4 刀，路 B）：技能按 Step 发 span 跑通后，读 spans + SKILL.md，
 * 起草 Activity 15 列 / Steps 8 列，登记为「候选」，主理人只答三问（承诺对不对 / 哪些失败要人 / 判定点误判后果）。
 *
 * 机器能定的才写，定不了的留空并在 gaps 里标明，绝不猜：
 *   - 读回只在各次观测值一致（且至少跑过两次）时起草 ==，否则留空
 *   - on_fail 只由运行痕迹推出：有重试→retry:N，失败过→abort，都没有→空
 *   - 承诺只给草稿（取技能描述第一句），promise 列保持空，等拍板
 * Step span 约定（证据格式）：evidence = { step_key, name?, action?, reads?, writes?, observed?, field? }，
 * 经 POST /api/brain/spans 以 step_id 或 activity_id 上报；脚本 emit-step-span.sh 封装了这个约定。
 */
import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';
import { CELL_KEYS, ensureEightCells } from './activity-cells.js';

export { CELL_KEYS, ensureEightCells };

const SENTENCE_END = new Set(['。', '.', '!', '！', '?', '？']);

/** frontmatter 正文：必须以 --- 开头，到下一个单独成行的 --- 为止；全程字符串扫描，不用回溯正则（病态输入不会拖慢）。 */
function frontmatterBody(text) {
  if (!text.startsWith('---')) return null;
  const open = text.indexOf('\n');
  if (open < 0 || text.slice(3, open).trim() !== '') return null;
  const close = text.indexOf('\n---', open);
  return close < 0 ? null : text.slice(open + 1, close);
}

/** SKILL.md frontmatter → name / description；承诺草稿只取描述第一句。没有 frontmatter 全空，不编造。 */
export function parseSkillMd(text = '') {
  const body = frontmatterBody(String(text));
  const field = key => {
    const line = body?.split('\n').find(l => l.startsWith(`${key}:`));
    return line ? line.slice(key.length + 1).trim() || null : null;
  };
  const description = field('description');
  let first = description;
  if (description) {
    const at = [...description].findIndex(ch => SENTENCE_END.has(ch));
    if (at >= 0) first = [...description].slice(0, at + 1).join('');
  }
  return { name: field('name'), description, promise_draft: first };
}

const distinct = list => [...new Set(list)];
const isScalar = v => ['number', 'boolean', 'string'].includes(typeof v);

/**
 * @param {{skill:{name?:string,promise_draft?:string}, spans:object[], capabilityKey:string, activityKey:string}} input
 * @returns {{activity:object, steps:object[], gaps:string[], stats:{runs:number,spans:number}}}
 */
export function draftFromSpans({ skill = {}, spans, capabilityKey, activityKey }) {
  const gaps = [];
  const keyed = spans.filter(s => s.evidence?.step_key);
  const noKey = spans.length - keyed.length;
  if (noKey) gaps.push(`span_without_step_key:${noKey}`);
  if (keyed.length === 0) throw new Error('no_step_spans: 没有带 step_key 的 span，无从沉淀');

  const runs = distinct(keyed.map(s => s.run_id));
  // 出场顺序：各次运行里该 Step 的名次取平均
  const rankSum = new Map(), rankCount = new Map();
  for (const run of runs) {
    const ordered = keyed.filter(s => s.run_id === run).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
    [...new Set(ordered.map(s => s.evidence.step_key))].forEach((key, i) => {
      rankSum.set(key, (rankSum.get(key) ?? 0) + i);
      rankCount.set(key, (rankCount.get(key) ?? 0) + 1);
    });
  }
  const keys = [...rankSum.keys()].sort((a, b) => rankSum.get(a) / rankCount.get(a) - rankSum.get(b) / rankCount.get(b));

  const steps = keys.map((key, index) => {
    const mine = keyed.filter(s => s.evidence.step_key === key).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
    const latest = mine.at(-1).evidence;
    const passes = mine.filter(s => s.outcome === 'pass');
    const observed = passes.map(s => s.evidence.observed).filter(v => v !== undefined);
    const runsWithStep = distinct(passes.map(s => s.run_id)).length;
    const consistent = runsWithStep >= 2 && observed.length === passes.length && observed.every(isScalar) && new Set(observed.map(v => JSON.stringify(v))).size === 1;
    if (!consistent) gaps.push(`readback_undetermined:${key}`);
    const maxAttempts = Math.max(...mine.map(s => s.attempts ?? 1));
    const failed = mine.some(s => s.outcome === 'fail');
    return {
      key, order: index + 1, name: latest.name ?? key, action: latest.action ?? null,
      inputs: latest.reads ?? [], outputs: latest.writes ?? [],
      readback: consistent ? { type: 'observed', field: latest.field ?? 'value', expect: { op: '==', value: observed[0] } } : {},
      on_fail: maxAttempts > 1 ? `retry:${maxAttempts - 1}` : failed ? 'abort' : null,
    };
  });

  const kinds = keyed.map(s => s.executor_kind).filter(Boolean);
  const executor_kind = kinds.length ? [...new Set(kinds)].sort((a, b) => kinds.filter(k => k === b).length - kinds.filter(k => k === a).length)[0] : null;
  gaps.push('promise_pending_owner', 'failure_needs_human_pending_owner', 'judgment_pending_owner');
  return {
    activity: {
      key: activityKey, capability_key: capabilityKey, name: skill.name ?? activityKey, promise_draft: skill.promise_draft ?? null, executor_kind,
      inputs: steps[0].inputs, outputs: steps.at(-1).outputs,
      failure: {
        empty_ok: [], retryable: steps.filter(s => s.on_fail?.startsWith('retry')).map(s => s.key),
        needs_human: { cases: [], alert: null }, fatal: steps.filter(s => s.on_fail === 'abort').map(s => s.key),
      },
    },
    steps, gaps, stats: { runs: runs.length, spans: keyed.length },
  };
}

async function withTransaction(db, fn) {
  const isPool = typeof db.totalCount === 'number';
  const client = isPool ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (isPool) client.release();
  }
}

const DECISION_WINDOW_MS = 72 * 3600 * 1000;

/** 位置只在流程引用里（迁移 528）：把候选 Activity 放进能力的主线流程，顺序接在最后一个后面；没有主线流程且恰好一个流程就用它，否则新建。 */
async function placeInMainline(client, activityId, capabilityId) {
  const flows = (await client.query('SELECT id, key FROM workflows WHERE capability_id = $1 ORDER BY created_at', [capabilityId])).rows;
  const main = flows.find(f => f.key.startsWith('gp_steps_')) || (flows.length === 1 ? flows[0] : null);
  const workflowId = main?.id || (await client.query(
    `INSERT INTO workflows (capability_id, key, name, channel, version, status) VALUES ($1, $2, '主线', 'internal', '1.0', 'active') RETURNING id`,
    [capabilityId, `gp_steps_${String(capabilityId).slice(0, 8)}`])).rows[0].id;
  const next = (await client.query('SELECT COALESCE(max(sequence_no), 0) + 1 AS n FROM workflow_activity_refs WHERE workflow_id = $1', [workflowId])).rows[0].n;
  await client.query('INSERT INTO workflow_activity_refs (workflow_id, slot_key, activity_id, sequence_no) VALUES ($1, $2, $3, $4)',
    [workflowId, `step_${next}`, activityId, next]);
}

/**
 * 登记候选：Activity（status=candidate，承诺列保持空）+ Steps + 固定 8 灰格 + 一条待拍板（三问，72 小时不答按默认走）。
 * 同一 能力.活动 已存在则原样返回，不覆盖。
 */
export async function registerCandidate(db, { draft, journeyId, skillName = null, now = () => new Date() }) {
  const a = draft.activity;
  return withTransaction(db, async client => {
    const found = (await client.query('SELECT id FROM activities WHERE capability_key = $1 AND activity_key = $2', [a.capability_key, a.key])).rows[0];
    if (found) return { created: false, existing: true, id: found.id };

    const note = `候选：沉淀自技能「${skillName ?? a.name}」，待主理人拍板。承诺草稿：${a.promise_draft ?? '（无）'}`;
    const id = (await client.query(
      `INSERT INTO activities (name, description, status, capability_key, activity_key, executor_kind, inputs, outputs, failure, backbone_version)
       VALUES ($1, $2, 'candidate', $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, '3.0')
       RETURNING id`,
      [a.name, note, a.capability_key, a.key, a.executor_kind, JSON.stringify(a.inputs), JSON.stringify(a.outputs), JSON.stringify(a.failure)])).rows[0].id;
    await placeInMainline(client, id, journeyId);

    for (const s of draft.steps) {
      const key = `${a.capability_key}.${a.key}.${s.key}`;
      const sha = stepSha256({ key, activity: a.key, mode: 'checkpoint', readback: s.readback, name: s.name, action: s.action, inputs: s.inputs, outputs: s.outputs, on_fail: s.on_fail });
      await client.query(
        `INSERT INTO steps (activity_id, step_order, key, activity_key, mode, readback, source_sha256, name, action, inputs, outputs, on_fail)
         VALUES ($1, $2, $3, $4, 'checkpoint', $5::jsonb, $6, $7, $8, $9::jsonb, $10::jsonb, $11)`,
        [id, s.order, key, a.key, JSON.stringify(s.readback), sha, s.name, s.action, JSON.stringify(s.inputs), JSON.stringify(s.outputs), s.on_fail]);
    }
    await ensureEightCells(client, id, journeyId);

    const deadline = new Date(now().getTime() + DECISION_WINDOW_MS);
    const question = `候选 Activity「${a.name}」三问：①承诺是否就是「${a.promise_draft ?? '（技能没写描述，请直接给承诺）'}」？②哪些失败要通知人？③判定点误判后果能否接受？`;
    const pending = (await client.query(
      `INSERT INTO pending_actions (action_type, params, context, status, expires_at, category, priority, source, signature, options, comments)
       VALUES ('owner_decision', $1::jsonb, $2::jsonb, 'pending_approval', $3, 'approval', 'normal', 'skill_settlement', $4, $5::jsonb, '[]'::jsonb)
       RETURNING id`,
      [JSON.stringify({ activity_id: id, default: '按草稿通过', reversible: true }),
        JSON.stringify({ title: `待拍板：候选 Activity ${a.name}`, activity_id: id, question, deadline: deadline.toISOString(), gaps: draft.gaps }),
        deadline.toISOString(), `activity-candidate:${id}`, JSON.stringify(['按草稿通过', '改承诺后通过', '退回重沉淀'])])).rows[0].id;
    return { created: true, existing: false, id, steps: draft.steps.length, pending_action_id: pending };
  });
}
