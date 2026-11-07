import { rateLimit } from 'express-rate-limit';
import { TASK_MUTATION_RATE_LIMIT_OPTIONS } from './task-mutation-rate-limit.js';
import pool from '../db.js';
import { createTask } from '../actions.js';
import { triggerCeceliaRun, checkCeceliaRunAvailable } from '../executor.js';
import { checkAnchor } from '../anchor-check.js';
import { checkDeviceLockForManualDispatch, releaseDeviceLockNonFatal } from '../lib/manual-dispatch-device-gate.js';
import { dispatchManualQiumi } from '../lib/manual-qiumi-dispatch.js';
import { CLAUDE_CHANNEL_RETIRED_CODE } from '../lib/claude-channel.js';
import { isRetiredDecomposition, RETIRED_DECOMPOSITION } from '../lib/retired-decomposition.js';

export function registerTaskManualDispatchRoutes(router) {


/**
 * POST /api/brain/tasks/:id/dispatch
 * 手动派发单个任务（用户从前端点击"派发"按钮）
 * 跳过自动调度的 drain/billing/slot 检查，但保留执行器可用性检查
 */
router.post('/tasks/:id/dispatch', rateLimit(TASK_MUTATION_RATE_LIMIT_OPTIONS), async (req, res) => {
  let deviceLockTaskId = null; // 已抢设备锁的任务 id（失败路径需释放）
  try {
    const { id } = req.params;

    // 1. 查找任务
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'task not found' });
    }

    const task = taskResult.rows[0];

    if (isRetiredDecomposition(task)) {
      return res.status(410).json({ error: RETIRED_DECOMPOSITION, detail: '旧任务拆解已退役，未派发' });
    }

    // 2. 只允许 queued 状态的任务被派发
    if (task.status !== 'queued') {
      return res.status(409).json({
        error: `task status is '${task.status}', only 'queued' tasks can be dispatched`,
        current_status: task.status
      });
    }

    // 2.5 S2 锚点闸（MJ5 刀2）：手动派发与 tick 派发同闸——无锚不点火
    // （07-17 验火发现本端点绕过 dispatcher 的 checkAnchor，闸必须站住所有必经之路）
    const anchorResult = checkAnchor(task);
    if (anchorResult.blocked) {
      return res.status(422).json({
        error: 'missing_anchor',
        detail: anchorResult.detail,
      });
    }

    if (task.task_type === 'qiumi_task') {
      const dispatched = await dispatchManualQiumi(task, pool);
      return res.status(dispatched.status).json(dispatched.body);
    }

    // 2.6 G5 设备锁闸（Issue e03fc740）：手动派发与 tick 派发同闸——无锁不点火
    const deviceGate = await checkDeviceLockForManualDispatch(task, 'tasks/:id/dispatch');
    if (!deviceGate.pass) {
      return res.status(deviceGate.status).json(deviceGate.body);
    }
    if (deviceGate.acquired) deviceLockTaskId = task.id;

    // 3. 更新为 in_progress
    await pool.query(
      `UPDATE tasks SET status = 'in_progress', updated_at = NOW(),
       metadata = COALESCE(metadata, '{}'::jsonb) || '{"manually_dispatched": true}'::jsonb
       WHERE id = $1`,
      [id]
    );

    // 4. 检查执行器可用性
    const ceceliaAvailable = await checkCeceliaRunAvailable(task);
    if (!ceceliaAvailable.available) {
      // 回滚 queued 不触发终态释放链，已抢的锁必须就地放掉
      await pool.query(`UPDATE tasks SET status = 'queued', claimed_by = NULL, claimed_at = NULL, updated_at = NOW() WHERE id = $1`, [id]);
      if (deviceLockTaskId) await releaseDeviceLockNonFatal(deviceLockTaskId, 'tasks/:id/dispatch');
      return res.status(503).json({
        error: 'executor not available',
        detail: ceceliaAvailable.error
      });
    }

    // 5. 触发执行
    const execResult = await triggerCeceliaRun(task);
    if (!execResult.success) {
      // 同上：回滚 queued 时释放已抢的设备锁
      await pool.query(`UPDATE tasks SET status = 'queued', claimed_by = NULL, claimed_at = NULL, updated_at = NOW() WHERE id = $1`, [id]);
      if (deviceLockTaskId) await releaseDeviceLockNonFatal(deviceLockTaskId, 'tasks/:id/dispatch');
      // Claude 无头通道已退役（任务 76a160b3）：不是执行故障，给出明确原因（任务已回 queued）
      if (execResult.reason === CLAUDE_CHANNEL_RETIRED_CODE || execResult.error === CLAUDE_CHANNEL_RETIRED_CODE) {
        return res.status(409).json({
          error: CLAUDE_CHANNEL_RETIRED_CODE,
          detail: '该任务路由到已退役的 Claude 无头通道，未派发，任务已回 queued；请改用 codex 等执行体（payload.executor）后重派',
        });
      }
      return res.status(500).json({
        error: 'dispatch failed',
        detail: execResult.error || execResult.reason
      });
    }

    // W7.7: 成功路径返回 202 Accepted + 标准化 body（task_id + dispatched_at），
    // 失败路径走上面 4xx/5xx 分支（404/409/503/5xx）。
    res.status(202).json({
      task_id: id,
      title: task.title,
      run_id: execResult.runId,
      dispatched_at: new Date().toISOString()
    });
  } catch (err) {
    // 异常路径：已抢的锁不能悬挂到 TTL（任务状态未必进终态释放链）
    if (deviceLockTaskId) await releaseDeviceLockNonFatal(deviceLockTaskId, 'tasks/:id/dispatch');
    console.error('[API] tasks/:id/dispatch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /api/brain/tasks/:id/request-intent-expand
 * 根据父任务创建 intent_expand 子任务
 * 沿 task.project_id → projects.kr_id → goals(KR).parent_id → goals(OKR).parent_id → goals(Vision)
 * 链路查询战略上下文，作为 intent_expand 子任务的 prompt 一部分
 */
router.post('/tasks/:id/request-intent-expand', rateLimit(TASK_MUTATION_RATE_LIMIT_OPTIONS), async (req, res) => {
  try {
    const { id: parentId } = req.params;

    // 1. 查找父任务
    const parentResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [parentId]);
    if (parentResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'parent task not found' });
    }
    const parentTask = parentResult.rows[0];

    // 2. 沿 project_id → initiative → scope → project → KR → Objective → Vision 链查询上下文
    // 迁移：projects → okr_initiatives/okr_scopes/okr_projects；goals → key_results/objectives/visions
    let context = { project: null, kr: null, okr: null, vision: null };

    if (parentTask.project_id) {
      // Initiative lookup（task.project_id = okr_initiatives.id）
      const initiativeResult = await pool.query(
        'SELECT id, title, scope_id FROM okr_initiatives WHERE id = $1',
        [parentTask.project_id]
      );
      if (initiativeResult.rows.length > 0) {
        const initiative = initiativeResult.rows[0];
        context.project = { id: initiative.id, name: initiative.title };

        // Scope → Project lookup
        if (initiative.scope_id) {
          const scopeResult = await pool.query(
            'SELECT id, project_id FROM okr_scopes WHERE id = $1',
            [initiative.scope_id]
          );
          if (scopeResult.rows.length > 0 && scopeResult.rows[0].project_id) {
            const projectId = scopeResult.rows[0].project_id;
            // KR lookup via okr_projects.kr_id → key_results
            const krLinkResult = await pool.query(
              'SELECT kr_id FROM okr_projects WHERE id = $1 LIMIT 1',
              [projectId]
            );
            if (krLinkResult.rows.length > 0) {
              const krId = krLinkResult.rows[0].kr_id;
              // KR = key_results
              const krResult = await pool.query(
                'SELECT id, title, description, objective_id FROM key_results WHERE id = $1',
                [krId]
              );
              if (krResult.rows.length > 0) {
                const kr = krResult.rows[0];
                context.kr = { id: kr.id, title: kr.title, description: kr.description };
                // OKR = objectives
                if (kr.objective_id) {
                  const okrResult = await pool.query(
                    'SELECT id, title, description, vision_id FROM objectives WHERE id = $1',
                    [kr.objective_id]
                  );
                  if (okrResult.rows.length > 0) {
                    const okr = okrResult.rows[0];
                    context.okr = { id: okr.id, title: okr.title, description: okr.description };
                    // Vision
                    if (okr.vision_id) {
                      const visionResult = await pool.query(
                        'SELECT id, title, description FROM visions WHERE id = $1',
                        [okr.vision_id]
                      );
                      if (visionResult.rows.length > 0) {
                        const vision = visionResult.rows[0];
                        context.vision = { id: vision.id, title: vision.title, description: vision.description };
                      }
                    }
                  }
                }
              } else {
                // Fallback: objectives 直接查
                const objResult = await pool.query(
                  'SELECT id, title, description FROM objectives WHERE id = $1',
                  [krId]
                );
                if (objResult.rows.length > 0) {
                  context.kr = { id: objResult.rows[0].id, title: objResult.rows[0].title, description: objResult.rows[0].description };
                }
              }
            }
          }
        }
      }
    }

    // 3. 构建子任务描述（包含战略上下文）
    const contextSummary = [
      context.vision ? `**Vision/Mission**: ${context.vision.title}` : null,
      context.okr ? `**OKR**: ${context.okr.title}` : null,
      context.kr ? `**KR**: ${context.kr.title}` : null,
      context.project ? `**Project**: ${context.project.name}` : null,
    ].filter(Boolean).join('\n');

    const description = [
      `## 意图扩展任务`,
      `父任务 ID: ${parentId}`,
      `父任务标题: ${parentTask.title}`,
      '',
      `## 战略上下文`,
      contextSummary || '（未找到关联的 OKR/KR 链路，请根据任务描述判断）',
      '',
      `## 父任务 PRD`,
      parentTask.prd_content || parentTask.description || '（无 PRD 内容）',
      '',
      `## 任务指令`,
      '请根据以上战略上下文，补全并丰富父任务的 PRD，确保实现方向与 OKR/Vision 对齐。',
      '补全后的 enriched PRD 通过 execution-callback 写入父任务 metadata.enriched_prd。',
    ].join('\n');

    // 4. 创建 intent_expand 子任务
    const { createTask } = await import('../actions.js');
    const subTaskResult = await createTask({
      title: `[意图扩展] ${parentTask.title}`,
      description,
      priority: parentTask.priority || 'P1',
      goal_id: parentTask.goal_id,
      project_id: parentTask.project_id,
      task_type: 'intent_expand',
      trigger_source: 'brain_auto',
      domain: parentTask.domain || 'agent_ops',
      payload: {
        parent_task_id: parentId,
        context_chain: context,
      },
    });

    if (!subTaskResult.success) {
      return res.status(500).json({ success: false, error: 'failed to create intent_expand task' });
    }

    return res.json({
      success: true,
      task_id: subTaskResult.task.id,
      parent_task_id: parentId,
      context_found: {
        has_project: !!context.project,
        has_kr: !!context.kr,
        has_okr: !!context.okr,
        has_vision: !!context.vision,
      },
      deduplicated: subTaskResult.deduplicated || false,
    });
  } catch (err) {
    console.error('[API] tasks/:id/request-intent-expand error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});
}
