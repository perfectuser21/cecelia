/**
 * project-brief-apply.js — projects.brief 的 DB 侧效果（接力棒链 2afa6d69 棒2，决策 ee4842a6/3feeae3e）
 *
 * 纯 JSON 变换见 lib/project-brief.js（不碰 DB）；本模块负责把 handoff.brief_delta（或主会话直接
 * PATCH 的 brief_delta）真正落地：
 *   - add_steps  → 复用 relay-baton.js 同款落棒逻辑（继承 project_id，sequence_no = max+1）
 *   - cancel_steps → 只砍同项目下 status='queued' 的任务（与 DELETE /tasks/:id 同一套软删状态机：
 *     UPDATE status='cancelled'，不直接改别的状态）
 *   - reorder    → 只改同项目下非终态任务的 sequence_no
 *   - 权限分档（决策 105a5868 C/A 档）：改 goal 或一次 cancel_steps ≥3 条 → 升 A 档，写
 *     pending_actions（action_type='project_brief_decision'）+ Bark，不直接生效；其余字段照常生效
 *
 * 两个调用方：
 *   - lib/relay-baton.js relayOnComplete（任务终态时，handoff.brief_delta 自动应用）
 *   - routes/task-projects.js PATCH /:id/brief（主会话直接改，task_id 可选）
 *
 * pool 显式做参数（不在本模块顶层 import 真池）：与仓库既有写法一致（relay-baton.js /
 * work-routing-store.js 皆如此），单测能传假 pool，不用连真库。
 */
import { createHash } from 'node:crypto';
import { normalizeBrief, applyBriefDelta, sanitizeBriefDelta } from './project-brief.js';
import { createRoutedTask } from '../work-routing-store.js';
import { TERMINAL_STATUSES } from './task-status-transitions.js';
import { enqueueDangerousAction } from '../decision-executor.js';
import { sendBark } from '../notifier.js';

export const ESCALATE_CANCEL_THRESHOLD = 3;
/** 决策 105a5868：A 档主理人待办默认 72h 到期按默认（这里默认=保留现状，不自动执行变更）。 */
export const PENDING_DEADLINE_HOURS = 72;

