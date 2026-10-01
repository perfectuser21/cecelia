/**
 * Task Router Diagnose Route
 *
 * GET /task-router/diagnose/:kr_id
 *   — 诊断 KR 下所有 Project 的任务状态，分析为什么 7 天内未派发任何任务
 *
 * 返回：
 *   - kr_id, kr_title
 *   - projects[]  每个 Project 的任务状态分布
 *   - blockers[]     阻止派发的原因列表
 *   - summary        汇总统计
 */

import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import pool from '../db.js';

const router = Router();
const diagnoseRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'diagnose_rate_limit_exceeded' },
});

// GET /task-router/diagnose — smoke / health check（无需 kr_id）
router.get('/diagnose', (_req, res) => {
  res.json({ status: 'ok', usage: 'GET /api/brain/task-router/diagnose/:kr_id' });
});

// GET /task-router/diagnose/:kr_id
router.get('/diagnose/:kr_id', diagnoseRateLimit, async (req, res) => {
  const { kr_id } = req.params;
  const { since_days = 7 } = req.query;

  console.log(`[task-router-diagnose] 开始诊断 KR ${kr_id}（过去 ${since_days} 天）`);

  try {
    // ── 1. 读取 KR 信息（key_results 表，与 task-router.js 一致）──────
    const krResult = await pool.query(
      `SELECT id, title, status,
              progress_pct AS progress,
              NULL::text AS priority
       FROM key_results WHERE id = $1`,
      [kr_id]
    );

    if (krResult.rows.length === 0) {
      console.warn(`[task-router-diagnose] KR ${kr_id} 不存在`);
      return res.status(404).json({ error: `KR ${kr_id} 不存在` });
    }

    const kr = krResult.rows[0];
    console.log(`[task-router-diagnose] KR 找到: ${kr.title} (${kr.status}, progress=${kr.progress})`);

    // KR → Project → Task。
    const projectsResult = await pool.query(
      `SELECT id, name, status, 'project'::text AS type, created_at, updated_at
       FROM projects WHERE kr_id = $1 ORDER BY created_at ASC`, [kr_id]
    );

    const projects = projectsResult.rows;
    console.log(`[task-router-diagnose] KR ${kr_id} 下找到 ${projects.length} 个 Project`);

    if (projects.length === 0) {
      return res.json({
        kr_id,
        kr_title: kr.title,
        kr_status: kr.status,
        projects: [],
        blockers: [{ type: 'no_projects', description: 'KR 下没有任何 Project，无法派发任务' }],
        summary: {
          total_projects: 0,
          total_tasks: 0,
          dispatchable_tasks: 0,
          blocked_tasks: 0,
          last_dispatch_days_ago: null,
        },
      });
    }

    const projectIds = projects.map(i => i.id);

    // ── 3. 汇总每个 Project 的任务状态分布（用 project_id）─────
    const taskCountsResult = await pool.query(
      `SELECT
         project_id AS project_id,
         status,
         COUNT(*) AS cnt
       FROM tasks
       WHERE project_id = ANY($1::uuid[]) AND task_type <> 'project'
       GROUP BY project_id, status`,
      [projectIds]
    );

    // 聚合为 { [project_id]: { queued, in_progress, completed, failed, ... } }
    const countsByProject = {};
    for (const row of taskCountsResult.rows) {
      if (!countsByProject[row.project_id]) {
        countsByProject[row.project_id] = {};
      }
      countsByProject[row.project_id][row.status] = parseInt(row.cnt);
    }

    // ── 4. 检查每个 Project 中 queued 任务的阻塞原因 ───────────────
    const queuedTasksResult = await pool.query(
      `SELECT
         t.id, t.title, t.status, t.priority,
         t.project_id AS project_id, t.goal_id,
         t.created_at, t.updated_at,
         t.payload
       FROM tasks t
       WHERE t.project_id = ANY($1::uuid[]) AND t.task_type <> 'project'
         AND t.status = 'queued'
       ORDER BY t.project_id, t.created_at ASC`,
      [projectIds]
    );

    const queuedTasks = queuedTasksResult.rows;
    console.log(`[task-router-diagnose] 找到 ${queuedTasks.length} 个 queued 状态任务`);

    // ── 5. 分析每个 queued 任务的阻塞原因 ────────────────────────────
    const taskBlockers = [];
    const now = new Date();

    for (const task of queuedTasks) {
      const reasons = [];

      // 5.1 检查 goal_id 是否缺失（派发器过滤条件）
      if (!task.goal_id) {
        reasons.push('goal_id_missing');
      }

      // 5.2 检查 next_run_at 延迟
      const nextRunAt = task.payload?.next_run_at;
      if (nextRunAt) {
        const nextRun = new Date(nextRunAt);
        if (nextRun > now) {
          const diffMs = nextRun - now;
          const diffHours = Math.round(diffMs / 3600000);
          reasons.push(`next_run_at_future:+${diffHours}h`);
        }
      }

      // 5.3 检查 depends_on 未完成
      const dependsOn = task.payload?.depends_on;
      if (Array.isArray(dependsOn) && dependsOn.length > 0) {
        const depResult = await pool.query(
          `SELECT COUNT(*) AS cnt FROM tasks WHERE id = ANY($1) AND status != 'completed'`,
          [dependsOn]
        );
        const pendingDeps = parseInt(depResult.rows[0].cnt);
        if (pendingDeps > 0) {
          reasons.push(`depends_on_incomplete:${pendingDeps}/${dependsOn.length}`);
        }
      }

      if (reasons.length > 0) {
        taskBlockers.push({
          task_id: task.id,
          task_title: task.title,
          project_id: task.project_id,
          blockers: reasons,
        });
        console.log(`[task-router-diagnose] 任务 "${task.title}" (${task.id}) 被阻塞: ${reasons.join(', ')}`);
      }
    }

    // ── 6. 检查近 N 天的派发记录（查 in_progress + completed 任务）────
    const recentDispatchResult = await pool.query(
      `SELECT
         t.id, t.title, t.status, t.project_id AS project_id,
         t.updated_at
       FROM tasks t
       WHERE t.project_id = ANY($1::uuid[]) AND t.task_type <> 'project'
         AND t.status IN ('in_progress', 'completed', 'failed')
         AND t.updated_at >= NOW() - INTERVAL '1 day' * $2
       ORDER BY t.updated_at DESC
       LIMIT 20`,
      [projectIds, parseInt(since_days)]
    );

    const recentDispatches = recentDispatchResult.rows;
    console.log(`[task-router-diagnose] 过去 ${since_days} 天内有 ${recentDispatches.length} 个任务有活动`);

    // 计算最后一次派发距今天数
    let lastDispatchDaysAgo = null;
    if (recentDispatches.length > 0) {
      const lastActivity = new Date(recentDispatches[0].updated_at);
      lastDispatchDaysAgo = Math.round((now - lastActivity) / 86400000);
    } else {
      // 查找历史上最近一次
      const anyRecentResult = await pool.query(
        `SELECT MAX(updated_at) AS last_updated
         FROM tasks
         WHERE project_id = ANY($1::uuid[]) AND task_type <> 'project'
           AND status IN ('in_progress', 'completed', 'failed')`,
        [projectIds]
      );
      if (anyRecentResult.rows[0]?.last_updated) {
        const lastActivity = new Date(anyRecentResult.rows[0]?.last_updated);
        lastDispatchDaysAgo = Math.round((now - lastActivity) / 86400000);
      }
    }

    // ── 7. 组装 projects 数组 ──────────────────────────────────────
    const projectDetails = projects.map(project => {
      const counts = countsByProject[project.id] || {};
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      return {
        id: project.id,
        name: project.name,
        status: project.status,
        type: project.type,
        created_at: project.created_at,
        task_counts: {
          queued: counts.queued || 0,
          in_progress: counts.in_progress || 0,
          completed: counts.completed || 0,
          failed: counts.failed || 0,
          quarantined: counts.quarantined || 0,
          total,
        },
        queued_task_blockers: taskBlockers
          .filter(b => b.project_id === project.id)
          .map(b => ({ task_id: b.task_id, task_title: b.task_title, blockers: b.blockers })),
      };
    });

    // ── 8. 汇总 blockers ──────────────────────────────────────────────
    const blockers = [];

    const totalQueued = projectDetails.reduce((s, i) => s + i.task_counts.queued, 0);
    const totalTasks = projectDetails.reduce((s, i) => s + i.task_counts.total, 0);
    const blockedCount = taskBlockers.length;
    const dispatchableCount = totalQueued - blockedCount;

    if (totalTasks === 0) {
      blockers.push({
        type: 'no_tasks',
        description: `KR 下 ${projects.length} 个 Project 中没有任何任务，需要先创建任务`,
      });
    }

    if (totalQueued === 0 && totalTasks > 0) {
      blockers.push({
        type: 'no_queued_tasks',
        description: `所有 ${totalTasks} 个任务都不在 queued 状态，无法被派发器选中`,
      });
    }

    const goalIdMissingCount = taskBlockers.filter(b => b.blockers.includes('goal_id_missing')).length;
    if (goalIdMissingCount > 0) {
      blockers.push({
        type: 'goal_id_missing',
        count: goalIdMissingCount,
        description: `${goalIdMissingCount} 个 queued 任务缺少 goal_id（KR 关联），派发器会跳过它们`,
      });
    }

    const nextRunAtCount = taskBlockers.filter(b => b.blockers.some(r => r.startsWith('next_run_at_future'))).length;
    if (nextRunAtCount > 0) {
      blockers.push({
        type: 'next_run_at_delayed',
        count: nextRunAtCount,
        description: `${nextRunAtCount} 个任务的 next_run_at 设置为未来时间，还未到执行时间`,
      });
    }

    const dependsOnCount = taskBlockers.filter(b => b.blockers.some(r => r.startsWith('depends_on_incomplete'))).length;
    if (dependsOnCount > 0) {
      blockers.push({
        type: 'depends_on_incomplete',
        count: dependsOnCount,
        description: `${dependsOnCount} 个任务有未完成的依赖任务，等待前置任务完成`,
      });
    }

    const inactiveProjectCount = projectDetails.filter(i => i.status !== 'active' && i.task_counts.queued > 0).length;
    if (inactiveProjectCount > 0) {
      blockers.push({
        type: 'project_not_active',
        count: inactiveProjectCount,
        description: `${inactiveProjectCount} 个 Project 状态不是 active，但有 queued 任务`,
      });
    }

    if (lastDispatchDaysAgo !== null && lastDispatchDaysAgo > parseInt(since_days)) {
      blockers.push({
        type: 'long_inactivity',
        days_ago: lastDispatchDaysAgo,
        description: `最后一次派发活动是 ${lastDispatchDaysAgo} 天前，超过 ${since_days} 天无派发`,
      });
    }

    console.log(`[task-router-diagnose] 诊断完成: ${totalTasks} 个任务, ${totalQueued} 个 queued, ${dispatchableCount} 个可派发, ${blockers.length} 个 blocker`);

    res.json({
      kr_id,
      kr_title: kr.title,
      kr_status: kr.status,
      kr_progress: kr.progress,
      kr_priority: kr.priority,
      diagnosed_at: now.toISOString(),
      since_days: parseInt(since_days),
      projects: projectDetails,
      blockers,
      recent_activity: recentDispatches.slice(0, 5).map(t => ({
        task_id: t.id,
        task_title: t.title,
        status: t.status,
        updated_at: t.updated_at,
      })),
      summary: {
        total_projects: projects.length,
        total_tasks: totalTasks,
        queued_tasks: totalQueued,
        dispatchable_tasks: dispatchableCount,
        blocked_tasks: blockedCount,
        last_dispatch_days_ago: lastDispatchDaysAgo,
        has_blockers: blockers.length > 0,
      },
    });

  } catch (err) {
    console.error('[task-router-diagnose] 诊断失败:', err.message, err.stack);
    res.status(500).json({ error: '诊断失败', details: err.message });
  }
});

export default router;
