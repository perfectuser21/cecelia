/**
 * project-compare.js
 * 跨项目对比报告生成逻辑
 * POST /api/brain/projects/compare/report
 */

import pool from './db.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 计算单个项目的评分（0-100）
 * - 完成率 0-40 分
 * - 无阻塞任务 0-20 分
 * - 有 P0 任务且进行中 0-20 分
 * - 最近 7 天活跃度 0-20 分
 */
function scoreProject(stats) {
  const { total, completed, failed, quarantined, p0_in_progress, recent_active } = stats;
  const completion_rate = total > 0 ? completed / total : 0;

  const completionScore = Math.round(completion_rate * 40);
  const noBlockerScore = (failed === 0 && quarantined === 0) ? 20 : 0;
  const p0Score = p0_in_progress > 0 ? 20 : 0;
  const activityScore = recent_active > 0 ? 20 : 0;

  return completionScore + noBlockerScore + p0Score + activityScore;
}

/**
 * 生成优势列表
 */
function buildStrengths(stats, score) {
  const strengths = [];
  const { total, completed, failed, quarantined, p0_in_progress, recent_active } = stats;
  const completion_rate = total > 0 ? completed / total : 0;

  if (completion_rate >= 0.7) strengths.push('完成率高（≥70%）');
  if (failed === 0 && quarantined === 0) strengths.push('无阻塞任务');
  if (p0_in_progress > 0) strengths.push('有 P0 任务进行中');
  if (recent_active > 0) strengths.push('最近 7 天有活跃任务');
  if (score >= 80) strengths.push('综合评分优秀');
  return strengths.length > 0 ? strengths : ['暂无明显优势'];
}

/**
 * 生成劣势列表
 */
function buildWeaknesses(stats) {
  const weaknesses = [];
  const { total, completed, failed, queued, p0_in_progress, recent_active } = stats;
  const completion_rate = total > 0 ? completed / total : 0;

  if (completion_rate < 0.3 && total > 0) weaknesses.push('完成率低（<30%）');
  if (failed > 0) weaknesses.push(`有 ${failed} 个失败任务`);
  if (queued > 5) weaknesses.push('积压任务较多');
  if (p0_in_progress === 0 && total > 0) weaknesses.push('缺乏 P0 任务');
  if (recent_active === 0 && total > 0) weaknesses.push('最近 7 天无活跃任务');
  return weaknesses.length > 0 ? weaknesses : ['暂无明显劣势'];
}

/**
 * 生成 Markdown 报告
 */
function buildMarkdown(projects, summary, generated_at) {
  const lines = [
    '# 项目对比报告',
    `生成时间：${generated_at}`,
    '',
  ];

  for (const p of projects) {
    lines.push(`## ${p.name}（分数：${p.score}）`);
    lines.push(`**类型**：${p.type}  **状态**：${p.status}`);
    lines.push('');
    lines.push(`**任务统计**：总计 ${p.task_stats.total} 个，完成 ${p.task_stats.completed} 个，进行中 ${p.task_stats.in_progress} 个，队列中 ${p.task_stats.queued} 个`);
    lines.push(`**完成率**：${Math.round(p.task_stats.completion_rate * 100)}%`);
    lines.push('');
    lines.push(`**优势**：${p.strengths.join('、')}`);
    lines.push(`**劣势**：${p.weaknesses.join('、')}`);
    lines.push('');
  }

  lines.push('## 总结');
  lines.push(summary);

  return lines.join('\n');
}

/**
 * 生成跨项目对比报告
 * @param {string[]} project_ids - 至少 2 个项目 UUID
 * @param {string} format - 'json' | 'markdown'
 * @param {boolean} include_tasks - 是否包含子任务统计
 */
