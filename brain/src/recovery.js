/**
 * Recovery Manager
 *
 * Implements automatic recovery strategies when alertness levels are high.
 * Tries different recovery techniques to bring the system back to health.
 */

/* global console */

import pool from './db.js';
import { emit } from './event-bus.js';
import { evaluateAndUpdate as evaluateAlertness } from './alertness.js';

// ============================================================
// Recovery Strategies
// ============================================================

export class RecoveryManager {
  constructor() {
    this.recoveryAttempts = 0;
    this.lastRecoveryAt = null;
    this.recoveryHistory = [];
  }

  /**
   * Attempt recovery using various strategies
   * @param {number} level - Current alertness level
   * @param {Object} stage - Current alertness stage
   * @param {Object} context - Recovery context (signals, metrics, etc)
   * @returns {Object} - Recovery result
   */
  async attemptRecovery(level, stage, context = {}) {
    console.log(`[RecoveryManager] Attempting recovery from level ${level} (${stage.name})`);

    this.recoveryAttempts++;
    this.lastRecoveryAt = new Date();

    const strategies = [
      { name: 'clear_event_backlog', method: this.clearEventBacklog },
      { name: 'release_quarantined_tasks', method: this.releaseQuarantinedTasks },
      { name: 'reset_circuit_breakers', method: this.resetCircuitBreakers },
      { name: 'force_garbage_collection', method: this.forceGarbageCollection },
      { name: 'restart_stuck_services', method: this.restartStuckServices }
    ];

    const results = [];
    let successfulStrategy = null;

    for (const strategy of strategies) {
      console.log(`[RecoveryManager] Trying strategy: ${strategy.name}`);

      try {
        const startTime = Date.now();
        const result = await strategy.method.call(this, context);
        const duration = Date.now() - startTime;

        results.push({
          strategy: strategy.name,
          success: result.success,
          duration,
          details: result
        });

        if (result.success) {
          console.log(`[RecoveryManager] Strategy ${strategy.name} succeeded`);

          // Wait for effect to propagate
          await new Promise(resolve => setTimeout(resolve, 5000));

          // Re-evaluate alertness
          const newEvaluation = await evaluateAlertness();
          const newLevel = newEvaluation.level;

          if (newLevel < level) {
            console.log(`[RecoveryManager] Recovery effective! Level dropped from ${level} to ${newLevel}`);
            successfulStrategy = strategy.name;
            break;
          } else {
            console.log(`[RecoveryManager] Strategy succeeded but level unchanged (${newLevel})`);
          }
        }
      } catch (err) {
        console.error(`[RecoveryManager] Strategy ${strategy.name} failed:`, err.message);
        results.push({
          strategy: strategy.name,
          success: false,
          error: err.message
        });
      }
    }

    const recoveryResult = {
      timestamp: new Date().toISOString(),
      initial_level: level,
      strategies_tried: results.length,
      successful_strategy: successfulStrategy,
      recovery_successful: !!successfulStrategy,
      results
    };

    // Record recovery attempt
    await this.recordRecoveryAttempt(recoveryResult);

    // If all strategies failed, trigger human intervention
    if (!successfulStrategy && level >= 8) {
      await this.triggerHumanIntervention(level, results);
    }

    return recoveryResult;
  }

