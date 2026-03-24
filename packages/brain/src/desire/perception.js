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
  const collectors = [
    collectTaskStats,
    collectKrProgress,
    collectAlexContactTime,
    collectSystemIdle,
    collectUserPresence,
    collectUndigestedKnowledge,
    collectRepeatedFailures,
    collectTaskMilestone,
    collectCompletedToday,
    collectLearningGap,
    collectConversationQuality,
    collectCuriosityAccumulated,
    collectCuriosityHunger,
  ];
  const results = await Promise.all(collectors.map(fn => fn(pool)));
  return [...results.flat(), ...collectTimeGreeting()];
}

// ─────────────────────────────────────────────────────────────────────────────
// 子采集函数（每个函数返回 observation[]）
// ─────────────────────────────────────────────────────────────────────────────

async function collectTaskStats(pool) {
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
    const obs = [];
    const total = parseInt(s.completed) + parseInt(s.failed);
    if (total > 0) {
      const failRate = parseInt(s.failed) / total;
      obs.push({
        signal: 'task_fail_rate_24h',
        value: failRate,
        context: `过去 24h：${s.completed} 完成，${s.failed} 失败，${s.queued} 排队，${s.in_progress} 进行中`
      });
    }
    if (parseInt(s.queued) > 3) {
      obs.push({
        signal: 'queue_buildup',
        value: parseInt(s.queued),
        context: `队列积压：${s.queued} 个任务等待派发`
      });
    }
    return obs;
  } catch (err) {
    console.error('[perception] task stats error:', err.message);
    return [];
  }
}

async function collectKrProgress(pool) {
  try {
    // 新 OKR 表：key_results 有 progress/priority/status 字段（UUID 与旧 goals 相同）
    const { rows: goals } = await pool.query(`
      SELECT title, progress, status, priority
      FROM key_results
      WHERE status IN ('active', 'in_progress')
      ORDER BY priority ASC, updated_at DESC
      LIMIT 5
    `);
    const obs = [];
    if (goals.length > 0) {
      const stalled = goals.filter(g => parseInt(g.progress) < 10);
      if (stalled.length > 0) {
        obs.push({
          signal: 'kr_stalled',
          value: stalled.map(g => g.title),
          context: `KR 进度停滞（< 10%）：${stalled.map(g => `${g.title}(${g.progress}%)`).join('、')}`
        });
      }
      obs.push({
        signal: 'kr_status_snapshot',
        value: goals.map(g => ({ title: g.title, progress: parseInt(g.progress) })),
        context: `活跃 KR 概览：${goals.map(g => `${g.title} ${g.progress}%`).join('、')}`
      });
    } else {
      obs.push({
        signal: 'kr_status_snapshot',
        value: [],
        context: '当前无活跃目标，等待规划',
        importance: 3
      });
    }
    return obs;
  } catch (err) {
    console.error('[perception] kr progress error:', err.message);
    return [];
  }
}

async function collectAlexContactTime(pool) {
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
      return [{
        signal: 'hours_since_alex_contact',
        value: Math.round(hoursSince * 10) / 10,
        context: hoursSince < 1
          ? `Alex ${Math.round(hoursSince * 60)} 分钟前刚来过`
          : hoursSince < 24
          ? `Alex 今天来过，距上次联系 ${Math.round(hoursSince)} 小时`
          : `距 Alex 上次联系（任意渠道）已过 ${Math.round(hoursSince)} 小时`
      }];
    }
    return [{
      signal: 'hours_since_alex_contact',
      value: 999,
      context: '尚无 Alex 联系记录'
    }];
  } catch (err) {
    console.error('[perception] alex contact time error:', err.message);
    return [];
  }
}

async function collectSystemIdle(pool) {
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
      return [{
        signal: 'system_idle',
        value: true,
        context: `系统空闲：无进行中任务，无排队任务（过去24h完成 ${t.completed_24h || 0} 个）`
      }];
    }
    return [];
  } catch (err) {
    console.error('[perception] system idle check error:', err.message);
    return [];
  }
}

async function collectUserPresence(pool) {
  try {
    const { rows } = await pool.query(
      "SELECT key, value_json FROM working_memory WHERE key IN ('user_last_seen', 'last_alex_chat_at')"
    );
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.value_json]));
    const obs = [];
    if (byKey.user_last_seen) {
      const minutesSince = (Date.now() - new Date(byKey.user_last_seen).getTime()) / (1000 * 60);
      if (minutesSince < 5) {
        obs.push({
          signal: 'user_online',
          value: true,
          context: `Alex 正在 dashboard（${Math.round(minutesSince)} 分钟前活跃）`
        });
      }
    }
    if (byKey.last_alex_chat_at) {
      const minutesSinceChat = (Date.now() - new Date(byKey.last_alex_chat_at).getTime()) / (1000 * 60);
      if (minutesSinceChat >= 5 && minutesSinceChat < 1440) {
        obs.push({
          signal: 'user_visited_today',
          value: true,
          context: `Alex 今天来过，${Math.round(minutesSinceChat)} 分钟前在对话中说过话`
        });
      }
    }
    return obs;
  } catch (err) {
    console.error('[perception] user presence error:', err.message);
    return [];
  }
}

async function collectUndigestedKnowledge(pool) {
  try {
    const { rows } = await pool.query(
      'SELECT COUNT(*) AS cnt FROM learnings WHERE digested = false'
    );
    const cnt = parseInt(rows[0]?.cnt || 0);
    if (cnt > 0) {
      return [{
        signal: 'undigested_knowledge',
        value: cnt,
        context: `有 ${cnt} 条未消化的知识等待反刍`
      }];
    }
    return [];
  } catch (err) {
    console.error('[perception] undigested knowledge check error:', err.message);
    return [];
  }
}

