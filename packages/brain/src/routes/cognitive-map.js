/**
 * Cognitive Map 路由 — 大脑认知地图 API
 *
 * GET /api/brain/cognitive-map
 *   返回：15 个子系统状态 + 21 条连接关系
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// 30 分钟内有活动 = active，今天有但不活跃 = idle，今天无数据 = dormant
function judgeStatus(lastActiveAt, todayCount) {
  if (!todayCount || todayCount === 0) return 'dormant';
  if (!lastActiveAt) return todayCount > 0 ? 'idle' : 'dormant';
  const diff = Date.now() - new Date(lastActiveAt).getTime();
  return diff < 30 * 60 * 1000 ? 'active' : 'idle';
}

// 连接状态：两端都 active → active，有一端 dormant → deployed_no_data
function judgeConnectionStatus(fromStatus, toStatus) {
  if (fromStatus === 'active' && toStatus === 'active') return 'active';
  if (fromStatus === 'dormant' || toStatus === 'dormant') return 'deployed_no_data';
  return 'active';
}

// 21 条静态连接定义
const CONNECTIONS = [
  { from: 'tick', to: 'thalamus', label: 'TICK 事件' },
  { from: 'tick', to: 'planner', label: '调度触发' },
  { from: 'planner', to: 'executor', label: '任务派发' },
  { from: 'thalamus', to: 'cortex', label: 'L1→L2 升级' },
  { from: 'thalamus', to: 'emotion', label: '情绪感知' },
  { from: 'cortex', to: 'memory', label: '深度记忆写入' },
  { from: 'cortex', to: 'learning', label: '学习提取' },
  { from: 'emotion', to: 'desire', label: '情绪驱动欲望' },
  { from: 'desire', to: 'suggestion', label: '欲望→建议' },
  { from: 'suggestion', to: 'planner', label: '建议→规划' },
  { from: 'memory', to: 'rumination', label: '记忆→反刍' },
  { from: 'rumination', to: 'learning', label: '反刍→学习' },
  { from: 'learning', to: 'self_model', label: '学习→自我模型' },
  { from: 'self_model', to: 'cognitive', label: '模型→认知核心' },
  { from: 'cognitive', to: 'emotion', label: '认知→情绪反馈' },
  { from: 'dialog', to: 'thalamus', label: '对话→丘脑' },
  { from: 'dialog', to: 'memory', label: '对话→记忆' },
  { from: 'executor', to: 'immune', label: '执行→免疫检查' },
  { from: 'immune', to: 'planner', label: '隔离→重规划' },
  { from: 'tick', to: 'cognitive', label: 'TICK→认知' },
  { from: 'desire', to: 'executor', label: '欲望→执行' },
];

router.get('/', async (_req, res) => {
  try {
    const [
      tickResult,
      plannerResult,
      executorResult,
      thalamusResult,
      cortexResult,
      emotionWmResult,
      emotionMsResult,
      desireResult,
      memoryResult,
      ruminationResult,
      learningResult,
      selfModelResult,
      suggestionResult,
      immuneResult,
      dialogResult,
    ] = await Promise.all([
      // tick: working_memory key='tick_last'
      pool.query("SELECT updated_at FROM working_memory WHERE key = 'tick_last'"),

      // planner: cecelia_events today where source='planner' or 'tick'
      pool.query(`
        SELECT COUNT(*) AS cnt,
               MAX(created_at) AS last_at
        FROM cecelia_events
        WHERE source IN ('planner', 'tick')
          AND created_at > CURRENT_DATE
      `),

      // executor: tasks in_progress
      pool.query(`
        SELECT COUNT(*) AS cnt,
               MAX(updated_at) AS last_at
        FROM tasks
        WHERE status = 'in_progress'
      `),

      // thalamus: cecelia_events source='thalamus' today (+ l0/l1/l2 分层)
      pool.query(`
        SELECT COUNT(*) AS cnt,
               MAX(created_at) AS last_at,
               COUNT(*) FILTER (WHERE event_type LIKE '%l0%' OR event_type = 'tick_processed') AS l0_count,
               COUNT(*) FILTER (WHERE event_type LIKE '%l1%' OR event_type = 'thalamus_routed') AS l1_count,
               COUNT(*) FILTER (WHERE event_type LIKE '%l2%' OR event_type = 'cortex_invoked') AS l2_count
        FROM cecelia_events
        WHERE source = 'thalamus'
          AND created_at > CURRENT_DATE
      `),

      // cortex: cecelia_events source='cortex' today
      pool.query(`
        SELECT COUNT(*) AS cnt,
               MAX(created_at) AS last_at
        FROM cecelia_events
        WHERE source = 'cortex'
          AND created_at > CURRENT_DATE
      `),

      // emotion: working_memory emotion_state
      pool.query("SELECT value_json, updated_at FROM working_memory WHERE key = 'emotion_state'"),

      // emotion: memory_stream today with emotion content
      pool.query(`
        SELECT COUNT(*) AS cnt
        FROM memory_stream
        WHERE source_type = 'emotion'
          AND created_at > CURRENT_DATE
      `),

      // desire: desires today + pending
      pool.query(`
        SELECT COUNT(*) AS cnt,
               COUNT(*) FILTER (WHERE status = 'pending') AS pending,
               MAX(created_at) AS last_at
        FROM desires
        WHERE created_at > CURRENT_DATE
      `),

      // memory: memory_stream today
      pool.query(`
        SELECT COUNT(*) AS cnt,
               MAX(created_at) AS last_at
        FROM memory_stream
        WHERE created_at > CURRENT_DATE
      `),

      // rumination: learnings undigested + today count
      pool.query(`
        SELECT COUNT(*) FILTER (WHERE digested = false) AS undigested,
               COUNT(*) FILTER (WHERE created_at > CURRENT_DATE) AS today_cnt,
               MAX(created_at) AS last_at
        FROM learnings
      `),

      // learning: learnings today
      pool.query(`
        SELECT COUNT(*) AS cnt,
               MAX(created_at) AS last_at
        FROM learnings
        WHERE created_at > CURRENT_DATE
      `),

      // self_model: memory_stream self_model type
      pool.query(`
        SELECT COUNT(*) AS cnt,
               MAX(created_at) AS last_at
        FROM memory_stream
        WHERE source_type = 'self_model'
          AND created_at > CURRENT_DATE
      `),

      // suggestion: suggestions pending
      pool.query(`
        SELECT COUNT(*) AS cnt,
               COUNT(*) FILTER (WHERE status = 'pending') AS pending,
               MAX(created_at) AS last_at
        FROM suggestions
        WHERE created_at > CURRENT_DATE
      `),

      // immune: tasks quarantined
      pool.query(`
        SELECT COUNT(*) AS cnt,
               MAX(updated_at) AS last_at
        FROM tasks
        WHERE status = 'quarantined'
      `),

      // dialog: memory_stream orchestrator_chat today
      pool.query(`
        SELECT COUNT(*) AS cnt,
               MAX(created_at) AS last_at
        FROM memory_stream
        WHERE source_type = 'orchestrator_chat'
          AND created_at > CURRENT_DATE
      `),
    ]);

    const r = (result) => result.rows[0] || {};

    const subsystems = [
      {
        id: 'tick', name: '心脏 Tick', group: 'core',
        status: judgeStatus(r(tickResult).updated_at, 1),
        metrics: {
          today_count: parseInt(r(plannerResult).cnt || 0),
          last_active_at: r(tickResult).updated_at || null,
        },
      },
      {
        id: 'planner', name: '调度规划', group: 'core',
        status: judgeStatus(r(plannerResult).last_at, parseInt(r(plannerResult).cnt || 0)),
        metrics: {
          today_count: parseInt(r(plannerResult).cnt || 0),
          last_active_at: r(plannerResult).last_at || null,
        },
      },
      {
        id: 'executor', name: '执行器', group: 'core',
        status: judgeStatus(r(executorResult).last_at, parseInt(r(executorResult).cnt || 0)),
        metrics: {
          today_count: parseInt(r(executorResult).cnt || 0),
          last_active_at: r(executorResult).last_at || null,
        },
      },
      {
        id: 'thalamus', name: '丘脑 L1', group: 'cognition',
        status: judgeStatus(r(thalamusResult).last_at, parseInt(r(thalamusResult).cnt || 0)),
        metrics: {
          today_count: parseInt(r(thalamusResult).cnt || 0),
          last_active_at: r(thalamusResult).last_at || null,
          extra: {
            l0_count: parseInt(r(thalamusResult).l0_count || 0),
            l1_count: parseInt(r(thalamusResult).l1_count || 0),
            l2_count: parseInt(r(thalamusResult).l2_count || 0),
          },
        },
      },
      {
        id: 'cortex', name: '皮层 L2', group: 'cognition',
        status: judgeStatus(r(cortexResult).last_at, parseInt(r(cortexResult).cnt || 0)),
        metrics: {
          today_count: parseInt(r(cortexResult).cnt || 0),
          last_active_at: r(cortexResult).last_at || null,
        },
      },
      {
        id: 'cognitive', name: '认知核心', group: 'cognition',
        status: judgeStatus(r(tickResult).updated_at, 1),
        metrics: {
          today_count: null,
          last_active_at: r(tickResult).updated_at || null,
        },
      },
      {
        id: 'emotion', name: '情绪层', group: 'consciousness',
        status: judgeStatus(r(emotionWmResult).updated_at, parseInt(r(emotionMsResult).cnt || 0) + 1),
        metrics: {
          today_count: parseInt(r(emotionMsResult).cnt || 0),
          last_active_at: r(emotionWmResult).updated_at || null,
          extra: {
            current_emotion: (() => {
              try { return JSON.parse(r(emotionWmResult).value_json || '{}'); } catch { return {}; }
            })(),
          },
        },
      },
      {
        id: 'desire', name: '欲望系统', group: 'consciousness',
        status: judgeStatus(r(desireResult).last_at, parseInt(r(desireResult).cnt || 0)),
        metrics: {
          today_count: parseInt(r(desireResult).cnt || 0),
          last_active_at: r(desireResult).last_at || null,
          extra: { pending: parseInt(r(desireResult).pending || 0) },
        },
      },
      {
        id: 'self_model', name: '自我模型', group: 'consciousness',
        status: judgeStatus(r(selfModelResult).last_at, parseInt(r(selfModelResult).cnt || 0)),
        metrics: {
          today_count: parseInt(r(selfModelResult).cnt || 0),
          last_active_at: r(selfModelResult).last_at || null,
        },
      },
      {
        id: 'memory', name: '记忆系统', group: 'memory',
        status: judgeStatus(r(memoryResult).last_at, parseInt(r(memoryResult).cnt || 0)),
        metrics: {
          today_count: parseInt(r(memoryResult).cnt || 0),
          last_active_at: r(memoryResult).last_at || null,
        },
      },
      {
        id: 'learning', name: '学习', group: 'memory',
        status: judgeStatus(r(learningResult).last_at, parseInt(r(learningResult).cnt || 0)),
        metrics: {
          today_count: parseInt(r(learningResult).cnt || 0),
          last_active_at: r(learningResult).last_at || null,
        },
      },
      {
        id: 'rumination', name: '反刍', group: 'memory',
        status: judgeStatus(r(ruminationResult).last_at, parseInt(r(ruminationResult).today_cnt || 0)),
        metrics: {
          today_count: parseInt(r(ruminationResult).today_cnt || 0),
          last_active_at: r(ruminationResult).last_at || null,
          extra: { undigested: parseInt(r(ruminationResult).undigested || 0) },
        },
      },
      {
        id: 'suggestion', name: '建议系统', group: 'interface',
        status: judgeStatus(r(suggestionResult).last_at, parseInt(r(suggestionResult).cnt || 0)),
        metrics: {
          today_count: parseInt(r(suggestionResult).cnt || 0),
          last_active_at: r(suggestionResult).last_at || null,
          extra: { pending: parseInt(r(suggestionResult).pending || 0) },
        },
      },
      {
        id: 'immune', name: '免疫系统', group: 'interface',
        status: judgeStatus(r(immuneResult).last_at, parseInt(r(immuneResult).cnt || 0)),
        metrics: {
          today_count: parseInt(r(immuneResult).cnt || 0),
          last_active_at: r(immuneResult).last_at || null,
        },
      },
      {
        id: 'dialog', name: '对话系统', group: 'interface',
        status: judgeStatus(r(dialogResult).last_at, parseInt(r(dialogResult).cnt || 0)),
        metrics: {
          today_count: parseInt(r(dialogResult).cnt || 0),
          last_active_at: r(dialogResult).last_at || null,
        },
      },
    ];

    // 基于子系统状态计算连接状态
    const statusMap = {};
    for (const s of subsystems) statusMap[s.id] = s.status;

    const connections = CONNECTIONS.map(c => ({
      ...c,
      status: judgeConnectionStatus(statusMap[c.from], statusMap[c.to]),
    }));

    res.json({
      subsystems,
      connections,
      snapshot_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API] cognitive-map error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
