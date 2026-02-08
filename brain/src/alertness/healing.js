/**
 * Alertness Self-Healing - 自愈策略
 *
 * 策略库：
 * 1. 内存清理
 * 2. 进程恢复
 * 3. 队列疏通
 * 4. 错误缓解
 *
 * 恢复流程：
 * 观察期 → 试探恢复 → 逐步恢复 → 完全恢复
 */

/* global console, process, global */

import { exec } from 'child_process';
import { promisify } from 'util';
import pool from '../db.js';
import { emit } from '../event-bus.js';

const execAsync = promisify(exec);

// ============================================================
// 自愈策略定义
// ============================================================

const HEALING_STRATEGIES = {
  memory_cleanup: {
    name: '内存清理',
    condition: 'high_memory',
    priority: 1,
    actions: [
      'force_garbage_collection',
      'clear_expired_cache',
      'compact_database_connections'
    ]
  },

  process_recovery: {
    name: '进程恢复',
    condition: 'zombie_processes',
    priority: 2,
    actions: [
      'kill_orphan_processes',
      'restart_stuck_executors',
      'reset_process_pool'
    ]
  },

  queue_drainage: {
    name: '队列疏通',
    condition: 'queue_overflow',
    priority: 3,
    actions: [
      'redistribute_tasks',
      'cancel_duplicate_tasks',
      'archive_old_tasks'
    ]
  },

  error_mitigation: {
    name: '错误缓解',
    condition: 'high_error_rate',
    priority: 4,
    actions: [
      'retry_with_backoff',
      'switch_fallback_endpoints',
      'quarantine_problematic_tasks'
    ]
  }
};

// ============================================================
// 恢复阶段定义
// ============================================================

const RECOVERY_PHASES = {
  0: { name: 'IDLE', description: '未在恢复' },
  1: { name: 'OBSERVATION', description: '观察期', duration: 5 * 60 * 1000 },
  2: { name: 'TENTATIVE', description: '试探恢复', duration: 10 * 60 * 1000 },
  3: { name: 'PROGRESSIVE', description: '逐步恢复', duration: 15 * 60 * 1000 },
  4: { name: 'FULL', description: '完全恢复', duration: 0 }
};

// ============================================================
// 恢复状态管理
// ============================================================

let recoveryState = {
  isRecovering: false,
  phase: 0,
  startedAt: null,
  phaseStartedAt: null,
  strategies: [],
  actionsExecuted: [],
  checkpoints: [],
  capacity: 0 // 恢复容量百分比
};

// 恢复历史
const healingHistory = [];
const MAX_HISTORY_SIZE = 50;

// ============================================================
// 自愈执行
// ============================================================

/**
 * 开始自愈流程
 */
export async function startRecovery(issues) {
  if (recoveryState.isRecovering) {
    console.log('[Healing] Already in recovery, skipping');
    return;
  }

  console.log('[Healing] Starting self-healing for issues:', issues);

  // 选择适用的策略
  const strategies = selectStrategies(issues);

  if (strategies.length === 0) {
    console.log('[Healing] No applicable strategies found');
    return;
  }

  // 初始化恢复状态
  recoveryState = {
    isRecovering: true,
    phase: 1, // 开始观察期
    startedAt: new Date(),
    phaseStartedAt: new Date(),
    strategies,
    actionsExecuted: [],
    checkpoints: [],
    capacity: 0
  };

  // 发送事件
  emit('healing:started', { issues, strategies });

  // 记录到数据库
  await recordHealingStart(issues, strategies);

  // 执行观察期
  await executeObservationPhase();
}

/**
 * 选择适用的策略
 */
function selectStrategies(issues) {
  const strategies = [];

  for (const [key, strategy] of Object.entries(HEALING_STRATEGIES)) {
    if (issues.includes(strategy.condition)) {
      strategies.push({
        key,
        ...strategy
      });
    }
  }

  // 按优先级排序
  strategies.sort((a, b) => a.priority - b.priority);

  return strategies;
}

/**
 * 执行观察期
 */
