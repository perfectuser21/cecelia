/**
 * relay-baton.js — 接力棒·接棒（PR2，主理人 2026-09-23 拍板；2026-10-11 改四类）
 *
 * 上一棒写的 handoff 不能只躺在表里：
 *   next_steps 每条标 kind（四类，主理人 2026-10-11 决策）—
 *     resume_headed     → 有头续接：Brain 不派发，原任务 result.pending_resume 挂「待续」，
 *                         新的有头会话开场经 GET /api/brain/handoffs/pending-resume 接上
 *     dispatch_headless → 无头派发：自动登记为 queued 子任务，挂在同一条链的根下（≡旧值 task）
 *     decision          → 写 decisions 表 status='pending'，链停在这里等主理人一句话
 *     note              → 只留痕（≡旧值 done）
 *   未标 / 认不出的条目：有头任务默认 resume_headed；无头任务默认 note。
 *     无头默认 note 而不是 dispatch_headless 的理由：存量 handoff 绝大多数 next_steps 是字符串
 *     （14 天 1701 份带 handoff、自动子任务仅 11 条），改成默认派发会把随手写的建议批量变成
 *     queued 单直接派出去（误派 = 真动作），note 只留痕可回看，安全。
 *   任务转 completed 时若没有 handoff → 自动合成一份最小 handoff 并标 synthesized（不挡自动化，
 *   但守夜能数出来谁在裸奔）。
 *
 * 幂等：子任务 source_id = handoff:<task>:<idx>（work_routing_receipts 唯一），
 *       待拍板决策按 (source_ref, topic) 去重，pending_resume 按 handoff.created_at 去重。
 */
import { createRoutedTask } from '../work-routing-store.js';
import { buildHandoff, saveHandoff } from '../handoff.js';
import { RELAY_TERMINAL_STATUSES } from './task-status-transitions.js';
import { applyHandoffBriefDelta } from './project-brief-apply.js';

export const NEXT_STEP_KINDS = Object.freeze(['resume_headed', 'dispatch_headless', 'decision', 'note']);
/** 兼容旧值：task≡dispatch_headless，done≡note */
export const NEXT_STEP_KIND_ALIASES = Object.freeze({ task: 'dispatch_headless', done: 'note' });
const MAX_TITLE = 200;
const MAX_STEPS = 20;
/** 「完成，无下一步」一类占位：不论有头无头都只是 note，不能变成待续 */
const PLACEHOLDER_RE = /^(完成[，,、\s]*)?(无|没有)(下一步)?[。.]?$|^none$|^n\/a$/i;

/**
 * 有头任务判定：payload.headed_manual（建单方声明人工接管，dispatch-helpers 同口径）、
 * executor_kind=headed-session（有头会话认领/PATCH in_progress 时打标）、payload.headed_takeover。
 * 不用 trigger_source=manual：notion 秋米无头单、factory 单也写 manual。
 */
export function isHeadedTask(task) {
  if (!task || typeof task !== 'object') return false;
  const p = task.payload || {};
  if (p.headed_manual === true || p.headed_manual === 'true') return true;
  if (task.executor_kind === 'headed-session') return true;
  return Boolean(p.headed_takeover);
}

/**
 * 字符串 / 对象混合 → 统一 {kind,title,detail,...}，并回报每条「被当成什么」。
 * feedback 只列非显式正式 kind 的条目（unmarked / alias / unrecognized / placeholder），index 是原始下标。
 */
