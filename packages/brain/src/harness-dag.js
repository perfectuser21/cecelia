/**
 * Harness v2 — DAG 调度器
 *
 * PRD: docs/design/harness-v2-prd.md §6.1 Task 依赖 DAG
 * Milestone: M2
 *
 * 职责：
 *   - parseTaskPlan(jsonString)   — 校验 Planner 输出的 task-plan.json
 *   - detectCycle(tasks)          — DFS 环检测
 *   - topologicalOrder(tasks)     — Kahn 算法排序
 *   - upsertTaskPlan(...)         — 事务内建 Brain tasks + pr_plans + task_dependencies
 *   - nextRunnableTask(initId)    — 返回依赖全部 completed 的下一个 pending task
 *
 * 所有"数据库"函数接受外部注入的 `client`（便于测试和跨事务复用）。
 * 不直接 import pool — 调用者决定用 pool 还是 txn client。
 */

import pool from './db.js';

// ─── Schema 校验 ────────────────────────────────────────────────────────────

const VALID_COMPLEXITY = new Set(['S', 'M', 'L']);

/**
 * 验证并返回 parsed task-plan.json。
 *
 * @param {string} jsonString  Planner 输出的 JSON 原文（可含 Markdown code fence）
 * @returns {{initiative_id: string, tasks: Array<object>, justification?: string}}
 * @throws {Error} 字段缺失 / 值非法时
 */
export function parseTaskPlan(jsonString) {
  if (typeof jsonString !== 'string') {
    throw new Error('parseTaskPlan: jsonString must be a string');
  }

  // 兼容 Markdown code fence ```json ... ```
  let raw = jsonString.trim();
  const fenceMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) raw = fenceMatch[1].trim();

  // 也兼容大段文本里的第一个完整 JSON 对象
  if (!raw.startsWith('{')) {
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (!objMatch) {
      throw new Error('parseTaskPlan: no JSON object found');
    }
    raw = objMatch[0];
  }

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    throw new Error(`parseTaskPlan: invalid JSON — ${err.message}`);
  }

  if (!obj || typeof obj !== 'object') {
    throw new Error('parseTaskPlan: root must be object');
  }
  if (typeof obj.initiative_id !== 'string' || !obj.initiative_id.trim()) {
    throw new Error('parseTaskPlan: initiative_id required (string)');
  }
  if (!Array.isArray(obj.tasks) || obj.tasks.length === 0) {
    throw new Error('parseTaskPlan: tasks must be non-empty array');
  }
  if (obj.tasks.length > 8) {
    throw new Error(`parseTaskPlan: tasks length ${obj.tasks.length} > 8 (hard cap)`);
  }
  if (obj.tasks.length > 5 && (!obj.justification || typeof obj.justification !== 'string' || !obj.justification.trim())) {
    throw new Error('parseTaskPlan: tasks.length > 5 requires non-empty justification');
  }

  const seen = new Set();
  for (const [i, t] of obj.tasks.entries()) {
    if (!t || typeof t !== 'object') {
      throw new Error(`parseTaskPlan: tasks[${i}] must be object`);
    }
    for (const field of ['task_id', 'title', 'scope']) {
      if (typeof t[field] !== 'string' || !t[field].trim()) {
        throw new Error(`parseTaskPlan: tasks[${i}].${field} required (non-empty string)`);
      }
    }
    if (seen.has(t.task_id)) {
      throw new Error(`parseTaskPlan: duplicate task_id "${t.task_id}"`);
    }
    seen.add(t.task_id);

    if (!Array.isArray(t.dod) || t.dod.length === 0 || !t.dod.every((x) => typeof x === 'string' && x.trim())) {
      throw new Error(`parseTaskPlan: tasks[${i}].dod must be non-empty string[]`);
    }
    if (!Array.isArray(t.files) || t.files.length === 0 || !t.files.every((x) => typeof x === 'string' && x.trim())) {
      throw new Error(`parseTaskPlan: tasks[${i}].files must be non-empty string[]`);
    }
    if (!Array.isArray(t.depends_on) || !t.depends_on.every((x) => typeof x === 'string')) {
      throw new Error(`parseTaskPlan: tasks[${i}].depends_on must be string[]`);
    }
    if (!VALID_COMPLEXITY.has(t.complexity)) {
      throw new Error(`parseTaskPlan: tasks[${i}].complexity must be S|M|L`);
    }
    if (typeof t.estimated_minutes !== 'number' || t.estimated_minutes < 20 || t.estimated_minutes > 60) {
      throw new Error(`parseTaskPlan: tasks[${i}].estimated_minutes must be 20 <= n <= 60`);
    }
  }

  // depends_on 引用合法性 + 自环
  for (const t of obj.tasks) {
    for (const dep of t.depends_on) {
      if (dep === t.task_id) {
        throw new Error(`parseTaskPlan: tasks[${t.task_id}].depends_on contains self`);
      }
      if (!seen.has(dep)) {
        throw new Error(`parseTaskPlan: tasks[${t.task_id}].depends_on references unknown "${dep}"`);
      }
    }
  }

  // 环检测
  if (detectCycle(obj.tasks)) {
    throw new Error('parseTaskPlan: DAG contains cycle');
  }

  return obj;
}

