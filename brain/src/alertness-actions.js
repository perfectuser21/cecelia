/**
 * Alertness Response Actions
 *
 * Executes protective and recovery actions when alertness levels change.
 * This is the final piece of the immune system, enabling autonomous response
 * to health problems.
 */

import pool from './db.js';
import { ALERTNESS_LEVELS } from './alertness.js';

// Color codes for console output
const COLORS = {
  RESET: '\x1b[0m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  CYAN: '\x1b[36m',
};

// Internal state for mitigation (in-memory, not persisted)
const _mitigationState = {
  p2_paused: false,
  drain_mode_requested: false,
};

/**
 * Main entry point: execute response actions based on level transition
 * @param {number} fromLevel - Previous alertness level (0-3)
 * @param {number} toLevel - New alertness level (0-3)
 * @param {Object} signals - Current signal data
 * @returns {Promise<Object>} - Execution summary
 */
export async function executeResponseActions(fromLevel, toLevel, signals = {}) {
  try {
    const actions = [];
    const timestamp = new Date().toISOString();

    // No action if level didn't change
    if (fromLevel === toLevel) {
      return { actions: [], reason: 'no_change' };
    }

    const isUpgrade = toLevel > fromLevel;
    const isDowngrade = toLevel < fromLevel;

    console.log(`[alertness-actions] Level transition: ${fromLevel} → ${toLevel} (${isUpgrade ? 'UPGRADE' : 'DOWNGRADE'})`);

    // === UPGRADES (health deteriorating) ===
    if (isUpgrade) {
      // ALERT+ : Notification
      if (toLevel >= ALERTNESS_LEVELS.ALERT) {
        await notifyAlert(toLevel, signals);
        actions.push('notification');
      }

      // EMERGENCY+ : Escalation + Mitigation
      if (toLevel >= ALERTNESS_LEVELS.EMERGENCY) {
        await escalateToAnalysis(signals);
        actions.push('escalation');

        await applyMitigation(signals);
        actions.push('mitigation');
      }

      // COMA : Shutdown Safety
      if (toLevel === ALERTNESS_LEVELS.COMA) {
        await activateShutdownSafety(signals);
        actions.push('shutdown_safety');
      }
    }

    // === DOWNGRADES (health improving) ===
    if (isDowngrade) {
      await recoverFromLevel(fromLevel, toLevel);
      actions.push('recovery');
    }

    // Record action execution to events table
    await pool.query(
      `INSERT INTO cecelia_events (event_type, source, payload)
       VALUES ($1, $2, $3)`,
      ['alertness_action', 'alertness', JSON.stringify({
        from_level: fromLevel,
        to_level: toLevel,
        actions,
        signals,
        timestamp,
      })]
    );

    return { actions, from_level: fromLevel, to_level: toLevel };

  } catch (err) {
    console.error(`[alertness-actions] Error executing response actions: ${err.message}`);
    // Don't throw - response action failure should not break alertness evaluation
    return { actions: [], error: err.message };
  }
}

/**
 * Notification: Console warning + event log
 * Triggered at ALERT level and above
 */
export async function notifyAlert(level, signals) {
  const levelName = ['NORMAL', 'ALERT', 'EMERGENCY', 'COMA'][level];
  const color = level === 1 ? COLORS.YELLOW : level === 2 ? COLORS.RED : COLORS.RED;

  const timestamp = new Date().toISOString();
  const message = `${color}[ALERTNESS ${levelName}] Brain health degraded${COLORS.RESET}`;

  console.log(message);
  console.log(`  Time: ${timestamp}`);
  console.log(`  Signals: ${JSON.stringify(signals, null, 2)}`);

  // Record notification to events
  await pool.query(
    `INSERT INTO cecelia_events (event_type, source, payload)
     VALUES ($1, $2, $3)`,
    ['alertness_notification', 'alertness', JSON.stringify({
      level,
      level_name: levelName,
      signals,
      timestamp,
    })]
  );
}

/**
 * Escalation: Trigger Cortex analysis (L2 brain)
 * Triggered at EMERGENCY level and above
 */
export async function escalateToAnalysis(signals) {
  console.log(`[alertness-actions] Escalating to Cortex for RCA analysis...`);

  try {
    // Create RCA task for Cortex to analyze
    const result = await pool.query(
      `INSERT INTO tasks (title, description, task_type, priority, status, payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        'Alertness RCA - System Health Degradation',
        `Brain alertness reached EMERGENCY level. Analyze root causes and recommend strategy adjustments.

Current signals: ${JSON.stringify(signals, null, 2)}

Required analysis:
1. Root cause identification
2. Contributing factors
3. Recommended mitigations
4. Strategy adjustments (thresholds, behaviors)`,
        'research',  // Cortex task type
        'P1',
        'queued',
        JSON.stringify({
          trigger: 'alertness_emergency',
          signals,
          requires_cortex: true,
          created_by: 'alertness_system',
        }),
      ]
    );

    const taskId = result.rows[0].id;
    console.log(`[alertness-actions] Created RCA task: ${taskId}`);

    return { task_id: taskId };

  } catch (err) {
    console.error(`[alertness-actions] Escalation failed: ${err.message}`);
    // Fallback: at least log the failure
    return { error: err.message };
  }
}

/**
 * Auto-Mitigation: Reduce system load
 * Triggered at EMERGENCY level and above
 */
export async function applyMitigation(signals) {
  console.log(`[alertness-actions] Applying auto-mitigation measures...`);

  const actions = [];

  // 1. Pause P2 task dispatch (in-memory flag, checked by dispatcher)
  _mitigationState.p2_paused = true;
  actions.push('p2_paused');
  console.log(`  - Paused P2 task dispatch`);

  // 2. Cleanup orphan processes
  try {
    const { cleanupOrphanProcesses } = await import('./executor.js');
    const cleaned = await cleanupOrphanProcesses();
    if (cleaned > 0) {
      actions.push(`cleaned_${cleaned}_orphans`);
      console.log(`  - Cleaned ${cleaned} orphan processes`);
    }
  } catch (err) {
    console.error(`  - Orphan cleanup failed: ${err.message}`);
  }

  // 3. Future: Cancel low-priority queued tasks
  // (Not implemented in this PR - would require task priority management)

  return { actions };
}

/**
 * Shutdown Safety: Prepare for COMA state
 * Triggered when entering COMA level
 */
export async function activateShutdownSafety(signals) {
  console.log(`${COLORS.RED}[ALERTNESS] Brain entering COMA mode - system protection activated${COLORS.RESET}`);

  // 1. Request drain mode (tick will see this and stop dispatch)
  _mitigationState.drain_mode_requested = true;
  console.log(`  - Drain mode requested (no new task dispatch)`);

  // 2. Save state checkpoint to database
  try {
    await pool.query(
      `INSERT INTO cecelia_events (event_type, source, payload)
       VALUES ($1, $2, $3)`,
      ['alertness_checkpoint', 'alertness', JSON.stringify({
        level: 'COMA',
        signals,
        timestamp: new Date().toISOString(),
        mitigation_state: _mitigationState,
      })]
    );
    console.log(`  - State checkpoint saved`);
  } catch (err) {
    console.error(`  - Checkpoint save failed: ${err.message}`);
  }

  // 3. Future: Notify external systems (Slack, PagerDuty)
  // (Not implemented in this PR)

  return { drain_mode: true, checkpoint_saved: true };
}

/**
 * Recovery: Restore normal operations when health improves
 * Triggered when level decreases (downgrade)
 */
export async function recoverFromLevel(fromLevel, toLevel) {
  const fromName = ['NORMAL', 'ALERT', 'EMERGENCY', 'COMA'][fromLevel];
  const toName = ['NORMAL', 'ALERT', 'EMERGENCY', 'COMA'][toLevel];

  console.log(`${COLORS.GREEN}[ALERTNESS] Brain recovering: ${fromName} → ${toName}${COLORS.RESET}`);

  const actions = [];

  // COMA → EMERGENCY: Start recovery
  if (fromLevel === ALERTNESS_LEVELS.COMA && toLevel === ALERTNESS_LEVELS.EMERGENCY) {
    _mitigationState.drain_mode_requested = false;
    actions.push('drain_mode_disabled');
    console.log(`  - Drain mode disabled`);
  }

  // EMERGENCY → ALERT: Re-enable planning
  if (fromLevel === ALERTNESS_LEVELS.EMERGENCY && toLevel === ALERTNESS_LEVELS.ALERT) {
    _mitigationState.p2_paused = false;
    actions.push('p2_resumed');
    console.log(`  - P2 task dispatch resumed`);
  }

  // ALERT → NORMAL: Full recovery
  if (fromLevel === ALERTNESS_LEVELS.ALERT && toLevel === ALERTNESS_LEVELS.NORMAL) {
    // Clear all mitigation state
    _mitigationState.p2_paused = false;
    _mitigationState.drain_mode_requested = false;
    actions.push('full_recovery');
    console.log(`  - All restrictions lifted - system healthy`);
  }

  // Multi-step downgrade (e.g., COMA → NORMAL): Clear everything
  if (toLevel === ALERTNESS_LEVELS.NORMAL && fromLevel > ALERTNESS_LEVELS.NORMAL) {
    _mitigationState.p2_paused = false;
    _mitigationState.drain_mode_requested = false;
    if (actions.length === 0) {
      actions.push('full_recovery');
      console.log(`  - All restrictions lifted - system healthy`);
    }
  }

  // Record recovery to events
  await pool.query(
    `INSERT INTO cecelia_events (event_type, source, payload)
     VALUES ($1, $2, $3)`,
    ['alertness_recovery', 'alertness', JSON.stringify({
      from_level: fromLevel,
      to_level: toLevel,
      actions,
      timestamp: new Date().toISOString(),
    })]
  );

  return { actions };
}

/**
 * Get current mitigation state (for tick/dispatcher to check)
 * @returns {Object} Current mitigation flags
 */
export function getMitigationState() {
  return { ..._mitigationState };
}

/**
 * Clear mitigation state (for testing)
 */
export function _resetMitigationState() {
  _mitigationState.p2_paused = false;
  _mitigationState.drain_mode_requested = false;
}

// Default export for convenience
export default {
  executeResponseActions,
  notifyAlert,
  escalateToAnalysis,
  applyMitigation,
  activateShutdownSafety,
  recoverFromLevel,
  getMitigationState,
};