  /**
   * Clear event backlog
   * @returns {Object} - Result
   */
  async clearEventBacklog(context) {
    try {
      // Delete old pending events
      const result = await pool.query(`
        DELETE FROM cecelia_events
        WHERE created_at < NOW() - INTERVAL '1 hour'
        AND event_type NOT IN ('alertness_change', 'task_completed', 'task_failed')
      `);

      const cleared = result.rowCount;
      console.log(`[RecoveryManager] Cleared ${cleared} old events`);

      return {
        success: cleared > 0,
        events_cleared: cleared
      };
    } catch (err) {
      console.error('[RecoveryManager] Failed to clear event backlog:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Release quarantined tasks that can be retried
   * @returns {Object} - Result
   */
  async releaseQuarantinedTasks(context) {
    try {
      // Import quarantine functions dynamically to avoid circular deps
      const { releaseTask, REVIEW_ACTIONS } = await import('./quarantine.js');

      // Find quarantined tasks that can be released
      const quarantinedResult = await pool.query(`
        SELECT id, title, payload
        FROM tasks
        WHERE status = 'quarantined'
        AND payload->'quarantine_info'->>'reason' != 'manual'
        AND (payload->'quarantine_info'->>'failure_count')::int < 3
        LIMIT 5
      `);

      const released = [];
      for (const task of quarantinedResult.rows) {
        const releaseResult = await releaseTask(task.id, REVIEW_ACTIONS.RETRY_ONCE, {
          reviewer: 'recovery_manager',
          reason: 'Automatic recovery attempt'
        });

        if (releaseResult.success) {
          released.push(task.id);
        }
      }

      console.log(`[RecoveryManager] Released ${released.length} quarantined tasks`);

      return {
        success: released.length > 0,
        tasks_released: released.length,
        task_ids: released
      };
    } catch (err) {
      console.error('[RecoveryManager] Failed to release quarantined tasks:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Reset circuit breakers
   * @returns {Object} - Result
   */
  async resetCircuitBreakers(context) {
    try {
      const { resetAll } = await import('./circuit-breaker.js');

      const resetResult = resetAll();
      console.log(`[RecoveryManager] Reset circuit breakers`);

      return {
        success: true,
        circuits_reset: resetResult
      };
    } catch (err) {
      console.error('[RecoveryManager] Failed to reset circuit breakers:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Force garbage collection
   * @returns {Object} - Result
   */
  async forceGarbageCollection(context) {
    try {
      if (global.gc) {
        const memBefore = process.memoryUsage();
        global.gc();
        const memAfter = process.memoryUsage();

        const freed = memBefore.heapUsed - memAfter.heapUsed;
        console.log(`[RecoveryManager] GC freed ${Math.round(freed / 1024 / 1024)}MB`);

        return {
          success: freed > 0,
          memory_freed: freed,
          memory_before: memBefore,
          memory_after: memAfter
        };
      } else {
        console.log('[RecoveryManager] GC not available (run node with --expose-gc)');
        return { success: false, reason: 'GC not available' };
      }
    } catch (err) {
      console.error('[RecoveryManager] Failed to force GC:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Restart stuck services (cleanup orphan processes)
   * @returns {Object} - Result
   */
  async restartStuckServices(context) {
    try {
      const { cleanupOrphanProcesses } = await import('./executor.js');

      const cleaned = await cleanupOrphanProcesses();
      console.log(`[RecoveryManager] Cleaned ${cleaned} orphan processes`);

      // Also clean up stuck tasks
      const stuckResult = await pool.query(`
        UPDATE tasks
        SET status = 'failed',
            payload = COALESCE(payload, '{}'::jsonb) || '{"recovery_failed": true}'::jsonb
        WHERE status = 'in_progress'
        AND updated_at < NOW() - INTERVAL '1 hour'
      `);

      const failedTasks = stuckResult.rowCount;
      console.log(`[RecoveryManager] Marked ${failedTasks} stuck tasks as failed`);

      return {
        success: (cleaned + failedTasks) > 0,
        orphan_processes_cleaned: cleaned,
        stuck_tasks_failed: failedTasks
      };
    } catch (err) {
      console.error('[RecoveryManager] Failed to restart services:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Record recovery attempt for analysis
   * @param {Object} recoveryResult - Recovery result to record
   */
  async recordRecoveryAttempt(recoveryResult) {
    try {
      await pool.query(`
        INSERT INTO cecelia_events (event_type, source, payload)
        VALUES ('recovery_attempt', 'recovery_manager', $1)
      `, [JSON.stringify(recoveryResult)]);

      // Keep local history
      this.recoveryHistory.push(recoveryResult);
      if (this.recoveryHistory.length > 20) {
        this.recoveryHistory.shift();
      }
    } catch (err) {
      console.error('[RecoveryManager] Failed to record recovery attempt:', err.message);
    }
  }

  /**
   * Trigger human intervention when recovery fails
   * @param {number} level - Current alertness level
   * @param {Array} failedStrategies - List of failed strategies
   */
  async triggerHumanIntervention(level, failedStrategies) {
    console.error('[RecoveryManager] CRITICAL: All recovery strategies failed!');
    console.error(`[RecoveryManager] Current alertness level: ${level}`);
    console.error(`[RecoveryManager] Failed strategies:`, failedStrategies);

    try {
      await emit('recovery_failed', 'recovery_manager', {
        level,
        attempts: this.recoveryAttempts,
        failed_strategies: failedStrategies,
        requires_human_intervention: true,
        timestamp: new Date().toISOString()
      });

      // Create high-priority task for human review
      await pool.query(`
        INSERT INTO tasks (title, description, task_type, priority, status, payload)
        VALUES ($1, $2, 'human_review', 'P0', 'queued', $3)
      `, [
        'CRITICAL: Manual Intervention Required',
        `Automatic recovery failed at alertness level ${level}. All ${failedStrategies.length} recovery strategies were unsuccessful.`,
        JSON.stringify({
          alert_level: level,
          failed_strategies: failedStrategies,
          recovery_attempts: this.recoveryAttempts,
          created_by: 'recovery_manager'
        })
      ]);
    } catch (err) {
      console.error('[RecoveryManager] Failed to trigger human intervention:', err.message);
    }
  }

  /**
   * Get recovery statistics
   * @returns {Object} - Recovery stats
   */
  getStats() {
    const successfulRecoveries = this.recoveryHistory.filter(r => r.recovery_successful).length;
    const failedRecoveries = this.recoveryHistory.filter(r => !r.recovery_successful).length;

    return {
      total_attempts: this.recoveryAttempts,
      successful_recoveries: successfulRecoveries,
      failed_recoveries: failedRecoveries,
      last_recovery_at: this.lastRecoveryAt,
      recent_history: this.recoveryHistory.slice(-5)
    };
  }
}

// Singleton instance
let _managerInstance = null;

/**
 * Get or create recovery manager instance
 * @returns {RecoveryManager}
 */
export function getRecoveryManager() {
  if (!_managerInstance) {
    _managerInstance = new RecoveryManager();
  }
  return _managerInstance;
}

// ============================================================
// Exports
// ============================================================

export default {
  RecoveryManager,
  getRecoveryManager
};