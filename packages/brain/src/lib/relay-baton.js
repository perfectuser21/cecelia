/**
 * relay-baton.js — 接力棒·接棒（PR2，主理人 2026-09-23 拍板）
 *
 * 上一棒写的 handoff 不能只躺在表里：
 *   next_steps 每条标 kind —
 *     task     → 自动登记为 queued 子任务，挂在同一条链的根下（Brain 派发，人不用说）
 *     decision → 写 decisions 表 status='pending'，链停在这里等主理人一句话
 *     done / note → 只留痕
 *   任务转 completed 时若没有 handoff → 自动合成一份最小 handoff 并标 synthesized（不挡自动化，
 *   但守夜能数出来谁在裸奔）。
 *
 * 幂等：子任务 source_id = handoff:<task>:<idx>（work_routing_receipts 唯一），
 *       待拍板决策按 (source_ref, topic) 去重。
 */
import { createRoutedTask } from '../work-routing-store.js';
import { buildHandoff, saveHandoff } from '../handoff.js';
import { RELAY_TERMINAL_STATUSES } from './task-status-transitions.js';

export const NEXT_STEP_KINDS = Object.freeze(['task', 'decision', 'done', 'note']);
const MAX_TITLE = 200;
const MAX_STEPS = 20;

/** 字符串 / 对象混合 → 统一 {kind,title,detail,...}；非法项丢弃。 */
export function normalizeNextSteps(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (typeof raw === 'string') {
      const t = raw.trim();
      if (t) out.push({ kind: 'note', title: t.slice(0, MAX_TITLE) });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const title = String(raw.title ?? raw.text ?? '').trim();
    if (!title) continue;
    const kind = NEXT_STEP_KINDS.includes(raw.kind) ? raw.kind : 'note';
    out.push({
      kind,
      title: title.slice(0, MAX_TITLE),
      ...(raw.detail ? { detail: String(raw.detail).slice(0, 2000) } : {}),
      ...(raw.task_type ? { task_type: String(raw.task_type) } : {}),
      ...(raw.change_kind ? { change_kind: String(raw.change_kind) } : {}),
      ...(raw.domain ? { domain: String(raw.domain) } : {}),
      ...(raw.priority ? { priority: String(raw.priority) } : {}),
    });
    if (out.length >= MAX_STEPS) break;
  }
  return out;
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
 * 返回 { tasks: [{id,title}], decisions: [{id,topic}], skipped: [...] }。
 */
export async function materializeNextSteps(pool, task, handoff, deps = {}) {
  // 唯一写入者清单（task-creation-inventory）按字面 createRoutedTask( 识别：测试可注入替身，生产走真函数
  const create = (pool_, req) => (deps.createRoutedTask ? deps.createRoutedTask(pool_, req) : createRoutedTask(pool_, req));
  const steps = normalizeNextSteps(handoff?.next_steps);
  const out = { tasks: [], decisions: [], skipped: [] };
  if (!steps.length) return out;
  const rootId = rootOf(task);
  const parentPayload = task.payload || {};
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.kind === 'task') {
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
          task: { status: 'queued', priority: step.priority || task.priority || 'P2', trigger_source: 'child' },
        });
        out.tasks.push({ id: routed.task.id, title: routed.task.title, reused: Boolean(routed.reused) });
      } catch (err) {
        out.skipped.push({ index: i, kind: 'task', title: step.title, error: err.code || err.message });
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
            JSON.stringify({ kind: 'relay_pending', task_id: task.id, root_task_id: rootId, task_title: task.title || null }),
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
  return out;
}

/**
 * 可接棒终态收口（completed / completed_no_pr，见 RELAY_TERMINAL_STATUSES）：确保 handoff → 落下一棒。
 * 任何异常吞成 warn，不挡调用方。唯一入口是 lib/task-terminal.js 的 afterTerminalTransition——
 * 业务代码不要直接调本函数，否则又回到"接棒只挂一条路径"的老病。
 */
export async function relayOnComplete(pool, taskId, { sessionId = null } = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, status, priority, task_type, payload, parent_task_id, result, summary FROM tasks WHERE id = $1::uuid`,
      [taskId]
    );
    const task = rows[0];
    if (!task || !RELAY_TERMINAL_STATUSES.includes(task.status)) return null;
    const { handoff, synthesized } = await ensureHandoffOnComplete(pool, task, { sessionId });
    const spawned = await materializeNextSteps(pool, task, handoff);
    if (spawned.tasks.length || spawned.decisions.length) {
      console.log(`[relay-baton] task=${taskId} 接棒：子任务 ${spawned.tasks.length}，待拍板 ${spawned.decisions.length}`);
    }
    return { synthesized, ...spawned };
  } catch (err) {
    console.warn(`[relay-baton] task=${taskId} 接棒失败（不阻塞）: ${err.message}`);
    return null;
  }
}