// ─── DAG 算法 ───────────────────────────────────────────────────────────────

/**
 * DFS 环检测。tasks 结构：[{ task_id, depends_on: [task_id] }]
 *
 * @param {Array<{task_id:string, depends_on:string[]}>} tasks
 * @returns {boolean} true 有环
 */
export function detectCycle(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return false;

  const graph = new Map();
  for (const t of tasks) {
    graph.set(t.task_id, Array.isArray(t.depends_on) ? [...t.depends_on] : []);
  }

  const WHITE = 0; // 未访问
  const GRAY = 1; // 当前 DFS 路径中
  const BLACK = 2; // 已完成
  const color = new Map();
  for (const id of graph.keys()) color.set(id, WHITE);

  function visit(id) {
    const c = color.get(id);
    if (c === GRAY) return true; // 回边 — 有环
    if (c === BLACK) return false;
    color.set(id, GRAY);
    const deps = graph.get(id) || [];
    for (const dep of deps) {
      if (!graph.has(dep)) continue; // 未知引用（parseTaskPlan 已拦，此处容错）
      if (visit(dep)) return true;
    }
    color.set(id, BLACK);
    return false;
  }

  for (const id of graph.keys()) {
    if (color.get(id) === WHITE && visit(id)) return true;
  }
  return false;
}

/**
 * Kahn 算法拓扑排序。
 * 依赖（depends_on）方向：B 依赖 A 表示 A 必须先完成。
 * 输出是 A 在 B 之前的执行顺序。
 *
 * @param {Array<{task_id:string, depends_on:string[]}>} tasks
 * @returns {string[]} task_id 按执行顺序
 * @throws {Error} 有环
 */
