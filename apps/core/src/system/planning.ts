/**
 * Planning Engine - Phase 5.2 + 5.3
 *
 * Generates daily/weekly plans based on:
 * - Current OKR/Goals
 * - Task priorities (P0, P1, P2)
 * - Task status (pending, in_progress)
 * - Memory context (working + longterm)
 *
 * Phase 5.3: Added why/expected_evidence/source_refs + commit endpoint
 */

import pool from '../task-system/db.js';
import { writeMemory, readMemory, queryMemory } from './memory.js';

// Plan scope types
export type PlanScope = 'daily' | 'weekly';

// Source reference for traceability
export interface SourceRef {
  type: 'goal' | 'memory' | 'task';
  id: string;
  title?: string;
}

// Plan task interface (upgraded in Phase 5.3)
export interface PlanTask {
  id: string;
  title: string;
  priority: string;
  status: string;
  estimated_hours?: number;
  goal_id?: string;
  goal_title?: string;
  depends_on: string[];
  // Phase 5.3 additions
  why: string;
  expected_evidence: string;
  source_refs: SourceRef[];
}

// Committed task result
export interface CommittedTask {
  plan_task_id: string;
  task_id: string;
  title: string;
}

// Commit result
export interface CommitResult {
  success: boolean;
  committed_tasks: CommittedTask[];
  plan_id: string;
}

// Generated plan interface
export interface GeneratedPlan {
  plan_id: string;
  scope: PlanScope;
  created_at: string;
  tasks: PlanTask[];
  summary: {
    total: number;
    by_priority: Record<string, number>;
  };
  reasoning: string;
}

// Plan status interface
export interface PlanStatus {
  active_plan: string | null;
  plan: GeneratedPlan | null;
  progress: {
    total: number;
    completed: number;
    in_progress: number;
    pending: number;
  };
  next_task: PlanTask | null;
}

/**
 * Get current date string for plan ID
 */
function getDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Fetch all active goals with their progress
 */