export async function generateCompareReport({ project_ids, format = 'json', include_tasks = false }) {
  if (!Array.isArray(project_ids) || project_ids.length < 2) {
    throw Object.assign(new Error('project_ids must have at least 2 items'), { status: 400 });
  }

  // 查询项目基础信息
  const projectResult = await pool.query(
    `SELECT id, name, type, status, created_at, updated_at
     FROM projects
     WHERE id = ANY($1::uuid[])`,
    [project_ids]
  );

  const foundIds = new Set(projectResult.rows.map(r => r.id));
  const missingIds = project_ids.filter(id => !foundIds.has(id));
  if (missingIds.length > 0) {
    throw Object.assign(
      new Error(`Projects not found: ${missingIds.join(', ')}`),
      { status: 400 }
    );
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);

  // 查询任务统计
  const taskResult = await pool.query(
    `SELECT
       project_id,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'completed') AS completed,
       COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
       COUNT(*) FILTER (WHERE status = 'queued') AS queued,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed,
       COUNT(*) FILTER (WHERE status = 'quarantined') AS quarantined,
       COUNT(*) FILTER (WHERE priority = 'P0' AND status = 'in_progress') AS p0_in_progress,
       COUNT(*) FILTER (WHERE updated_at >= $2) AS recent_active
     FROM tasks
     WHERE project_id = ANY($1::uuid[])
     GROUP BY project_id`,
    [project_ids, sevenDaysAgo]
  );

  const taskStatsByProject = {};
  for (const row of taskResult.rows) {
    taskStatsByProject[row.project_id] = {
      total: parseInt(row.total, 10),
      completed: parseInt(row.completed, 10),
      in_progress: parseInt(row.in_progress, 10),
      queued: parseInt(row.queued, 10),
      failed: parseInt(row.failed, 10),
      quarantined: parseInt(row.quarantined, 10),
      p0_in_progress: parseInt(row.p0_in_progress, 10),
      recent_active: parseInt(row.recent_active, 10),
    };
  }

  // 组装每个项目的报告
  const projects = projectResult.rows.map(proj => {
    const raw = taskStatsByProject[proj.id] || {
      total: 0, completed: 0, in_progress: 0, queued: 0,
      failed: 0, quarantined: 0, p0_in_progress: 0, recent_active: 0,
    };
    const completion_rate = raw.total > 0 ? raw.completed / raw.total : 0;
    const score = scoreProject(raw);

    return {
      id: proj.id,
      name: proj.name,
      type: proj.type || 'project',
      status: proj.status,
      task_stats: {
        total: raw.total,
        completed: raw.completed,
        in_progress: raw.in_progress,
        queued: raw.queued,
        completion_rate: parseFloat(completion_rate.toFixed(2)),
      },
      strengths: buildStrengths(raw, score),
      weaknesses: buildWeaknesses(raw),
      score,
    };
  });

  // 排序：高分优先
  projects.sort((a, b) => b.score - a.score);

  const generated_at = now.toISOString();
  const best = projects[0];
  const summary = projects.length === 2
    ? `${best.name}（评分 ${best.score}）综合表现最佳，` +
      `${projects[1].name}（评分 ${projects[1].score}）次之。`
    : `共对比 ${projects.length} 个项目，${best.name}（评分 ${best.score}）综合表现最佳。`;

  const response = {
    generated_at,
    format,
    projects,
    summary,
  };

  if (format === 'markdown') {
    response.markdown = buildMarkdown(projects, summary, generated_at);
  }

  return response;
}

/**
 * 获取跨项目对比指标（含 KR 进度 + 历史趋势）
 * GET /api/brain/projects/compare
 * @param {string[]} project_ids - 至少 2 个项目 UUID
 * @param {string} format - 'json' | 'markdown'
 * @param {number} trend_weeks - 趋势周数（1-12，默认 4）
 */