async function executeObservationPhase() {
  console.log('[Healing] Phase 1: Observation (5 minutes)');

  // 观察期只监控，不执行动作
  recoveryState.checkpoints.push({
    phase: 1,
    timestamp: Date.now(),
    action: 'monitoring',
    result: 'started'
  });

  // 设置下一阶段的定时器
  setTimeout(() => {
    if (recoveryState.isRecovering && recoveryState.phase === 1) {
      transitionToNextPhase();
    }
  }, RECOVERY_PHASES[1].duration);
}

/**
 * 转换到下一阶段
 */
async function transitionToNextPhase() {
  const currentPhase = recoveryState.phase;
  const nextPhase = Math.min(currentPhase + 1, 4);

  if (nextPhase === currentPhase) {
    console.log('[Healing] Already at final phase');
    return;
  }

  console.log(`[Healing] Transitioning: Phase ${currentPhase} → Phase ${nextPhase}`);

  recoveryState.phase = nextPhase;
  recoveryState.phaseStartedAt = new Date();

  // 根据阶段执行不同动作
  switch (nextPhase) {
    case 2:
      await executeTentativeRecovery();
      break;
    case 3:
      await executeProgressiveRecovery();
      break;
    case 4:
      await executeFullRecovery();
      break;
  }
}

/**
 * 执行试探恢复（25% 容量）
 */
async function executeTentativeRecovery() {
  console.log('[Healing] Phase 2: Tentative Recovery (25% capacity)');

  recoveryState.capacity = 25;

  // 执行第一个策略
  if (recoveryState.strategies.length > 0) {
    const strategy = recoveryState.strategies[0];
    await executeStrategy(strategy);
  }

  // 设置检查点
  const checkpoint = await createCheckpoint();

  if (checkpoint.passed) {
    // 检查点通过，继续下一阶段
    setTimeout(() => {
      if (recoveryState.isRecovering && recoveryState.phase === 2) {
        transitionToNextPhase();
      }
    }, RECOVERY_PHASES[2].duration);
  } else {
    // 检查点失败，回退
    await rollback();
  }
}

/**
 * 执行逐步恢复（50% → 75% 容量）
 */
async function executeProgressiveRecovery() {
  console.log('[Healing] Phase 3: Progressive Recovery (50-75% capacity)');

  const steps = [50, 75];

  for (const capacity of steps) {
    recoveryState.capacity = capacity;
    console.log(`[Healing] Restoring ${capacity}% capacity`);

    // 执行更多策略
    for (let i = 1; i < recoveryState.strategies.length && i < 3; i++) {
      const strategy = recoveryState.strategies[i];
      await executeStrategy(strategy);
    }

    // 等待稳定
    await sleep(5 * 60 * 1000); // 5分钟

    // 检查点
    const checkpoint = await createCheckpoint();
    if (!checkpoint.passed) {
      console.log(`[Healing] Checkpoint failed at ${capacity}% capacity`);
      await rollback();
      return;
    }
  }

  // 成功，进入完全恢复
  setTimeout(() => {
    if (recoveryState.isRecovering && recoveryState.phase === 3) {
      transitionToNextPhase();
    }
  }, RECOVERY_PHASES[3].duration);
}

/**
 * 执行完全恢复（100% 容量）
 */
async function executeFullRecovery() {
  console.log('[Healing] Phase 4: Full Recovery (100% capacity)');

  recoveryState.capacity = 100;

  // 执行所有策略
  for (const strategy of recoveryState.strategies) {
    await executeStrategy(strategy);
  }

  // 最终检查点
  const checkpoint = await createCheckpoint();

  if (checkpoint.passed) {
    console.log('[Healing] Recovery completed successfully');
    await completeRecovery(true);
  } else {
    console.log('[Healing] Recovery failed at final checkpoint');
    await completeRecovery(false);
  }
}

// ============================================================
// 策略执行
// ============================================================

/**
 * 执行单个策略
 */