async function fetchGoals(): Promise<Array<{ id: string; title: string; priority: string; progress: number }>> {
  try {
    const result = await pool.query(`
      SELECT id, title, priority, progress
      FROM goals
      WHERE status != 'completed'
      ORDER BY
        CASE priority
          WHEN 'P0' THEN 1
          WHEN 'P1' THEN 2
          WHEN 'P2' THEN 3
          ELSE 4
        END,
        progress DESC
    `);
    return result.rows.map((row: { id: unknown; title: string; priority: string; progress: number }) => ({
      id: String(row.id),
      title: row.title,
      priority: row.priority || 'P2',
      progress: row.progress || 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch tasks for planning (returns partial PlanTask without why/evidence)
 */
interface RawTask {
  id: string;
  title: string;
  priority: string;
  status: string;
  goal_id?: string;
  goal_title?: string;
}

async function fetchTasks(): Promise<RawTask[]> {
  try {
    const result = await pool.query(`
      SELECT t.id, t.title, t.priority, t.status, t.goal_id, g.title as goal_title
      FROM tasks t
      LEFT JOIN goals g ON t.goal_id = g.id
      WHERE t.status IN ('pending', 'in_progress')
      ORDER BY
        CASE t.priority
          WHEN 'P0' THEN 1
          WHEN 'P1' THEN 2
          WHEN 'P2' THEN 3
          ELSE 4
        END,
        t.created_at ASC
    `);
    return result.rows.map((row: { id: unknown; title: string; priority: string; status: string; goal_id: unknown; goal_title: string }) => ({
      id: String(row.id),
      title: row.title,
      priority: row.priority || 'P2',
      status: row.status,
      goal_id: row.goal_id ? String(row.goal_id) : undefined,
      goal_title: row.goal_title || undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Generate why/expected_evidence for a task based on context
 */
function generateTaskReasoning(
  task: RawTask,
  goals: Array<{ id: string; title: string; priority: string; progress: number }>,
  context: { focus: string | null }
): { why: string; expected_evidence: string; source_refs: SourceRef[] } {
  const source_refs: SourceRef[] = [];
  const whyParts: string[] = [];

  // Link to goal if exists
  if (task.goal_id && task.goal_title) {
    source_refs.push({ type: 'goal', id: task.goal_id, title: task.goal_title });
    whyParts.push(`支撑目标「${task.goal_title}」`);
  }

  // Add priority reasoning
  if (task.priority === 'P0') {
    whyParts.push('最高优先级任务');
  } else if (task.priority === 'P1') {
    whyParts.push('重要任务');
  }

  // Add context if matches focus
  if (context.focus && task.title.toLowerCase().includes(context.focus.toLowerCase())) {
    whyParts.push(`与当前焦点「${context.focus}」相关`);
  }

  // Default why if empty
  const why = whyParts.length > 0 ? whyParts.join('，') : `${task.priority} 任务，按优先级选入计划`;

  // Generate expected evidence based on task title
  let expected_evidence = '任务完成状态更新为 completed';
  if (task.title.includes('实现') || task.title.includes('开发')) {
    expected_evidence = '代码提交 + PR 合并';
  } else if (task.title.includes('测试')) {
    expected_evidence = '测试通过 + 覆盖率报告';
  } else if (task.title.includes('文档')) {
    expected_evidence = '文档更新 + 版本号变更';
  }

  return { why, expected_evidence, source_refs };
}

/**
 * Read context from memory
 */
async function readContext(): Promise<{ focus: string | null; preferences: Record<string, unknown> }> {
  // Read current focus from working memory
  const focusEntry = await readMemory('current_focus');
  const focus = focusEntry?.value?.focus as string || null;

  // Read preferences from longterm memory
  const preferences: Record<string, unknown> = {};
  const prefEntries = await queryMemory({ layer: 'longterm', category: 'preference' });
  for (const entry of prefEntries) {
    preferences[entry.key] = entry.value;
  }

  return { focus, preferences };
}

/**
 * Generate a daily or weekly plan
 */
export async function generatePlan(scope: PlanScope = 'daily'): Promise<GeneratedPlan> {
  const dateStr = getDateString();
  const planId = `plan_${scope}_${dateStr}`;

  // Fetch data
  const [goals, tasks, context] = await Promise.all([
    fetchGoals(),
    fetchTasks(),
    readContext(),
  ]);

  // Filter tasks based on scope
  // Daily: P0 + top P1 tasks (max 8)
  // Weekly: All P0, P1 + some P2 (max 20)
  let filteredRawTasks: RawTask[];
  let maxTasks: number;

  if (scope === 'daily') {
    maxTasks = 8;
    // Prioritize P0, then P1
    const p0Tasks = tasks.filter(t => t.priority === 'P0');
    const p1Tasks = tasks.filter(t => t.priority === 'P1');
    filteredRawTasks = [...p0Tasks, ...p1Tasks].slice(0, maxTasks);
  } else {
    maxTasks = 20;
    const p0Tasks = tasks.filter(t => t.priority === 'P0');
    const p1Tasks = tasks.filter(t => t.priority === 'P1');
    const p2Tasks = tasks.filter(t => t.priority === 'P2');
    filteredRawTasks = [...p0Tasks, ...p1Tasks, ...p2Tasks].slice(0, maxTasks);
  }

  // Enrich tasks with why/expected_evidence/source_refs
  const filteredTasks: PlanTask[] = filteredRawTasks.map(task => {
    const reasoning = generateTaskReasoning(task, goals, context);
    return {
      ...task,
      depends_on: [],
      ...reasoning,
    };
  });

  // Count by priority
  const byPriority: Record<string, number> = {};
  for (const task of filteredTasks) {
    byPriority[task.priority] = (byPriority[task.priority] || 0) + 1;
  }

  // Generate reasoning
  const reasoningParts: string[] = [];
  if (goals.length > 0) {
    const topGoal = goals[0];
    reasoningParts.push(`当前最高优先级目标: ${topGoal.title} (${topGoal.priority}, ${topGoal.progress}% 完成)`);
  }
  if (context.focus) {
    reasoningParts.push(`当前焦点: ${context.focus}`);
  }
  reasoningParts.push(`选取了 ${filteredTasks.length} 个任务: P0=${byPriority['P0'] || 0}, P1=${byPriority['P1'] || 0}, P2=${byPriority['P2'] || 0}`);

  const plan: GeneratedPlan = {
    plan_id: planId,
    scope,
    created_at: new Date().toISOString(),
    tasks: filteredTasks,
    summary: {
      total: filteredTasks.length,
      by_priority: byPriority,
    },
    reasoning: reasoningParts.join('. '),
  };

  // Store plan in working memory
  await writeMemory({
    layer: 'working',
    category: 'state',
    key: planId,
    value: plan as unknown as Record<string, unknown>,
    source: 'system',
  });

  // Update current plan reference
  await writeMemory({
    layer: 'working',
    category: 'context',
    key: 'current_plan',
    value: { plan_id: planId, scope, created_at: plan.created_at },
    source: 'system',
  });

  return plan;
}

/**
 * Get current plan status
 */
export async function getPlanStatus(): Promise<PlanStatus> {
  // Read current plan reference
  const currentPlanEntry = await readMemory('current_plan');

  if (!currentPlanEntry) {
    return {
      active_plan: null,
      plan: null,
      progress: { total: 0, completed: 0, in_progress: 0, pending: 0 },
      next_task: null,
    };
  }

  const planId = currentPlanEntry.value.plan_id as string;

  // Read the actual plan
  const planEntry = await readMemory(planId);

  if (!planEntry) {
    return {
      active_plan: planId,
      plan: null,
      progress: { total: 0, completed: 0, in_progress: 0, pending: 0 },
      next_task: null,
    };
  }

  const plan = planEntry.value as unknown as GeneratedPlan;

  // Get current task statuses from database
  const taskIds = plan.tasks.map(t => t.id);
  const taskStatuses: Record<string, string> = {};

  if (taskIds.length > 0) {
    try {
      const result = await pool.query(
        'SELECT id, status FROM tasks WHERE id = ANY($1)',
        [taskIds]
      );
      for (const row of result.rows) {
        taskStatuses[String(row.id)] = row.status;
      }
    } catch {
      // Use original statuses from plan
      for (const task of plan.tasks) {
        taskStatuses[task.id] = task.status;
      }
    }
  }

  // Calculate progress
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  let nextTask: PlanTask | null = null;

  for (const task of plan.tasks) {
    const currentStatus = taskStatuses[task.id] || task.status;
    if (currentStatus === 'completed') {
      completed++;
    } else if (currentStatus === 'in_progress') {
      inProgress++;
      if (!nextTask) nextTask = { ...task, status: currentStatus };
    } else {
      pending++;
      if (!nextTask) nextTask = { ...task, status: currentStatus };
    }
  }

  return {
    active_plan: planId,
    plan,
    progress: {
      total: plan.tasks.length,
      completed,
      in_progress: inProgress,
      pending,
    },
    next_task: nextTask,
  };
}

/**
 * Get plan by ID
 */
export async function getPlan(planId: string): Promise<GeneratedPlan | null> {
  const planEntry = await readMemory(planId);
  if (!planEntry) return null;
  return planEntry.value as unknown as GeneratedPlan;
}

/**
 * Commit plan tasks to the tasks table
 * Only commits P0 tasks (or top N tasks if limit specified)
 */
export async function commitPlan(planId: string, limit: number = 3): Promise<CommitResult> {
  // Get the plan
  const plan = await getPlan(planId);
  if (!plan) {
    return {
      success: false,
      committed_tasks: [],
      plan_id: planId,
    };
  }

  // Filter P0 tasks first, then take up to limit
  const p0Tasks = plan.tasks.filter(t => t.priority === 'P0');
  const tasksToCommit = p0Tasks.slice(0, limit);

  // If no P0 tasks, take top tasks by priority
  if (tasksToCommit.length === 0 && plan.tasks.length > 0) {
    tasksToCommit.push(...plan.tasks.slice(0, limit));
  }

  const committedTasks: CommittedTask[] = [];

  for (const planTask of tasksToCommit) {
    try {
      // Check if task already exists (by original id)
      const existing = await pool.query(
        'SELECT id FROM tasks WHERE id = $1',
        [planTask.id]
      );

      if (existing.rows.length > 0) {
        // Task already exists, just record it as committed
        committedTasks.push({
          plan_task_id: planTask.id,
          task_id: planTask.id,
          title: planTask.title,
        });
        continue;
      }

      // Insert new task with plan reference in metadata
      const result = await pool.query(
        `INSERT INTO tasks (title, priority, status, goal_id, metadata)
         VALUES ($1, $2, 'pending', $3, $4)
         RETURNING id`,
        [
          planTask.title,
          planTask.priority,
          planTask.goal_id || null,
          JSON.stringify({
            source_plan_id: planId,
            why: planTask.why,
            expected_evidence: planTask.expected_evidence,
            source_refs: planTask.source_refs,
          }),
        ]
      );

      const newTaskId = String(result.rows[0].id);
      committedTasks.push({
        plan_task_id: planTask.id,
        task_id: newTaskId,
        title: planTask.title,
      });
    } catch (err) {
      console.error(`Failed to commit task ${planTask.id}:`, err);
    }
  }

  // Record commit event in memory
  await writeMemory({
    layer: 'episodic',
    category: 'event',
    key: `commit_${planId}_${Date.now()}`,
    value: {
      type: 'plan_commit',
      plan_id: planId,
      committed_count: committedTasks.length,
      committed_tasks: committedTasks,
      timestamp: new Date().toISOString(),
    },
    source: 'system',
  });

  return {
    success: committedTasks.length > 0,
    committed_tasks: committedTasks,
    plan_id: planId,
  };
}

// Nightly planner result interface
export interface NightlyPlanResult {
  success: boolean;
  plan_id: string;
  committed_count: number;
  summary: string;
  next_review: string;
  plan?: GeneratedPlan;
}

/**
 * Nightly planner - generates daily plan and auto-commits P0 tasks
 * Called by N8N schedule trigger at 6:00 AM
 */
export async function runNightlyPlanner(): Promise<NightlyPlanResult> {
  const now = new Date();

  // Generate daily plan
  const plan = await generatePlan('daily');

  // Auto-commit P0 tasks (top 3)
  const commitResult = await commitPlan(plan.plan_id, 3);

  // Generate summary
  const summary = `生成 ${plan.tasks.length} 个任务，已落库 ${commitResult.committed_tasks.length} 个任务`;

  // Calculate next review time (tomorrow 6:00 AM UTC+8)
  const nextReview = new Date(now);
  nextReview.setDate(nextReview.getDate() + 1);
  nextReview.setHours(6, 0, 0, 0);

  // Record nightly plan event in episodic memory
  await writeMemory({
    layer: 'episodic',
    category: 'event',
    key: `nightly_plan_${plan.plan_id}`,
    value: {
      type: 'nightly_plan',
      plan_id: plan.plan_id,
      task_count: plan.tasks.length,
      committed_count: commitResult.committed_tasks.length,
      committed_tasks: commitResult.committed_tasks,
      summary,
      executed_at: now.toISOString(),
      next_review: nextReview.toISOString(),
    },
    source: 'system',
  });

  return {
    success: true,
    plan_id: plan.plan_id,
    committed_count: commitResult.committed_tasks.length,
    summary,
    next_review: nextReview.toISOString(),
    plan,
  };
}
