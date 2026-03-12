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

    if (parseInt(s.queued) > 3) {
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
    } else {
      observations.push({
        signal: 'kr_status_snapshot',
        value: [],
        context: '当前无活跃目标，等待规划',
        importance: 3
      });
    }
  } catch (err) {
    console.error('[perception] kr progress error:', err.message);
  }

  // 3. 距上次与 Alex 任意渠道联系时长（chat 或 feishu，取最近值）
  try {
    const { rows } = await pool.query(
      "SELECT key, value_json FROM working_memory WHERE key IN ('last_alex_chat_at', 'last_feishu_at')"
    );
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.value_json]));
    const timestamps = [byKey.last_alex_chat_at, byKey.last_feishu_at]
      .filter(Boolean)
      .map(v => new Date(v).getTime())
      .filter(t => !isNaN(t));
    if (timestamps.length > 0) {
      const lastContactMs = Math.max(...timestamps);
      const hoursSince = (Date.now() - lastContactMs) / (1000 * 3600);
      observations.push({
        signal: 'hours_since_alex_contact',
        value: Math.round(hoursSince * 10) / 10,
        context: hoursSince < 1
          ? `Alex ${Math.round(hoursSince * 60)} 分钟前刚来过`
          : hoursSince < 24
          ? `Alex 今天来过，距上次联系 ${Math.round(hoursSince)} 小时`
          : `距 Alex 上次联系（任意渠道）已过 ${Math.round(hoursSince)} 小时`
      });
    } else {
      observations.push({
        signal: 'hours_since_alex_contact',
        value: 999,
        context: '尚无 Alex 联系记录'
      });
    }
  } catch (err) {
    console.error('[perception] alex contact time error:', err.message);
  }

  // 4. 系统空闲信号（Break 1 修复：没任务跑时也要产生感知）
  try {
    const { rows: taskRows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
        COUNT(*) FILTER (WHERE status = 'queued') AS queued,
        COUNT(*) FILTER (WHERE status = 'completed' AND updated_at > NOW() - INTERVAL '24 hours') AS completed_24h
      FROM tasks
    `);
    const t = taskRows[0] || {};
    if (parseInt(t.in_progress || 0) === 0 && parseInt(t.queued || 0) === 0) {
      observations.push({
        signal: 'system_idle',
        value: true,
        context: `系统空闲：无进行中任务，无排队任务（过去24h完成 ${t.completed_24h || 0} 个）`
      });
    }
  } catch (err) {
    console.error('[perception] system idle check error:', err.message);
  }

  // 5. 用户在场信号（两档：实时在场 vs 今天来过）
  try {
    const { rows } = await pool.query(
      "SELECT key, value_json FROM working_memory WHERE key IN ('user_last_seen', 'last_alex_chat_at')"
    );
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.value_json]));
    const lastSeen = byKey.user_last_seen;
    const lastChat = byKey.last_alex_chat_at;

    if (lastSeen) {
      const minutesSince = (Date.now() - new Date(lastSeen).getTime()) / (1000 * 60);
      if (minutesSince < 5) {
        observations.push({
          signal: 'user_online',
          value: true,
          context: `Alex 正在 dashboard（${Math.round(minutesSince)} 分钟前活跃）`
        });
      }
    }

    // 今天来过（通过 chat 渠道，5分钟以上但 24小时以内）
    if (lastChat) {
      const minutesSinceChat = (Date.now() - new Date(lastChat).getTime()) / (1000 * 60);
      if (minutesSinceChat >= 5 && minutesSinceChat < 1440) {
        observations.push({
          signal: 'user_visited_today',
          value: true,
          context: `Alex 今天来过，${Math.round(minutesSinceChat)} 分钟前在对话中说过话`
        });
      }
    }
  } catch (err) {
    console.error('[perception] user presence error:', err.message);
  }

  // 6. 未消化知识信号（反刍回路感知）
  try {
    const { rows: undigested } = await pool.query(
      'SELECT COUNT(*) AS cnt FROM learnings WHERE digested = false'
    );
    const undigestedCount = parseInt(undigested[0]?.cnt || 0);
    if (undigestedCount > 0) {
      observations.push({
        signal: 'undigested_knowledge',
        value: undigestedCount,
        context: `有 ${undigestedCount} 条未消化的知识等待反刍`
      });
    }
  } catch (err) {
    console.error('[perception] undigested knowledge check error:', err.message);
  }

  // 7. 连续失败模式检测
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

  // 8. 任务里程碑信号（欲望多样性：不只报警，也庆祝）
  try {
    const { rows: milestoneRows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) AS total
      FROM tasks
      WHERE updated_at > NOW() - INTERVAL '7 days'
    `);
    const ms = milestoneRows[0] || {};
    const completed = parseInt(ms.completed || 0);
    const total = parseInt(ms.total || 0);
    if (total > 0) {
      const completionRate = completed / total;
      if (completionRate >= 0.8 && completed >= 5) {
        observations.push({
          signal: 'task_milestone',
          value: { completed, total, rate: completionRate },
          context: `任务里程碑：过去 7 天完成率 ${(completionRate * 100).toFixed(0)}%（${completed}/${total}）`
        });
      }
    }
  } catch (err) {
    console.error('[perception] task milestone error:', err.message);
  }

  // 9. 今日完成任务数（正向信号）
  try {
    const { rows: todayRows } = await pool.query(`
      SELECT COUNT(*) as cnt FROM tasks
      WHERE status = 'completed'
      AND updated_at >= CURRENT_DATE
    `);
    const cnt = parseInt(todayRows[0]?.cnt || 0);
    if (cnt > 0) {
      observations.push({
        signal: 'task_completed_today',
        value: cnt,
        context: `今日已完成 ${cnt} 个任务，进展顺利`,
        importance: 5
      });
    }
  } catch (err) {
    console.error('[perception] task_completed_today error:', err.message);
  }

  // 10. 时间感知问候（每次 tick 都产生）
  const hour = new Date().getHours();
  let greetingContext;
  let greetingImportance;
  if (hour >= 6 && hour <= 11) {
    greetingContext = '早晨好，开始新的一天';
    greetingImportance = 3;
  } else if (hour >= 12 && hour <= 17) {
    greetingContext = '下午进行中，持续推进';
    greetingImportance = 2;
  } else if (hour >= 18 && hour <= 23) {
    greetingContext = '傍晚了，回顾今日进度';
    greetingImportance = 3;
  } else {
    greetingContext = '深夜运行中，系统正常';
    greetingImportance = 2;
  }
  observations.push({
    signal: 'time_aware_greeting',
    value: hour,
    context: greetingContext,
    importance: greetingImportance
  });

  // 11. 知识盲点信号（Cecelia 遇到不理解的技术概念）
  // 注意：仅统计技术性知识盲点，过滤日常情感表达（感觉/担心/未来等）
  try {
    const { rows: gapRows } = await pool.query(`
      SELECT COUNT(*) AS cnt FROM memory_stream
      WHERE source_type = 'orchestrator_chat'
        AND created_at > NOW() - INTERVAL '48 hours'
        AND (content LIKE '%不确定%' OR content LIKE '%不清楚%'
             OR content LIKE '%不知道%' OR content LIKE '%不太明白%')
        AND content NOT LIKE '%感觉%'
        AND content NOT LIKE '%担心%'
        AND content NOT LIKE '%担忧%'
        AND content NOT LIKE '%未来%'
        AND content NOT LIKE '%将来%'
        AND content NOT LIKE '%情感%'
        AND content NOT LIKE '%生活%'
        AND content NOT LIKE '%朋友%'
        AND content NOT LIKE '%开心%'
        AND content NOT LIKE '%难过%'
        AND content NOT LIKE '%喜欢%'
    `);
    const gapCount = parseInt(gapRows[0]?.cnt || 0);
    if (gapCount > 0) {
      observations.push({
        signal: 'learning_gap_signal',
        value: gapCount,
        context: `发现 ${gapCount} 个未填补的知识盲点（近 48h 对话中遇到不理解的内容）`,
        importance: Math.min(4 + gapCount, 7),
      });
    }
  } catch (err) {
    console.error('[perception] learning_gap error:', err.message);
  }

  // 12. 对话质量信号（深度讨论 vs 纯指令）
  try {
    const { rows: convRows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE length(content) > 200) AS deep_count,
        COUNT(*) AS total_count
      FROM memory_stream
      WHERE source_type IN ('orchestrator_chat', 'feishu_chat')
        AND created_at > NOW() - INTERVAL '24 hours'
    `);
    const total = parseInt(convRows[0]?.total_count || 0);
    const deep = parseInt(convRows[0]?.deep_count || 0);
    if (total > 0) {
      const deepRate = deep / total;
      observations.push({
        signal: 'conversation_quality',
        value: { deep_count: deep, total_count: total, deep_rate: deepRate },
        context: deepRate >= 0.3
          ? `近 24h 对话质量良好：${deep}/${total} 条为深度讨论（${(deepRate * 100).toFixed(0)}%）`
          : `近 24h 对话偏指令式：${deep}/${total} 条为深度讨论（${(deepRate * 100).toFixed(0)}%）`,
        importance: deepRate >= 0.3 ? 6 : 3,
      });
    }
  } catch (err) {
    console.error('[perception] conversation_quality error:', err.message);
  }

  // 13. 好奇心积累信号（环2：自主学习驱动）
  try {
    const curiosityResult = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = 'curiosity_topics' LIMIT 1`
    );
    const topics = curiosityResult.rows[0]?.value_json;
    if (Array.isArray(topics) && topics.length > 0) {
      const topicSummary = topics.map(t => t.topic || '').filter(Boolean).join('、').slice(0, 100);
      observations.push({
        signal: 'curiosity_accumulated',
        value: topics.length,
        context: `发现 ${topics.length} 个知识盲点待探索：${topicSummary}`,
        importance: Math.min(5 + topics.length, 8),
      });
    }
  } catch (err) {
    console.error('[perception] curiosity check error:', err.message);
  }

  // 14. 好奇心饥渴信号（距上次自主探索超过 48h）
  try {
    const { rows: researchRows } = await pool.query(`
      SELECT MAX(created_at) AS last_research
      FROM tasks
      WHERE task_type = 'research'
        AND trigger_source IN ('curiosity', 'desire_system')
    `);
    const lastResearch = researchRows[0]?.last_research;
    const hoursSince = lastResearch
      ? (Date.now() - new Date(lastResearch).getTime()) / (1000 * 3600)
      : 999;
    if (hoursSince >= 48) {
      observations.push({
        signal: 'intellectual_idle',
        value: Math.round(hoursSince),
        context: hoursSince >= 999
          ? '从未有过自主探索任务，好奇心还没有被激活'
          : `距上次自主探索已过 ${Math.round(hoursSince)} 小时，好奇心饥渴`,
        importance: Math.min(5 + Math.floor((hoursSince - 48) / 24), 8),
      });
    }
  } catch (err) {
    console.error('[perception] intellectual_idle error:', err.message);
  }

  return observations;
}