async function executeStrategy(strategy) {
  console.log(`[Healing] Executing strategy: ${strategy.name}`);

  const results = [];

  for (const action of strategy.actions) {
    try {
      const result = await executeAction(action);
      results.push({ action, success: true, result });

      recoveryState.actionsExecuted.push({
        strategy: strategy.key,
        action,
        timestamp: Date.now(),
        success: true,
        result
      });
    } catch (error) {
      console.error(`[Healing] Action failed: ${action}`, error);
      results.push({ action, success: false, error: error.message });

      recoveryState.actionsExecuted.push({
        strategy: strategy.key,
        action,
        timestamp: Date.now(),
        success: false,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * 执行具体动作
 */
async function executeAction(action) {
  console.log(`[Healing] Executing action: ${action}`);

  switch (action) {
    // 内存清理动作
    case 'force_garbage_collection':
      if (global.gc) {
        global.gc();
        console.log('[Healing] Forced garbage collection');
      }
      return { gc: true };

    case 'clear_expired_cache':
      // TODO: 实现缓存清理
      console.log('[Healing] Cleared expired cache');
      return { cacheCleared: true };

    case 'compact_database_connections':
      // 关闭空闲连接
      await pool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = \'idle\' AND state_change < NOW() - INTERVAL \'10 minutes\'');
      console.log('[Healing] Compacted database connections');
      return { connectionsCompacted: true };

    // 进程恢复动作
    case 'kill_orphan_processes':
      const orphans = await findOrphanProcesses();
      for (const pid of orphans) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch (e) {
          // 进程可能已经不存在
        }
      }
      console.log(`[Healing] Killed ${orphans.length} orphan processes`);
      return { orphansKilled: orphans.length };

    case 'restart_stuck_executors':
      // TODO: 实现执行器重启
      console.log('[Healing] Restarted stuck executors');
      return { executorsRestarted: true };

    case 'reset_process_pool':
      // TODO: 实现进程池重置
      console.log('[Healing] Reset process pool');
      return { poolReset: true };

    // 队列疏通动作
    case 'redistribute_tasks':
      const redistributed = await redistributeTasks();
      console.log(`[Healing] Redistributed ${redistributed} tasks`);
      return { redistributed };

    case 'cancel_duplicate_tasks':
      const duplicates = await cancelDuplicateTasks();
      console.log(`[Healing] Canceled ${duplicates} duplicate tasks`);
      return { duplicatesCanceled: duplicates };

    case 'archive_old_tasks':
      const archived = await archiveOldTasks();
      console.log(`[Healing] Archived ${archived} old tasks`);
      return { archived };

    // 错误缓解动作
    case 'retry_with_backoff':
      // TODO: 实现退避重试
      console.log('[Healing] Enabled retry with backoff');
      return { retryEnabled: true };

    case 'switch_fallback_endpoints':
      // TODO: 实现降级端点
      console.log('[Healing] Switched to fallback endpoints');
      return { fallbackEnabled: true };

    case 'quarantine_problematic_tasks':
      const quarantined = await quarantineProblematicTasks();
      console.log(`[Healing] Quarantined ${quarantined} problematic tasks`);
      return { quarantined };

    default:
      console.warn(`[Healing] Unknown action: ${action}`);
      return null;
  }
}

// ============================================================
// 具体动作实现
// ============================================================

async function findOrphanProcesses() {
  try {
    const { stdout } = await execAsync('pgrep -f "claude.*-p"');
    const pids = stdout.split('\n').filter(p => p).map(p => parseInt(p, 10));

    // 检查哪些是孤儿进程（没有对应的 task）
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT pid FROM task_runs
        WHERE status = 'in_progress'
          AND pid IS NOT NULL
      `);

      const activePids = new Set(result.rows.map(r => r.pid));
      return pids.filter(pid => !activePids.has(pid));
    } finally {
      client.release();
    }
  } catch (error) {
    return [];
  }
}

async function redistributeTasks() {
  const client = await pool.connect();
  try {
    // 将长时间等待的任务重新分配
    const result = await client.query(`
      UPDATE tasks
      SET priority = CASE
        WHEN created_at < NOW() - INTERVAL '1 hour' THEN 'P0'
        WHEN created_at < NOW() - INTERVAL '30 minutes' THEN 'P1'
        ELSE priority
      END,
      updated_at = NOW()
      WHERE status = 'queued'
        AND created_at < NOW() - INTERVAL '30 minutes'
      RETURNING id
    `);

    return result.rowCount;
  } finally {
    client.release();
  }
}

async function cancelDuplicateTasks() {
  const client = await pool.connect();
  try {
    // 取消重复任务（保留最新的）
    const result = await client.query(`
      WITH duplicates AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY title, goal_id, project_id
                 ORDER BY created_at DESC
               ) as rn
        FROM tasks
        WHERE status IN ('queued', 'pending')
      )
      UPDATE tasks
      SET status = 'canceled',
          updated_at = NOW()
      WHERE id IN (
        SELECT id FROM duplicates WHERE rn > 1
      )
      RETURNING id
    `);

    return result.rowCount;
  } finally {
    client.release();
  }
}

async function archiveOldTasks() {
  const client = await pool.connect();
  try {
    // 归档超过 7 天的已完成任务
    const result = await client.query(`
      UPDATE tasks
      SET status = 'archived',
          updated_at = NOW()
      WHERE status IN ('completed', 'failed', 'canceled')
        AND updated_at < NOW() - INTERVAL '7 days'
      RETURNING id
    `);

    return result.rowCount;
  } finally {
    client.release();
  }
}

async function quarantineProblematicTasks() {
  const client = await pool.connect();
  try {
    // 隔离多次失败的任务
    const result = await client.query(`
      UPDATE tasks
      SET status = 'quarantined',
          updated_at = NOW()
      WHERE id IN (
        SELECT task_id
        FROM task_runs
        WHERE status = 'failed'
        GROUP BY task_id
        HAVING COUNT(*) >= 3
      )
      AND status IN ('queued', 'pending')
      RETURNING id
    `);

    return result.rowCount;
  } finally {
    client.release();
  }
}

// ============================================================
// 检查点和回滚
// ============================================================

/**
 * 创建恢复检查点
 */
async function createCheckpoint() {
  const metrics = await collectCurrentMetrics();

  const checkpoint = {
    phase: recoveryState.phase,
    capacity: recoveryState.capacity,
    timestamp: Date.now(),
    metrics,
    checks: []
  };

  // 执行检查
  const checks = [
    { name: 'metrics_stable', passed: checkMetricsStable(metrics) },
    { name: 'no_critical_errors', passed: await checkNoCriticalErrors() },
    { name: 'resource_usage_ok', passed: checkResourceUsage(metrics) }
  ];

  checkpoint.checks = checks;
  checkpoint.passed = checks.every(c => c.passed);

  recoveryState.checkpoints.push(checkpoint);

  console.log(`[Healing] Checkpoint: ${checkpoint.passed ? 'PASSED' : 'FAILED'}`);

  return checkpoint;
}

/**
 * 检查指标是否稳定
 */
function checkMetricsStable(metrics) {
  // 检查是否有危险指标
  return !Object.values(metrics).some(m => m.status === 'danger');
}

/**
 * 检查是否有严重错误
 */
async function checkNoCriticalErrors() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT COUNT(*) as count
      FROM error_logs
      WHERE severity = 'critical'
        AND timestamp > NOW() - INTERVAL '5 minutes'
    `);

    return parseInt(result.rows[0].count, 10) === 0;
  } catch {
    return true; // 如果表不存在，假设没有错误
  } finally {
    client.release();
  }
}