export function classifyNextSteps(list, { headed = false } = {}) {
  const steps = [];
  const feedback = [];
  if (!Array.isArray(list)) return { steps, feedback };
  const fallback = headed ? 'resume_headed' : 'note';
  for (let idx = 0; idx < list.length; idx += 1) {
    const raw = list[idx];
    let title;
    let given = null;
    let obj = null;
    if (typeof raw === 'string') {
      title = raw.trim();
    } else if (raw && typeof raw === 'object') {
      obj = raw;
      title = String(raw.title ?? raw.text ?? '').trim();
      given = raw.kind == null || raw.kind === '' ? null : String(raw.kind);
    } else {
      continue;
    }
    if (!title) continue;
    title = title.slice(0, MAX_TITLE);
    let kind;
    let reason = null;
    if (given && NEXT_STEP_KINDS.includes(given)) {
      kind = given;
    } else if (given && NEXT_STEP_KIND_ALIASES[given]) {
      kind = NEXT_STEP_KIND_ALIASES[given];
      reason = 'alias';
    } else if (!given && PLACEHOLDER_RE.test(title)) {
      kind = 'note';
      reason = 'placeholder';
    } else {
      kind = fallback;
      reason = given ? 'unrecognized' : 'unmarked';
    }
    const step = { kind, title };
    if (obj) {
      if (obj.detail) step.detail = String(obj.detail).slice(0, 2000);
      if (obj.task_type) step.task_type = String(obj.task_type);
      if (obj.change_kind) step.change_kind = String(obj.change_kind);
      if (obj.domain) step.domain = String(obj.domain);
      if (obj.priority) step.priority = String(obj.priority);
    }
    steps.push(step);
    if (reason) feedback.push({ index: idx, title, given_kind: given, kind, reason });
    if (steps.length >= MAX_STEPS) break;
  }
  return { steps, feedback };
}

/** 旧签名：只要规范化后的步骤。默认按无头口径（未标→note）。 */
export function normalizeNextSteps(list, opts = {}) {
  return classifyNextSteps(list, opts).steps;
}

/**
 * 写 handoff 前规范化（PATCH /tasks 写 result.handoff 时调）：next_steps 落成带 kind 的对象，
 * 并返回反馈给写入方——列出未标/认不出/旧值条目各被当成了什么。
 */
export function prepareHandoffForWrite(task, handoff) {
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) return { handoff, feedback: null };
  const headed = isHeadedTask(task);
  if (!Array.isArray(handoff.next_steps)) return { handoff, feedback: { headed, coerced: [], unrecognized: [] } };
  const { steps, feedback } = classifyNextSteps(handoff.next_steps, { headed });
  return {
    handoff: { ...handoff, next_steps: steps },
    feedback: {
      headed,
      default_kind: headed ? 'resume_headed' : 'note',
      kinds: steps.map((s) => s.kind),
      coerced: feedback,
      unrecognized: feedback.filter((f) => f.reason === 'unrecognized'),
    },
  };
}

/** 没有 handoff 的 completed 任务 → 合成最小 handoff（标 synthesized）。返回 handoff 或 null。 */
export async function ensureHandoffOnComplete(pool, task, { sessionId = null } = {}) {
  const existing = task?.result?.handoff;
  if (existing && typeof existing === 'object' && existing.schema_version) return { handoff: existing, synthesized: false };
  const summary = task?.result?.summary || task?.summary || null;
  const handoff = buildHandoff({
    task_id: task.id,
    title: task.title,
    verdict: task?.result?.verdict === 'FAIL' ? 'FAIL' : 'PASS',
    done: [summary || `完成：${task.title || task.id}`],
    not_done: [],
    next_steps: [],
    data_sources: [],
  });
  handoff.synthesized = true;
  handoff.session_id = sessionId;
  await saveHandoff({ pool }, handoff);
  console.warn(`[relay-baton] task=${task.id} 转 completed 无 handoff → 已合成（synthesized）。有头会话应自己写。`);
  return { handoff, synthesized: true };
}

function rootOf(task) {
  return task.parent_task_id || task.id;
}

/**
 * 把 handoff.next_steps 落成下一棒。task 需含 id/title/priority/task_type/payload/parent_task_id。
 * 返回 { tasks: [{id,title}], decisions: [{id,topic}], resume: [{index,title}], skipped: [...] }。
 */