/** add_steps → 挂在同 project 下的 queued 子任务（复用 relay-baton materializeNextSteps 的非 coding 分支形状）。 */
async function materializeAddSteps(pool, projectId, steps, { taskId = null } = {}) {
  if (!steps?.length) return [];
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(sequence_no), 0) AS n FROM tasks WHERE project_id = $1::uuid`,
    [projectId],
  );
  let nextSeq = Number(rows[0]?.n ?? 0) + 1;
  const created = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    try {
      const routed = await createRoutedTask(pool, {
        source: 'child',
        source_id: `brief-delta:${taskId || projectId}:add:${i}`,
        title: step.title,
        description: step.description || `来自项目简报变更（brief_delta.add_steps[${i}]）`,
        requested_task_type: 'data',
        declared_domain: 'operations',
        mutation_intent: 'none',
        declared_change_kind: null,
        repo_hint: null,
        map_scope_hint: [],
        parent_task_id: taskId || null,
        metadata: { lane: 'AI', from_brief_delta: taskId || null },
        task: { status: 'queued', priority: 'P2', trigger_source: 'child', project_id: projectId, sequence_no: nextSeq },
      });
      nextSeq += 1;
      created.push({ id: routed.task.id, title: routed.task.title, reused: Boolean(routed.reused) });
    } catch (err) {
      console.warn(`[project-brief-apply] add_steps[${i}] 建单失败（跳过，不阻塞其余项）: ${err.message}`);
    }
  }
  return created;
}

/** cancel_steps → 同项目下 status='queued' 的任务软删（UPDATE status='cancelled'，与 DELETE /tasks/:id 同规则）。 */
async function materializeCancelSteps(client, projectId, taskIds) {
  if (!taskIds?.length) return [];
  const { rows } = await client.query(
    `UPDATE tasks SET status = 'cancelled', updated_at = NOW()
      WHERE project_id = $1::uuid AND id = ANY($2::uuid[]) AND status = 'queued'
      RETURNING id, title`,
    [projectId, taskIds],
  );
  return rows;
}

/** reorder → 同项目下非终态任务的 sequence_no（按传入顺序重编号 1..n）。 */
async function materializeReorder(client, projectId, orderedIds) {
  if (!orderedIds?.length) return [];
  const done = [];
  for (let i = 0; i < orderedIds.length; i += 1) {
    const { rows } = await client.query(
      `UPDATE tasks SET sequence_no = $3, updated_at = NOW()
        WHERE project_id = $1::uuid AND id = $2::uuid AND status <> ALL($4::text[])
        RETURNING id`,
      [projectId, orderedIds[i], i + 1, TERMINAL_STATUSES],
    );
    if (rows.length) done.push(orderedIds[i]);
  }
  return done;
}

function hashOf(obj) {
  return createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

/** 组装升档问题文案（enqueue 与 Bark 共用同一份文案，防止两处描述漂移）。 */
function buildEscalationQuestion(project, escalated) {
  const priorBrief = normalizeBrief(project.brief);
  const parts = [];
  if (escalated.goal) parts.push(`改目标为「${escalated.goal}」（原：「${priorBrief.goal || '未写'}」）`);
  if (escalated.cancel_steps?.length) parts.push(`一次性砍 ${escalated.cancel_steps.length} 棒：${escalated.cancel_steps.join('、')}`);
  return `项目「${project.name}」的 handoff 提出：${parts.join('；')}，是否照办？`;
}

/** A 档升级：写 pending_actions（不直接生效）。返回 {pendingActionId, question, deadline}；enqueue 失败不阻塞主流程。 */
async function escalateToPendingAction(client, { project, taskId, escalated }) {
  const question = buildEscalationQuestion(project, escalated);
  const options = [
    { id: 'accept', text: '接受变更' },
    { id: 'keep', text: '保留现状（不改）' },
  ];
  const deadline = new Date(Date.now() + PENDING_DEADLINE_HOURS * 3600 * 1000).toISOString();
  const signature = `project-brief:${project.id}:${hashOf(escalated)}`;
  try {
    const enqueued = await enqueueDangerousAction(
      {
        type: 'project_brief_decision',
        params: { project_id: project.id, escalated, task_id: taskId || null },
        category: 'approval',
        priority: 'urgent',
        source: 'project-brief-guard',
        signature,
        options,
      },
      {
        title: question,
        question,
        options,
        default: 'keep',
        deadline,
        reversible: true,
        waiting_on: 'human',
        task_id: taskId || null,
        project_id: project.id,
      },
      client,
    );
    return { pendingActionId: enqueued?.pending_action_id ?? null, question, deadline };
  } catch (err) {
    console.warn(`[project-brief-apply] 写 pending_action 失败（不阻塞主流程）: ${err.message}`);
    return { pendingActionId: null, question, deadline };
  }
}

async function barkBriefEscalation(question, deadline) {
  try {
    await sendBark('【待拍板】项目简报变更', `${question}\n截止：${deadline}（到期不答按默认「保留现状」）`);
  } catch (err) {
    console.warn(`[project-brief-apply] Bark 通知失败（不阻塞）: ${err.message}`);
  }
}

function isNonEmptyDelta(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * 核心入口：把一份 brief_delta 应用到 projects.brief。
 *
 * @param {import('pg').Pool} pool
 * @param {{projectId: string, rawDelta: object, taskId?: string|null, force?: boolean}} args
 *   force=true（供 pending_action 批准回调用）：escalated 字段也直接生效，不再二次升档。
 * @returns {Promise<null | {applied: boolean, brief: object, escalated: boolean, pending_action_id: string|null,
 *   add_steps: object[], cancel_steps: object[], reorder: string[]}>}
 *   projectId 查无此行 / delta 清洗后为空 → null（无效果，调用方按"没发生"处理，不算错误）。
 */
export async function applyProjectBriefDelta(pool, { projectId, rawDelta, taskId = null, force = false }) {
  const delta = sanitizeBriefDelta(rawDelta);
  if (!projectId || !delta) return null;

  // add_steps 走独立事务（createRoutedTask 自管事务，不能嵌进下面这个大事务）。
  const addStepsResult = delta.add_steps ? await materializeAddSteps(pool, projectId, delta.add_steps, { taskId }) : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, name, brief FROM projects WHERE id = $1::uuid FOR UPDATE`,
      [projectId],
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return null;
    }
    const project = rows[0];

    const escalateGoal = !force && isNonEmptyDelta(delta.goal);
    const escalateCancel = !force && Array.isArray(delta.cancel_steps) && delta.cancel_steps.length >= ESCALATE_CANCEL_THRESHOLD;
    const escalated = escalateGoal || escalateCancel ? {} : null;
    const immediate = { ...delta };
    if (escalated) {
      if (escalateGoal) { escalated.goal = delta.goal; delete immediate.goal; }
      if (escalateCancel) { escalated.cancel_steps = delta.cancel_steps; delete immediate.cancel_steps; }
    }

    const cancelledRows = immediate.cancel_steps ? await materializeCancelSteps(client, projectId, immediate.cancel_steps) : [];
    const reorderedIds = immediate.reorder ? await materializeReorder(client, projectId, immediate.reorder) : [];

    const resolvedDelta = {
      ...immediate,
      add_steps: addStepsResult.map((s) => s.title),
      cancel_steps: cancelledRows.map((r) => `${r.title || r.id}`),
      reorder: reorderedIds,
    };
    const nextBrief = applyBriefDelta(project.brief, resolvedDelta, { taskId, now: new Date().toISOString() });
    await client.query(`UPDATE projects SET brief = $2::jsonb, updated_at = NOW() WHERE id = $1::uuid`, [
      projectId,
      JSON.stringify(nextBrief),
    ]);

    let pendingActionId = null;
    let escalationQuestion = null;
    let escalationDeadline = null;
    if (escalated) {
      const esc = await escalateToPendingAction(client, { project, taskId, escalated });
      pendingActionId = esc.pendingActionId;
      escalationQuestion = esc.question;
      escalationDeadline = esc.deadline;
    }

    await client.query('COMMIT');

    // 只在真建出新 pending_action 时才 Bark（同签名 24h 内重复提交会被节流，不重复打扰）。
    if (pendingActionId) await barkBriefEscalation(escalationQuestion, escalationDeadline);

    return {
      applied: true,
      brief: nextBrief,
      escalated: Boolean(escalated),
      pending_action_id: pendingActionId,
      add_steps: addStepsResult,
      cancel_steps: cancelledRows,
      reorder: reorderedIds,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.warn(`[project-brief-apply] project=${projectId} brief_delta 应用失败（不阻塞主流程）: ${err.message}`);
    return null;
  } finally {
    client.release();
  }
}

/** relay-baton 专用入口：task 需含 id/project_id；无 project_id 或 handoff 无 brief_delta → 直接返回 null（不查库）。 */
export async function applyHandoffBriefDelta(pool, task, handoff) {
  if (!task?.project_id || !handoff?.brief_delta) return null;
  return applyProjectBriefDelta(pool, { projectId: task.project_id, rawDelta: handoff.brief_delta, taskId: task.id });
}

/** pending_action 批准回调用：escalated 字段强制生效（已经过主理人批准，不再二次升档）。 */
export async function applyApprovedBriefEscalation(pool, { projectId, escalated, taskId = null }) {
  return applyProjectBriefDelta(pool, { projectId, rawDelta: escalated, taskId, force: true });
}
