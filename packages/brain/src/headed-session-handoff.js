/**
 * headed-session-handoff.js — 有头会话收尾：会话摘要并入 Brain 任务 handoff
 *
 * 触发：conversation-capture 判定一个有头真人会话已结束（闲置 ≥15 分钟）并生成摘要后调用。
 *   - 会话关联了 Brain 任务（transcript 里的 `/dev --task-id` / claim，或 session_provenance.task_id）
 *     → 摘要并入该任务 handoff：已有真 handoff 只追加不覆盖；没有/合成的则新建；
 *       任务还没终态 → next_steps 加一条「有头续接」（kind 默认 resume_headed，B 项未合并时退为 note）
 *   - 没关联任何任务 → 补建一张 completed 账本任务（只记账、不派发）挂摘要
 * 目标：有头做过的事 Brain 都知道。Notion 同步走任务既有投影通道，本模块不碰 Notion。
 *
 * 幂等：handoff.headed_sessions 按 session_id 记录；同会话同摘要再来一次不重写。
 *       账本任务 source_id = headed-session:<sessionId>（work_routing_receipts 唯一）。
 */
import { createRoutedTask } from './work-routing-store.js';
import { buildHandoff, saveHandoff as defaultSaveHandoff } from './handoff.js';
import { NEXT_STEP_KINDS } from './lib/relay-baton.js';

export const HEADED_SOURCE_ID_PREFIX = 'headed-session:';
export const HEADED_RESUME_KIND = 'resume_headed';
const MAX_LINKED = 5;
const MAX_HEADED_SESSIONS = 20;
const TERMINAL = new Set(['completed', 'completed_no_pr', 'failed', 'cancelled', 'quarantined']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** B 项（handoff 新类型 resume_headed）适配点：接力棒认这个 kind 就用它，否则按 note 写 */
export function resolveHeadedResumeKind(kinds = NEXT_STEP_KINDS) {
  return Array.isArray(kinds) && kinds.includes(HEADED_RESUME_KIND) ? HEADED_RESUME_KIND : 'note';
}

function firstTopic(summary) {
  const line = String(summary || '').split('\n').map((l) => l.replace(/^\s*\d+[.、)]\s*/, '').trim()).find(Boolean);
  return line || null;
}

function summaryOrExcerpt(session, summary) {
  if (summary) return summary;
  const last = (session.turns || []).map((t) => String(t.text || '').trim()).filter(Boolean).slice(-3);
  return last.length ? `（摘要生成失败，原文摘录）${last.join(' / ').slice(0, 400)}` : '（无可摘录内容）';
}

function sessionLine(session, text) {
  return `有头会话 ${session.sessionId} 摘要：${text.replace(/\s*\n\s*/g, '；')}`;
}

export function buildLedgerTaskRequest(session, summary) {
  const topic = firstTopic(summary)
    || String(session.turns?.[0]?.text || '').split('\n')[0].trim()
    || String(session.sessionId).slice(0, 8);
  return {
    source: 'conversation',
    source_id: `${HEADED_SOURCE_ID_PREFIX}${session.sessionId}`,
    title: `有头会话：${topic}`.slice(0, 80),
    description: summaryOrExcerpt(session, summary),
    mutation_intent: 'none',
    declared_domain: 'operations',
    requested_task_type: 'talk',
    metadata: {
      ledger_only: true,
      headed_session_id: session.sessionId,
      headed_session_source: session.source,
      headed_repo: session.repo ?? null,
    },
    // 铁律：只记账，绝不 queued——queued + 无主会被 tick 捡走真去"执行"
    task: { status: 'completed', priority: 'P3', trigger_source: 'conversation' },
  };
}

/** 现有 handoff + 本会话 → 合并后的 handoff；无变化返回 null */
function mergeHandoff(task, existing, session, text, resumeKind) {
  const real = existing && typeof existing === 'object' && existing.schema_version && !existing.synthesized;
  const base = real
    ? { ...existing }
    : buildHandoff({ task_id: task.id, title: task.title || '', verdict: null, done: [], next_steps: [] });
  const prior = Array.isArray(base.headed_sessions) ? base.headed_sessions : [];
  const hit = prior.find((h) => h.session_id === session.sessionId);
  if (hit && hit.summary === text) return null;

  const entry = { session_id: session.sessionId, source: session.source, repo: session.repo ?? null, summary: text, captured_at: new Date().toISOString() };
  base.headed_sessions = [...prior.filter((h) => h.session_id !== session.sessionId), entry].slice(-MAX_HEADED_SESSIONS);
  const line = sessionLine(session, text);
  const prefix = sessionLine(session, '');
  base.done = [...(Array.isArray(base.done) ? base.done : []).filter((d) => !(typeof d === 'string' && d.startsWith(prefix))), line];
  base.task_id = task.id;
  base.session_id = session.sessionId;
  if (!TERMINAL.has(task.status)) {
    const title = `有头续接：会话 ${String(session.sessionId).slice(0, 8)} 已结束、任务未完成，回有头会话接着做`;
    const steps = Array.isArray(base.next_steps) ? base.next_steps : [];
    if (!steps.some((s) => s && typeof s === 'object' && s.title === title)) {
      base.next_steps = [...steps, { kind: resumeKind, title, detail: text.slice(0, 2000) }];
    }
  }
  return base;
}

/**
 * @returns {Promise<{linked:string[], created:string|null, unchanged:string[]}>}
 */
export async function attachHeadedSession(pool, { session, summary, provenanceTaskId = null }, deps = {}) {
  const saveHandoff = deps.saveHandoff ?? defaultSaveHandoff;
  // 唯一写入者清单（task-creation-inventory）按字面 createRoutedTask( 识别：测试注入替身，生产走真函数
  const create = (pool_, req) => (deps.createRoutedTask ? deps.createRoutedTask(pool_, req) : createRoutedTask(pool_, req));
  const resumeKind = resolveHeadedResumeKind(deps.nextStepKinds ?? NEXT_STEP_KINDS);
  const text = summaryOrExcerpt(session, summary);

  const candidateIds = [...new Set([provenanceTaskId, ...(session.linkedTaskIds || [])].filter((id) => typeof id === 'string' && UUID_RE.test(id)))]
    .slice(0, MAX_LINKED);
  const out = { linked: [], created: null, unchanged: [] };

  let tasks = [];
  if (candidateIds.length > 0) {
    const { rows } = await pool.query(
      'SELECT id, title, status, result FROM tasks WHERE id = ANY($1::uuid[])',
      [candidateIds],
    );
    tasks = rows;
  }

  if (tasks.length === 0) {
    const routed = await create(pool, buildLedgerTaskRequest(session, summary));
    const task = routed.task;
    const merged = mergeHandoff(task, task.result?.handoff, session, text, resumeKind);
    if (!merged) { out.unchanged.push(task.id); return out; }
    await saveHandoff({ pool }, merged);
    if (routed.deduplicated) out.linked.push(task.id); else out.created = task.id;
    return out;
  }

  for (const task of tasks) {
    const merged = mergeHandoff(task, task.result?.handoff, session, text, resumeKind);
    if (!merged) { out.unchanged.push(task.id); continue; }
    await saveHandoff({ pool }, merged);
    out.linked.push(task.id);
  }
  return out;
}