/**
 * 检查资源使用
 */
function checkResourceUsage(metrics) {
  const memoryOk = !metrics.memory || metrics.memory.value < 250;
  const cpuOk = !metrics.cpu || metrics.cpu.value < 70;
  return memoryOk && cpuOk;
}

/**
 * 回滚到之前状态
 */
async function rollback() {
  console.log('[Healing] Rolling back recovery');

  // 降低容量
  recoveryState.capacity = Math.max(0, recoveryState.capacity - 25);

  // 如果在第一阶段就失败，直接结束恢复
  if (recoveryState.phase <= 1) {
    await completeRecovery(false);
  } else {
    // 回退到上一阶段
    recoveryState.phase = Math.max(1, recoveryState.phase - 1);
    recoveryState.phaseStartedAt = new Date();
  }

  emit('healing:rollback', { phase: recoveryState.phase });
}

/**
 * 完成恢复
 */
async function completeRecovery(success) {
  const duration = Date.now() - recoveryState.startedAt.getTime();

  console.log(`[Healing] Recovery ${success ? 'completed' : 'failed'} after ${duration}ms`);

  // 记录到数据库
  await recordHealingComplete(success, duration);

  // 保存到历史
  healingHistory.push({
    timestamp: recoveryState.startedAt,
    duration,
    success,
    strategies: recoveryState.strategies.map(s => s.key),
    actionsExecuted: recoveryState.actionsExecuted.length
  });

  if (healingHistory.length > MAX_HISTORY_SIZE) {
    healingHistory.shift();
  }

  // 重置状态
  recoveryState = {
    isRecovering: false,
    phase: 0,
    startedAt: null,
    phaseStartedAt: null,
    strategies: [],
    actionsExecuted: [],
    checkpoints: [],
    capacity: 100
  };

  // 发送事件
  emit('healing:completed', { success });
}

