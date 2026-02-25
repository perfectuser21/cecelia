/**
 * Layer 1: 感知层（Perception）
 *
 * 每次 tick 后运行，收集系统信号，输出结构化观察列表。
 * 信号来源：任务成功/失败趋势、KR 进度、距上次 Feishu 时长、重复失败模式。
 */

/**
 * 收集感知信号，输出观察列表
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{signal: string, value: any, context: string}>>}
 */
export async function runPerception(pool) {
  const observations = [];

  // 1. 任务成功/失败趋势（最近 24h）
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
        COUNT(*) FILTER (WHERE status = 'queued')    AS queued,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress
      FROM tasks
      WHERE updated_at > NOW() - INTERVAL '24 hours'
    `);
    const s = rows[0];
    const total = parseInt(s.completed) + parseInt(s.failed);
    if (total > 0) {
      const failRate = parseInt(s.failed) / total;
      observations.push({
        signal: 'task_fail_rate_24h',
        value: failRate,
        context: `过去 24h：${s.completed} 完成，${s.failed} 失败，${s.queued} 排队，${s.in_progress} 进行中`
      });
    }

    if (parseInt(s.queued) > 10) {
      observations.push({
        signal: 'queue_buildup',
        value: parseInt(s.queued),
        context: `队列积压：${s.queued} 个任务等待派发`
      });
    }
  } catch (err) {
    console.error('[perception] task stats error:', err.message);
  }

  // 2. KR 进度（活跃目标）
  try {
    const { rows: goals } = await pool.query(`
      SELECT title, progress, status, priority
      FROM goals
      WHERE status = 'in_progress'
      ORDER BY priority ASC, updated_at DESC
      LIMIT 5
    `);
    if (goals.length > 0) {
      const stalled = goals.filter(g => parseInt(g.progress) < 10);
      if (stalled.length > 0) {
        observations.push({
          signal: 'kr_stalled',
          value: stalled.map(g => g.title),
          context: `KR 进度停滞（< 10%）：${stalled.map(g => `${g.title}(${g.progress}%)`).join('、')}`
        });
      }
      observations.push({
        signal: 'kr_status_snapshot',
        value: goals.map(g => ({ title: g.title, progress: parseInt(g.progress) })),
        context: `活跃 KR 概览：${goals.map(g => `${g.title} ${g.progress}%`).join('、')}`
      });
    }
  } catch (err) {
    console.error('[perception] kr progress error:', err.message);
  }

  // 3. 距上次与 Alex 交互时长
  try {
    const { rows } = await pool.query(
      "SELECT value_json FROM working_memory WHERE key = 'last_feishu_at'"
    );
    const lastFeishu = rows[0]?.value_json;
    if (lastFeishu) {
      const hoursSince = (Date.now() - new Date(lastFeishu).getTime()) / (1000 * 3600);
      observations.push({
        signal: 'hours_since_feishu',
        value: Math.round(hoursSince * 10) / 10,
        context: `距上次向 Alex 汇报已过 ${Math.round(hoursSince)} 小时`
      });
    } else {
      observations.push({
        signal: 'hours_since_feishu',
        value: 999,
        context: '从未主动向 Alex 汇报（没有 last_feishu_at 记录）'
      });
    }
  } catch (err) {
    console.error('[perception] feishu time error:', err.message);
  }

  // 4. 连续失败模式检测
  try {
    const { rows: failures } = await pool.query(`
      SELECT task_type, COUNT(*) AS cnt
      FROM tasks
      WHERE status = 'failed'
        AND updated_at > NOW() - INTERVAL '6 hours'
      GROUP BY task_type
      HAVING COUNT(*) >= 3
      ORDER BY cnt DESC
    `);
    if (failures.length > 0) {
      observations.push({
        signal: 'repeated_failures',
        value: failures.map(f => ({ type: f.task_type, count: parseInt(f.cnt) })),
        context: `发现重复失败模式：${failures.map(f => `${f.task_type}(${f.cnt}次)`).join('、')}`
      });
    }
  } catch (err) {
    console.error('[perception] failure pattern error:', err.message);
  }

  return observations;
}