export async function materializeNextSteps(pool, task, handoff, deps = {}) {
  // 唯一写入者清单（task-creation-inventory）按字面 createRoutedTask( 识别：测试可注入替身，生产走真函数
  const create = (pool_, req) => (deps.createRoutedTask ? deps.createRoutedTask(pool_, req) : createRoutedTask(pool_, req));
  const steps = normalizeNextSteps(handoff?.next_steps, { headed: isHeadedTask(task) });
  const out = { tasks: [], decisions: [], resume: [], skipped: [] };
  if (!steps.length) return out;
  const rootId = rootOf(task);
  const parentPayload = task.payload || {};
  // 棒1（决策 ee4842a6/3feeae3e）：task 挂了 project_id → 新子任务继承它，sequence_no 在该 project
  // 下从 max+1 起本地递增（每个 task 步骤各占一个号，不逐个重查库）。
  let nextProjectSeq = null;
  if (task.project_id) {
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS n FROM tasks WHERE project_id = $1::uuid`,
      [task.project_id]
    );
    nextProjectSeq = Number(rows[0]?.n ?? 1);
  }
  const resumeItems = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.kind === 'resume_headed') {
      resumeItems.push({ index: i, title: step.title, ...(step.detail ? { detail: step.detail } : {}) });
      out.resume.push({ index: i, title: step.title });
      continue;
    }
    if (step.kind === 'dispatch_headless') {
      const coding = Boolean(step.change_kind);
      try {
        const routed = await create(pool, {
          source: 'child',
          source_id: `handoff:${task.id}:${i}`,
          title: step.title,
          description: step.detail || `来自上一棒「${task.title || task.id}」的 handoff.next_steps[${i}]`,
          requested_task_type: step.task_type || (coding ? 'dev' : 'data'),
          declared_domain: step.domain || (coding ? 'coding' : 'operations'),
          mutation_intent: coding ? 'write' : 'none',
          declared_change_kind: coding ? step.change_kind : null,
          repo_hint: coding ? (parentPayload.repo || parentPayload.base_repo || null) : null,
          map_scope_hint: coding ? (Array.isArray(parentPayload.map_scope) ? parentPayload.map_scope : []) : [],
          parent_task_id: rootId,
          metadata: { lane: 'AI', from_handoff: task.id, relay_step_index: i },
          task: {
            status: 'queued',
            priority: step.priority || task.priority || 'P2',
            trigger_source: 'child',
            ...(task.project_id ? { project_id: task.project_id, sequence_no: nextProjectSeq } : {}),
          },
        });
        if (task.project_id) nextProjectSeq += 1;
        out.tasks.push({ id: routed.task.id, title: routed.task.title, reused: Boolean(routed.reused) });
      } catch (err) {
        out.skipped.push({ index: i, kind: 'dispatch_headless', title: step.title, error: err.code || err.message });
      }
      continue;
    }
    if (step.kind === 'decision') {
      try {
        const dup = await pool.query(
          `SELECT id FROM decisions WHERE source_ref = $1 AND topic = $2 LIMIT 1`,
          [task.id, step.title]
        );
        if (dup.rows[0]) { out.decisions.push({ id: dup.rows[0].id, topic: step.title, reused: true }); continue; }
        // decisions.context 是 json；made_by 只认 user/cecelia/system；target_type 白名单无 task → 根放 context
        const ins = await pool.query(
          `INSERT INTO decisions (category, topic, decision, reason, context, status, trigger, author, made_by, priority, source_ref)
           VALUES ('decision', $1, $2, $3, $4::jsonb, 'pending', 'handoff', 'cecelia', 'cecelia', $5, $6)
           RETURNING id, topic`,
          [
            step.title,
            step.detail || '（待主理人拍板）',
            `接力棒：任务「${task.title || task.id}」的 handoff 提出，链停在此等拍板`,
            JSON.stringify({ kind: 'relay_pending', task_id: task.id, root_task_id: rootId, project_id: task.project_id ?? null, task_title: task.title || null }),
            step.priority || task.priority || 'P2',
            task.id,
          ]
        );
        out.decisions.push({ id: ins.rows[0].id, topic: ins.rows[0].topic, reused: false });
      } catch (err) {
        out.skipped.push({ index: i, kind: 'decision', title: step.title, error: err.code || err.message });
      }
      continue;
    }
    out.skipped.push({ index: i, kind: step.kind, title: step.title, error: null });
  }
  if (resumeItems.length) {
    try {
      await markPendingResume(pool, task, handoff, resumeItems);
    } catch (err) {
      out.skipped.push({ index: resumeItems[0].index, kind: 'resume_headed', title: resumeItems[0].title, error: err.code || err.message });
    }
  }
  return out;
}

/**
 * 有头续接：原任务 result.pending_resume 挂「待续」。同一份 handoff（created_at 相同）重放不覆盖，
 * 免得已 ack 的状态被打回 pending；新的 handoff 覆盖旧的待续（以最新交接为准）。
 */
async function markPendingResume(pool, task, handoff, items) {
  const handoffAt = handoff?.created_at || null;
  const { rows } = await pool.query(
    `SELECT result->'pending_resume' AS pending_resume FROM tasks WHERE id = $1::uuid`,
    [task.id]
  );
  const existing = rows[0]?.pending_resume;
  if (existing && handoffAt && existing.handoff_created_at === handoffAt) return;
  const marker = {
    status: 'pending',
    handoff_created_at: handoffAt,
    items,
    session_id: handoff?.session_id ?? null,
    created_at: new Date().toISOString(),
    resumed_at: null,
    resumed_by: null,
  };
  await pool.query(
    `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('pending_resume', $2::jsonb), updated_at = NOW()
      WHERE id = $1::uuid`,
    [task.id, JSON.stringify(marker)]
  );
}

/**
 * 可接棒终态收口（completed / completed_no_pr，见 RELAY_TERMINAL_STATUSES）：确保 handoff → 落下一棒。
 * 任何异常吞成 warn，不挡调用方。唯一入口是 lib/task-terminal.js 的 afterTerminalTransition——
 * 业务代码不要直接调本函数，否则又回到"接棒只挂一条路径"的老病。
 */
export async function relayOnComplete(pool, taskId, { sessionId = null } = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, status, priority, task_type, executor_kind, payload, parent_task_id, project_id, result, summary FROM tasks WHERE id = $1::uuid`,
      [taskId]
    );
    const task = rows[0];
    if (!task || !RELAY_TERMINAL_STATUSES.includes(task.status)) return null;
    const { handoff, synthesized } = await ensureHandoffOnComplete(pool, task, { sessionId });
    const spawned = await materializeNextSteps(pool, task, handoff);
    if (spawned.tasks.length || spawned.decisions.length || spawned.resume.length) {
      console.log(`[relay-baton] task=${taskId} 接棒：子任务 ${spawned.tasks.length}，待拍板 ${spawned.decisions.length}，有头待续 ${spawned.resume.length}`);
    }
    // 棒2（决策 ee4842a6/3feeae3e）：handoff.brief_delta → projects.brief（任务挂了 project_id 才有效果）。
    // 任何异常已在 applyHandoffBriefDelta 内部吞掉，这里只是留痕，不影响接棒主流程。
    let brief = null;
    try {
      brief = await applyHandoffBriefDelta(pool, task, handoff);
    } catch (err) {
      console.warn(`[relay-baton] task=${taskId} brief_delta 应用失败（不阻塞接棒）: ${err.message}`);
    }
    return { synthesized, brief, ...spawned };
  } catch (err) {
    console.warn(`[relay-baton] task=${taskId} 接棒失败（不阻塞）: ${err.message}`);
    return null;
  }
}