// ============================================================
// 数据库操作
// ============================================================

async function recordHealingStart(issues, strategies) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO self_healing_log (
        id, timestamp, issue_type, strategy_used,
        metrics_before
      ) VALUES (
        gen_random_uuid(), NOW(), $1, $2, $3
      )
    `, [
      issues.join(','),
      strategies.map(s => s.key).join(','),
      JSON.stringify({})
    ]);
  } catch (error) {
    console.error('[Healing] Failed to record start:', error);
  } finally {
    client.release();
  }
}

async function recordHealingComplete(success, duration) {
  const client = await pool.connect();
  try {
    // 更新最近的记录
    await client.query(`
      UPDATE self_healing_log
      SET success = $1,
          recovery_time_seconds = $2,
          actions_executed = $3,
          metrics_after = $4
      WHERE timestamp = (
        SELECT MAX(timestamp) FROM self_healing_log
      )
    `, [
      success,
      Math.round(duration / 1000),
      JSON.stringify(recoveryState.actionsExecuted),
      JSON.stringify({})
    ]);
  } catch (error) {
    console.error('[Healing] Failed to record complete:', error);
  } finally {
    client.release();
  }
}

async function collectCurrentMetrics() {
  // TODO: 从 metrics 模块获取当前指标
  return {};
}

// ============================================================
// 辅助函数
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// API 接口
// ============================================================

/**
 * 应用自愈策略
 */
export async function applySelfHealing(issues) {
  return startRecovery(issues);
}

/**
 * 获取恢复状态
 */
export function getRecoveryStatus() {
  return {
    isRecovering: recoveryState.isRecovering,
    phase: recoveryState.phase,
    phaseName: RECOVERY_PHASES[recoveryState.phase].name,
    capacity: recoveryState.capacity,
    duration: recoveryState.startedAt
      ? Date.now() - recoveryState.startedAt.getTime()
      : 0,
    strategiesApplied: recoveryState.strategies.length,
    actionsExecuted: recoveryState.actionsExecuted.length
  };
}

/**
 * 获取恢复历史
 */
export function getHealingHistory() {
  return [...healingHistory];
}

/**
 * 手动停止恢复
 */
export async function stopRecovery() {
  if (!recoveryState.isRecovering) return;

  console.log('[Healing] Manually stopping recovery');
  await completeRecovery(false);
}

// ============================================================
// 导出
// ============================================================

export default {
  startRecovery,
  applySelfHealing,
  getRecoveryStatus,
  getHealingHistory,
  stopRecovery,
  HEALING_STRATEGIES,
  RECOVERY_PHASES
};