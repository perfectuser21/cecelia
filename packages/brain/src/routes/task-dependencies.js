/**
 * 任务依赖 API（依赖单一写口的 HTTP 面，链 bf5088a3 棒5，任务 3fad28e0）。
 *
 *   GET    /api/brain/tasks/:id/dependencies          blocked_by（我等谁）+ blocks（谁等我）
 *   POST   /api/brain/tasks/:id/dependencies          { depends_on: [uuid...] | depends_on_id, edge_type? }
 *   DELETE /api/brain/tasks/:id/dependencies/:depId
 *
 * 此前 task_dependencies 只有 harness-dag 内部能写，人工/skill 想给两个任务连依赖只能 psql。
 * 写入全部经 lib/task-dependencies.js（边 + payload.depends_on 同步、自环/不存在/成环拒绝）。
 */
import {
  addTaskDependencies, removeTaskDependency, listTaskDependencies, EDGE_TYPES, TaskDependencyError,
} from '../lib/task-dependencies.js';
import { governanceErrorResponse } from '../lib/governance-errors.js';
import { assertProjectRootForMultiTask } from '../lib/project-root-gate.js';

async function taskExists(pool, id) {
  const { rows } = await pool.query('SELECT id, task_type FROM tasks WHERE id = $1::uuid', [id]);
  return rows[0] ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerTaskDependencyRoutes(router, { pool }) {
  router.get('/:id/dependencies', async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'invalid_task_id', reason_code: 'invalid_task_id' });
      if (!(await taskExists(pool, req.params.id))) return res.status(404).json({ error: 'Task not found', id: req.params.id });
      res.json({ task_id: req.params.id, ...(await listTaskDependencies(pool, req.params.id)) });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list dependencies', details: err.message });
    }
  });

  router.post('/:id/dependencies', async (req, res) => {
    try {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_task_id', reason_code: 'invalid_task_id' });
      const body = req.body || {};
      const edgeType = body.edge_type ?? 'hard';
      if (!EDGE_TYPES.includes(edgeType)) {
        return res.status(400).json({ error: 'invalid_edge_type', reason_code: 'invalid_edge_type', allowed: [...EDGE_TYPES] });
      }
      const wanted = body.depends_on ?? (body.depends_on_id ? [body.depends_on_id] : null);
      if (!Array.isArray(wanted) || wanted.length === 0) {
        return res.status(400).json({ error: 'depends_on_required', reason_code: 'depends_on_required', message: '需要 depends_on: [任务 uuid...] 或 depends_on_id' });
      }
      const task = await taskExists(pool, id);
      if (!task) return res.status(404).json({ error: 'Task not found', id });
      // 登记闸（PR B）：给任务连依赖 = 多刀，本任务必须已挂 project 根（自身是 project 根豁免）
      await assertProjectRootForMultiTask(pool, {
        taskType: task.task_type, parentTaskId: id, dependsOn: wanted, payload: {},
      });

      const result = await addTaskDependencies(pool, id, wanted, { edgeType, strict: true });
      res.status(201).json({ task_id: id, ...result, ...(await listTaskDependencies(pool, id)) });
    } catch (err) {
      const mapped = governanceErrorResponse(err);
      if (mapped) return res.status(mapped.status).json(mapped.body);
      res.status(500).json({ error: 'Failed to add dependency', details: err.message });
    }
  });

  router.delete('/:id/dependencies/:depId', async (req, res) => {
    try {
      const { id, depId } = req.params;
      const result = await removeTaskDependency(pool, { fromTaskId: id, toTaskId: depId });
      if (!result.removed) return res.status(404).json({ error: 'dependency_not_found', reason_code: 'dependency_not_found' });
      res.json({ task_id: id, removed: depId });
    } catch (err) {
      if (err instanceof TaskDependencyError) {
        const mapped = governanceErrorResponse(err);
        return res.status(mapped.status).json(mapped.body);
      }
      res.status(500).json({ error: 'Failed to remove dependency', details: err.message });
    }
  });
}