async function collectRepeatedFailures(pool) {
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
      return [{
        signal: 'repeated_failures',
        value: failures.map(f => ({ type: f.task_type, count: parseInt(f.cnt) })),
        context: `发现重复失败模式：${failures.map(f => `${f.task_type}(${f.cnt}次)`).join('、')}`
      }];
    }
    return [];
  } catch (err) {
    console.error('[perception] failure pattern error:', err.message);
    return [];
  }
}

async function collectTaskMilestone(pool) {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) AS total
      FROM tasks
      WHERE updated_at > NOW() - INTERVAL '7 days'
    `);
    const ms = rows[0] || {};
    const completed = parseInt(ms.completed || 0);
    const total = parseInt(ms.total || 0);
    if (total > 0) {
      const completionRate = completed / total;
      if (completionRate >= 0.8 && completed >= 5) {
        return [{
          signal: 'task_milestone',
          value: { completed, total, rate: completionRate },
          context: `任务里程碑：过去 7 天完成率 ${(completionRate * 100).toFixed(0)}%（${completed}/${total}）`
        }];
      }
    }
    return [];
  } catch (err) {
    console.error('[perception] task milestone error:', err.message);
    return [];
  }
}

async function collectCompletedToday(pool) {
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*) as cnt FROM tasks
      WHERE status = 'completed'
      AND updated_at >= CURRENT_DATE
    `);
    const cnt = parseInt(rows[0]?.cnt || 0);
    if (cnt > 0) {
      return [{
        signal: 'task_completed_today',
        value: cnt,
        context: `今日已完成 ${cnt} 个任务，进展顺利`,
        importance: 5
      }];
    }
    return [];
  } catch (err) {
    console.error('[perception] task_completed_today error:', err.message);
    return [];
  }
}

function collectTimeGreeting() {
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
  return [{
    signal: 'time_aware_greeting',
    value: hour,
    context: greetingContext,
    importance: greetingImportance
  }];
}

async function collectLearningGap(pool) {
  try {
    const { rows } = await pool.query(`
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
    const gapCount = parseInt(rows[0]?.cnt || 0);
    if (gapCount > 0) {
      return [{
        signal: 'learning_gap_signal',
        value: gapCount,
        context: `发现 ${gapCount} 个未填补的知识盲点（近 48h 对话中遇到不理解的内容）`,
        importance: Math.min(4 + gapCount, 7),
      }];
    }
    return [];
  } catch (err) {
    console.error('[perception] learning_gap error:', err.message);
    return [];
  }
}

async function collectConversationQuality(pool) {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE length(content) > 200) AS deep_count,
        COUNT(*) AS total_count
      FROM memory_stream
      WHERE source_type IN ('orchestrator_chat', 'feishu_chat')
        AND created_at > NOW() - INTERVAL '24 hours'
    `);
    const total = parseInt(rows[0]?.total_count || 0);
    const deep = parseInt(rows[0]?.deep_count || 0);
    if (total > 0) {
      const deepRate = deep / total;
      return [{
        signal: 'conversation_quality',
        value: { deep_count: deep, total_count: total, deep_rate: deepRate },
        context: deepRate >= 0.3
          ? `近 24h 对话质量良好：${deep}/${total} 条为深度讨论（${(deepRate * 100).toFixed(0)}%）`
          : `近 24h 对话偏指令式：${deep}/${total} 条为深度讨论（${(deepRate * 100).toFixed(0)}%）`,
        importance: deepRate >= 0.3 ? 6 : 3,
      }];
    }
    return [];
  } catch (err) {
    console.error('[perception] conversation_quality error:', err.message);
    return [];
  }
}

async function collectCuriosityAccumulated(pool) {
  try {
    const result = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = 'curiosity_topics' LIMIT 1`
    );
    const topics = result.rows[0]?.value_json;
    if (Array.isArray(topics) && topics.length > 0) {
      const topicSummary = topics.map(t => t.topic || '').filter(Boolean).join('、').slice(0, 100);
      return [{
        signal: 'curiosity_accumulated',
        value: topics.length,
        context: `发现 ${topics.length} 个知识盲点待探索：${topicSummary}`,
        importance: Math.min(5 + topics.length, 8),
      }];
    }
    return [];
  } catch (err) {
    console.error('[perception] curiosity check error:', err.message);
    return [];
  }
}

async function collectCuriosityHunger(pool) {
  try {
    const { rows } = await pool.query(`
      SELECT MAX(created_at) AS last_research
      FROM tasks
      WHERE task_type = 'research'
        AND trigger_source IN ('curiosity', 'desire_system')
    `);
    const lastResearch = rows[0]?.last_research;
    const hoursSince = lastResearch
      ? (Date.now() - new Date(lastResearch).getTime()) / (1000 * 3600)
      : 999;
    if (hoursSince >= 48) {
      return [{
        signal: 'intellectual_idle',
        value: Math.round(hoursSince),
        context: hoursSince >= 999
          ? '从未有过自主探索任务，好奇心还没有被激活'
          : `距上次自主探索已过 ${Math.round(hoursSince)} 小时，好奇心饥渴`,
        importance: Math.min(5 + Math.floor((hoursSince - 48) / 24), 8),
      }];
    }
    return [];
  } catch (err) {
    console.error('[perception] intellectual_idle error:', err.message);
    return [];
  }
}