export function topologicalOrder(tasks) {
  if (!Array.isArray(tasks)) throw new Error('topologicalOrder: tasks must be array');
  if (tasks.length === 0) return [];

  const inDegree = new Map();
  const successors = new Map(); // A -> [B,...] 表示 B 依赖 A
  for (const t of tasks) {
    inDegree.set(t.task_id, 0);
    successors.set(t.task_id, []);
  }
  for (const t of tasks) {
    for (const dep of (t.depends_on || [])) {
      if (!inDegree.has(dep)) continue;
      inDegree.set(t.task_id, inDegree.get(t.task_id) + 1);
      successors.get(dep).push(t.task_id);
    }
  }

  // 入度为 0 的节点先入队（保持原始输入顺序稳定性）
  const queue = [];
  for (const t of tasks) {
    if (inDegree.get(t.task_id) === 0) queue.push(t.task_id);
  }

  const result = [];
  while (queue.length) {
    const id = queue.shift();
    result.push(id);
    for (const next of successors.get(id) || []) {
      inDegree.set(next, inDegree.get(next) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }

  if (result.length !== tasks.length) {
    throw new Error('topologicalOrder: cycle detected');
  }
  return result;
}

// ─── DB 操作（事务内安全） ─────────────────────────────────────────────────

/**
 * 把 task-plan 物化到 Brain：
 *   - 为每个 logical task 建 `tasks` 行（task_type='harness_task', status='queued'）
 *   - 在 `tasks.payload` 记 parent(initiative)/logical_id/dod/files/complexity
 *   - 建 `task_dependencies` 边（hard edges）
 *
 * 必须在单事务内调用。调用方负责 BEGIN/COMMIT。
 *
 * 注：v2 PRD §4.5 原计划双写 `pr_plans.depends_on`，但 `pr_plans` 是 project 级元数据
 * （沿用 021 migration 的 project_id 锚定，不含 task_id 字段），schema 不匹配 v2
 * Task 级语义，因此 M2 只写 tasks + task_dependencies。pr_plans 双写留到后续
 * milestone 做 schema 对齐时再加。
 *
 * @param {object} p
 * @param {string} p.initiativeId       Initiative 的 projects.id（业务归属，写入 payload）
 * @param {string} p.initiativeTaskId   harness_initiative task 的 UUID（写入 payload.parent_task_id）
 * @param {object} p.taskPlan           parseTaskPlan 的返回值
 * @param {object} p.client             pg txn client（.query()）
 * @returns {Promise<{idMap: Record<string,string>, insertedTaskIds: string[]}>}
 */
export async function upsertTaskPlan({ initiativeId, initiativeTaskId, taskPlan, client }) {
  if (!client) throw new Error('upsertTaskPlan: client required');
  if (!initiativeTaskId) throw new Error('upsertTaskPlan: initiativeTaskId required');
  if (!taskPlan || !Array.isArray(taskPlan.tasks)) {
    throw new Error('upsertTaskPlan: taskPlan.tasks required');
  }

  const idMap = {}; // logical -> uuid
  const insertedTaskIds = [];

  const order = topologicalOrder(taskPlan.tasks);

  for (const logicalId of order) {
    const t = taskPlan.tasks.find((x) => x.task_id === logicalId);

    const taskInsert = await client.query(
      `INSERT INTO tasks (task_type, title, description, status, priority, payload)
       VALUES ('harness_task', $1, $2, 'queued', 'P2', $3::jsonb)
       RETURNING id`,
      [
        t.title,
        t.scope,
        JSON.stringify({
          logical_task_id: t.task_id,
          initiative_id: initiativeId,
          parent_task_id: initiativeTaskId,
          complexity: t.complexity,
          estimated_minutes: t.estimated_minutes,
          files: t.files,
          dod: t.dod,
          depends_on_logical: t.depends_on || [],
        }),
      ]
    );
    const uuid = taskInsert.rows[0].id;
    idMap[t.task_id] = uuid;
    insertedTaskIds.push(uuid);
  }

  // 建 task_dependencies 边
  for (const t of taskPlan.tasks) {
    const from = idMap[t.task_id];
    for (const depLogical of (t.depends_on || [])) {
      const to = idMap[depLogical];
      if (!to) continue;
      await client.query(
        `INSERT INTO task_dependencies (from_task_id, to_task_id, edge_type)
         VALUES ($1::uuid, $2::uuid, 'hard')
         ON CONFLICT DO NOTHING`,
        [from, to]
      );
    }
  }

  return { idMap, insertedTaskIds };
}

/**
 * 查询 initiative 下一个可运行 task（所有依赖已 completed，自身 queued）。
 * FIFO 按 created_at。
 *
 * 注：tasks 表无 parent_task_id 字段，parent 关系写在 payload.parent_task_id
 * （由 upsertTaskPlan 写入）。用 payload->>'parent_task_id' 过滤子任务。
 *
 * @param {string} initiativeTaskId  harness_initiative task UUID（作为 subtask parent）
 * @param {{ client?: object }} [opts]
 * @returns {Promise<object|null>} 返回 tasks 行或 null
 */
export async function nextRunnableTask(initiativeTaskId, opts = {}) {
  if (!initiativeTaskId) throw new Error('nextRunnableTask: initiativeTaskId required');
  const c = opts.client || pool;

  const sql = `
    SELECT t.*
    FROM tasks t
    WHERE t.task_type = 'harness_task'
      AND t.payload->>'parent_task_id' = $1
      AND t.status = 'queued'
      AND NOT EXISTS (
        SELECT 1
        FROM task_dependencies d
        JOIN tasks dep ON dep.id = d.to_task_id
        WHERE d.from_task_id = t.id
          AND dep.status <> 'completed'
      )
    ORDER BY t.created_at ASC
    LIMIT 1
  `;
  const { rows } = await c.query(sql, [String(initiativeTaskId)]);
  return rows[0] || null;
}