export async function getCompareMetrics({ project_ids, format = 'json', trend_weeks = 4 }) {
  if (!Array.isArray(project_ids) || project_ids.length < 2) {
    throw Object.assign(new Error('project_ids must have at least 2 items'), { status: 400 });
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);

  // 并行执行 3 个查询
  const [projectResult, taskResult, trendResult] = await Promise.all([
    // 查询A: 项目基本信息 + KR 关联
    pool.query(
      `SELECT p.id, p.name, p.type, p.status, p.kr_id,
              g.id AS kr_goal_id, g.title AS kr_title, g.progress AS kr_progress
       FROM projects p
       LEFT JOIN goals g ON p.kr_id = g.id
       WHERE p.id = ANY($1::uuid[])`,
      [project_ids]
    ),
    // 查询B: 任务统计
    pool.query(
      `SELECT
         project_id,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed,
         COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
         COUNT(*) FILTER (WHERE status = 'queued') AS queued,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed,
         COUNT(*) FILTER (WHERE status = 'quarantined') AS quarantined,
         COUNT(*) FILTER (WHERE priority = 'P0' AND status = 'in_progress') AS p0_in_progress,
         COUNT(*) FILTER (WHERE updated_at >= $2) AS recent_active
       FROM tasks
       WHERE project_id = ANY($1::uuid[])
       GROUP BY project_id`,
      [project_ids, sevenDaysAgo]
    ),
    // 查询C: 历史趋势（按周统计已完成任务）
    pool.query(
      `SELECT project_id,
              to_char(completed_at AT TIME ZONE 'Asia/Shanghai', 'IYYY-"W"IW') AS week,
              COUNT(*) AS completed
       FROM tasks
       WHERE project_id = ANY($1::uuid[])
         AND status = 'completed'
         AND completed_at >= now() - ($2 * interval '1 week')
       GROUP BY project_id, week
       ORDER BY project_id, week`,
      [project_ids, trend_weeks]
    ),
  ]);

  // 验证所有 project_id 都存在
  const foundIds = new Set(projectResult.rows.map(r => r.id));
  const missingIds = project_ids.filter(id => !foundIds.has(id));
  if (missingIds.length > 0) {
    throw Object.assign(
      new Error(`Projects not found: ${missingIds.join(', ')}`),
      { status: 400 }
    );
  }

  // 整理任务统计
  const taskStatsByProject = {};
  for (const row of taskResult.rows) {
    taskStatsByProject[row.project_id] = {
      total: parseInt(row.total, 10),
      completed: parseInt(row.completed, 10),
      in_progress: parseInt(row.in_progress, 10),
      queued: parseInt(row.queued, 10),
      failed: parseInt(row.failed, 10),
      quarantined: parseInt(row.quarantined, 10),
      p0_in_progress: parseInt(row.p0_in_progress, 10),
      recent_active: parseInt(row.recent_active, 10),
    };
  }

  // 整理趋势数据
  const trendByProject = {};
  for (const row of trendResult.rows) {
    if (!trendByProject[row.project_id]) {
      trendByProject[row.project_id] = [];
    }
    trendByProject[row.project_id].push({
      week: row.week,
      completed: parseInt(row.completed, 10),
    });
  }

  // 组装每个项目的响应
  const projects = projectResult.rows.map(proj => {
    const raw = taskStatsByProject[proj.id] || {
      total: 0, completed: 0, in_progress: 0, queued: 0,
      failed: 0, quarantined: 0, p0_in_progress: 0, recent_active: 0,
    };
    const completion_rate = raw.total > 0 ? raw.completed / raw.total : 0;
    const score = scoreProject(raw);

    return {
      id: proj.id,
      name: proj.name,
      type: proj.type || 'project',
      status: proj.status,
      kr: proj.kr_id ? {
        id: proj.kr_goal_id,
        title: proj.kr_title,
        progress: parseInt(proj.kr_progress, 10) || 0,
      } : null,
      task_stats: {
        total: raw.total,
        completed: raw.completed,
        in_progress: raw.in_progress,
        queued: raw.queued,
        completion_rate: parseFloat(completion_rate.toFixed(2)),
      },
      trend: trendByProject[proj.id] || [],
      strengths: buildStrengths(raw, score),
      weaknesses: buildWeaknesses(raw),
      score,
    };
  });

  // 排序：高分优先
  projects.sort((a, b) => b.score - a.score);

  const generated_at = now.toISOString();
  const best = projects[0];
  const summary = projects.length === 2
    ? `${best.name}（评分 ${best.score}）综合表现最佳，` +
      `${projects[1].name}（评分 ${projects[1].score}）次之。`
    : `共对比 ${projects.length} 个项目，${best.name}（评分 ${best.score}）综合表现最佳。`;

  const response = {
    generated_at,
    format,
    projects,
    summary,
  };

  if (format === 'markdown') {
    response.markdown = buildMarkdown(projects, summary, generated_at);
  }

  return response;
}
