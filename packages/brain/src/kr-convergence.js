/**
 * KR 优先级收敛与依赖排序引擎
 *
 * 对所有活跃 KR 进行综合评分，输出 top 3 主线焦点和暂停建议。
 *
 * 评分公式（4 个维度，权重合计 100%）：
 *   score = progress_score      * 0.35   // 进度：已走了多少
 *         + activity_score      * 0.30   // 任务活跃度：关联任务活跃数量
 *         + project_density_score * 0.20 // 项目密度：关联 okr_projects 数量
 *         + metric_momentum_score * 0.15 // 指标动量：metric_current > 0
 */

/**
 * 计算所有活跃 KR 的收敛优先级。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{
 *   computed_at: string,
 *   active_kr_count: number,
 *   top3: Array,
 *   pause_candidates: Array,
 *   all_ranked: Array
 * }>}
 */
export async function computeKrConvergence(pool) {
  // 1. 查所有活跃 KR
  const krsResult = await pool.query(`
    SELECT id, title, status, progress, priority, metadata
    FROM key_results
    WHERE status IN ('active', 'in_progress')
    ORDER BY created_at ASC
  `);

  const krs = krsResult.rows;

  if (krs.length === 0) {
    return {
      computed_at: new Date().toISOString(),
      active_kr_count: 0,
      top3: [],
      pause_candidates: [],
      all_ranked: [],
    };
  }

  const krIds = krs.map(kr => kr.id);

  // 2. 查每个 KR 关联的 okr_projects 数量（项目密度）
  const projectCountResult = await pool.query(`
    SELECT kr_id, COUNT(*) AS project_count
    FROM okr_projects
    WHERE kr_id = ANY($1)
    GROUP BY kr_id
  `, [krIds]);

  const projectCountMap = {};
  for (const row of projectCountResult.rows) {
    projectCountMap[row.kr_id] = parseInt(row.project_count, 10);
  }

  // 3. 查每个 KR 关联的活跃任务数（通过 tasks.goal_id → key_results.id）
  const taskCountResult = await pool.query(`
    SELECT goal_id AS kr_id, COUNT(*) AS task_count
    FROM tasks
    WHERE goal_id = ANY($1)
      AND status IN ('active', 'in_progress', 'queued')
    GROUP BY goal_id
  `, [krIds]);

  const taskCountMap = {};
  for (const row of taskCountResult.rows) {
    taskCountMap[row.kr_id] = parseInt(row.task_count, 10);
  }

  // 4. 归一化基准值（避免除零）
  const maxProjectCount = Math.max(1, ...Object.values(projectCountMap));
  const maxTaskCount = Math.max(1, ...Object.values(taskCountMap));

  // 5. 计算每个 KR 的综合分数
  const scored = krs.map(kr => {
    const progress = kr.progress || 0;
    const projectCount = projectCountMap[kr.id] || 0;
    const taskCount = taskCountMap[kr.id] || 0;
    const metricCurrent = parseFloat(kr.metadata?.metric_current || '0');

    const progress_score = progress / 100;
    const activity_score = taskCount / maxTaskCount;
    const project_density_score = projectCount / maxProjectCount;
    const metric_momentum_score = metricCurrent > 0 ? 1 : 0;

    const score = Math.round((
      progress_score * 0.35 +
      activity_score * 0.30 +
      project_density_score * 0.20 +
      metric_momentum_score * 0.15
    ) * 1000) / 1000;

    return {
      id: kr.id,
      title: kr.title,
      status: kr.status,
      progress,
      priority: kr.priority,
      score,
      _meta: { progress_score, activity_score, project_density_score, metric_momentum_score, projectCount, taskCount },
    };
  });

  // 6. 按分数降序排列，同分按 title 字典序保证稳定性
  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  // 7. 生成可读 reason
  const withReason = scored.map((kr, idx) => {
    const parts = [];
    if (kr._meta.progress_score > 0) parts.push(`进度 ${kr.progress}%`);
    if (kr._meta.taskCount > 0) parts.push(`${kr._meta.taskCount} 个活跃任务`);
    if (kr._meta.projectCount > 0) parts.push(`${kr._meta.projectCount} 个关联项目`);
    if (kr._meta.metric_momentum_score > 0) parts.push('指标有进展');
    const reason = parts.length > 0 ? parts.join('；') : '暂无活跃进展';

    return {
      id: kr.id,
      title: kr.title,
      score: kr.score,
      rank: idx + 1,
      progress: kr.progress,
      status: kr.status,
      reason,
    };
  });

  // 8. 分割 top3 和 pause_candidates
  const top3 = withReason.slice(0, 3);
  const rest = withReason.slice(3);

  const pause_candidates = rest.map(kr => ({
    id: kr.id,
    title: kr.title,
    score: kr.score,
    progress: kr.progress,
    suggestion: kr.score === 0 ? '暂停' : '降级',
    reason: kr.score === 0
      ? '无活跃任务、无进度、无指标动量，建议暂停以集中资源'
      : `综合得分 ${kr.score}，低于 top3 阈值，建议降级至 P2 处理`,
  }));

  return {
    computed_at: new Date().toISOString(),
    active_kr_count: krs.length,
    top3,
    pause_candidates,
    all_ranked: withReason,
  };
}
