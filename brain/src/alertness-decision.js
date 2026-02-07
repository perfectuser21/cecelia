/**
 * Alertness Decision Engine
 *
 * Intelligent decision framework for Brain health management.
 * Provides sophisticated decision-making based on alertness levels (0-10 scale).
 *
 * Key Features:
 * - 5 distinct alertness stages (HEALTHY → VIGILANT → STRESSED → CRITICAL → EMERGENCY)
 * - Intelligent behavior adjustments per stage
 * - State transition detection and handling
 * - Decision audit logging
 * - Coordination with other subsystems
 */

/* global console */

import pool from './db.js';
import { emit } from './event-bus.js';

// ============================================================
// Stage Definitions (0-10 scale)
// ============================================================

export const ALERTNESS_STAGES = {
  HEALTHY: {
    range: [0, 2],
    name: "HEALTHY",
    displayName: "健康",
    color: "green",
    behavior: {
      task_dispatch: "normal",
      max_concurrent: 3,
      dispatch_delay: 0,
      allow_heavy_tasks: true,
      allow_p2_tasks: true,
      monitoring_interval: 60000, // 1 minute
      tick_interval_multiplier: 1.0,
      circuit_breaker_sensitivity: "normal"
    }
  },
  VIGILANT: {
    range: [3, 5],
    name: "VIGILANT",
    displayName: "警惕",
    color: "yellow",
    behavior: {
      task_dispatch: "cautious",
      max_concurrent: 2,
      dispatch_delay: 5000,
      allow_heavy_tasks: true,
      allow_p2_tasks: true,
      monitoring_interval: 30000, // 30 seconds
      tick_interval_multiplier: 0.8,
      circuit_breaker_sensitivity: "high"
    }
  },
  STRESSED: {
    range: [6, 7],
    name: "STRESSED",
    displayName: "压力",
    color: "orange",
    behavior: {
      task_dispatch: "limited",
      max_concurrent: 1,
      dispatch_delay: 10000,
      allow_heavy_tasks: false,
      allow_p2_tasks: false,
      monitoring_interval: 15000, // 15 seconds
      tick_interval_multiplier: 0.5,
      circuit_breaker_sensitivity: "very_high"
    }
  },
  CRITICAL: {
    range: [8, 9],
    name: "CRITICAL",
    displayName: "危急",
    color: "red",
    behavior: {
      task_dispatch: "suspended",
      max_concurrent: 0,
      dispatch_delay: 30000,
      allow_heavy_tasks: false,
      allow_p2_tasks: false,
      monitoring_interval: 10000, // 10 seconds
      tick_interval_multiplier: 0.2,
      circuit_breaker_sensitivity: "extreme",
      trigger_recovery: true
    }
  },
  EMERGENCY: {
    range: [10, 10],
    name: "EMERGENCY",
    displayName: "紧急",
    color: "darkred",
    behavior: {
      task_dispatch: "halted",
      max_concurrent: 0,
      dispatch_delay: 60000,
      allow_heavy_tasks: false,
      allow_p2_tasks: false,
      monitoring_interval: 5000, // 5 seconds
      tick_interval_multiplier: 0,
      circuit_breaker_sensitivity: "extreme",
      trigger_emergency: true
    }
  }
};

// Helper to get stage by level
export function getStageByLevel(level) {
  for (const stage of Object.values(ALERTNESS_STAGES)) {
    if (level >= stage.range[0] && level <= stage.range[1]) {
      return stage;
    }
  }
  return ALERTNESS_STAGES.HEALTHY; // Default fallback
}

// Helper to get stage by name
export function getStageByName(name) {
  return ALERTNESS_STAGES[name] || null;
}

// ============================================================
// Decision Engine Class
// ============================================================

export class AlertnessDecisionEngine {
  constructor() {
    this.currentStage = null;
    this.currentLevel = 0;
    this.stageHistory = [];
    this.decisionHistory = [];
    this.lastDecisionTime = null;
    this.debounceWindow = 5000; // 5 seconds debounce
  }

  /**
   * Initialize engine with current state
   * @param {number} currentLevel - Current alertness level
   */
  async initialize(currentLevel) {
    this.currentLevel = currentLevel;
    this.currentStage = getStageByLevel(currentLevel);
    console.log(`[AlertnessDecisionEngine] Initialized with level ${currentLevel} (${this.currentStage.name})`);
  }

  /**
   * Make decision based on current level and context
   * @param {number} currentLevel - Current alertness level (0-10)
   * @param {Object} context - { signals, metrics, activeTaskCount, etc }
   * @returns {Object} - Decision object with actions and restrictions
   */
  async makeDecision(currentLevel, context = {}) {
    // Debounce rapid decisions
    if (this.lastDecisionTime && (Date.now() - this.lastDecisionTime) < this.debounceWindow) {
      return {
        skipped: true,
        reason: 'debounce',
        remaining: this.debounceWindow - (Date.now() - this.lastDecisionTime)
      };
    }

    const newStage = getStageByLevel(currentLevel);
    const previousStage = this.currentStage;
    const previousLevel = this.currentLevel;

    // Build decision object
    const decision = {
      timestamp: new Date().toISOString(),
      from_level: previousLevel,
      to_level: currentLevel,
      from_stage: previousStage?.name,
      to_stage: newStage.name,
      stage_changed: newStage.name !== previousStage?.name,
      actions: [],
      restrictions: newStage.behavior,
      context
    };

    // Handle stage transitions
    if (decision.stage_changed) {
      await this.handleStageTransition(previousStage, newStage, context);

      // Generate transition-specific actions
      decision.actions.push(...this.generateTransitionActions(previousStage, newStage, context));
    }

    // Generate stage-specific actions
    decision.actions.push(...this.generateStageActions(newStage, context));

    // Update internal state
    this.currentStage = newStage;
    this.currentLevel = currentLevel;
    this.lastDecisionTime = Date.now();

    // Record decision
    await this.recordDecision(decision);

    return decision;
  }

  /**
   * Handle stage transitions
   * @param {Object} fromStage - Previous stage
   * @param {Object} toStage - New stage
   * @param {Object} context - Transition context
   */
  async handleStageTransition(fromStage, toStage, context) {
    const transition = {
      from: fromStage?.name || "INIT",
      to: toStage.name,
      timestamp: new Date(),
      context
    };

    console.log(`[AlertnessDecisionEngine] Stage transition: ${transition.from} → ${transition.to}`);

    // Record transition
    this.stageHistory.push(transition);
    if (this.stageHistory.length > 20) {
      this.stageHistory.shift();
    }

    // Emit transition event
    await emit('alertness_stage_transition', 'alertness-decision', {
      from_stage: transition.from,
      to_stage: transition.to,
      context
    });

    // Check for deterioration or recovery patterns
    if (this.isWorsening(fromStage, toStage)) {
      await this.handleDeterioration(fromStage, toStage, context);
    } else if (this.isImproving(fromStage, toStage)) {
      await this.handleRecovery(fromStage, toStage, context);
    }
  }

  /**
   * Generate actions for stage transitions
   * @param {Object} fromStage - Previous stage
   * @param {Object} toStage - New stage
   * @param {Object} context - Context
   * @returns {Array} - List of actions
   */
  generateTransitionActions(fromStage, toStage, context) {
    const actions = [];

    // HEALTHY → VIGILANT: Start monitoring
    if (fromStage?.name === 'HEALTHY' && toStage.name === 'VIGILANT') {
      actions.push({
        type: 'increase_monitoring',
        description: 'Increased monitoring frequency',
        params: { interval: toStage.behavior.monitoring_interval }
      });
    }

    // VIGILANT → STRESSED: Reduce load
    if (fromStage?.name === 'VIGILANT' && toStage.name === 'STRESSED') {
      actions.push({
        type: 'reduce_concurrency',
        description: 'Reduced max concurrent tasks',
        params: { max_concurrent: toStage.behavior.max_concurrent }
      });
      actions.push({
        type: 'pause_p2_tasks',
        description: 'Paused P2 priority tasks'
      });
    }

    // STRESSED → CRITICAL: Emergency measures
    if (fromStage?.name === 'STRESSED' && toStage.name === 'CRITICAL') {
      actions.push({
        type: 'suspend_task_dispatch',
        description: 'Suspended task dispatch',
        params: { duration: 300000 } // 5 minutes
      });
      actions.push({
        type: 'trigger_gc',
        description: 'Triggered garbage collection',
        force: true
      });
      actions.push({
        type: 'notify',
        channel: 'emergency',
        message: `System entering CRITICAL state (level ${this.currentLevel})`
      });
    }

    // CRITICAL → EMERGENCY: Full shutdown
    if (fromStage?.name === 'CRITICAL' && toStage.name === 'EMERGENCY') {
      actions.push({
        type: 'emergency_shutdown',
        description: 'Emergency shutdown initiated',
        preserve_state: true
      });
      actions.push({
        type: 'page_oncall',
        severity: 'P0',
        message: 'Brain in EMERGENCY state - immediate intervention required'
      });
    }

    // Recovery transitions
    if (this.isImproving(fromStage, toStage)) {
      actions.push({
        type: 'recovery_initiated',
        description: `Recovering from ${fromStage?.name} to ${toStage.name}`,
        params: {
          new_restrictions: toStage.behavior
        }
      });
    }

    return actions;
  }

  /**
   * Generate actions for current stage
   * @param {Object} stage - Current stage
   * @param {Object} context - Context
   * @returns {Array} - List of actions
   */
  generateStageActions(stage, context) {
    const actions = [];

    // Stage-specific continuous actions
    switch (stage.name) {
      case 'CRITICAL':
        // Trigger recovery attempts
        if (stage.behavior.trigger_recovery) {
          actions.push({
            type: 'attempt_recovery',
            description: 'Attempting automatic recovery',
            strategies: ['clear_backlog', 'release_quarantine', 'reset_circuits', 'force_gc']
          });
        }
        break;

      case 'EMERGENCY':
        // Emergency protocols
        if (stage.behavior.trigger_emergency) {
          actions.push({
            type: 'emergency_protocol',
            description: 'Emergency protocols activated',
            actions: ['drain_mode', 'save_checkpoint', 'alert_humans']
          });
        }
        break;
    }

    // Context-specific actions
    if (context.signals?.resource_pressure > 0.8 && stage.name !== 'HEALTHY') {
      actions.push({
        type: 'resource_mitigation',
        description: 'High resource pressure detected',
        pressure: context.signals.resource_pressure
      });
    }

    return actions;
  }

  /**
   * Check if health is worsening
   * @param {Object} fromStage - Previous stage
   * @param {Object} toStage - New stage
   * @returns {boolean}
   */
  isWorsening(fromStage, toStage) {
    if (!fromStage) return false;
    const stageOrder = ['HEALTHY', 'VIGILANT', 'STRESSED', 'CRITICAL', 'EMERGENCY'];
    return stageOrder.indexOf(toStage.name) > stageOrder.indexOf(fromStage.name);
  }

  /**
   * Check if health is improving
   * @param {Object} fromStage - Previous stage
   * @param {Object} toStage - New stage
   * @returns {boolean}
   */
  isImproving(fromStage, toStage) {
    if (!fromStage) return false;
    const stageOrder = ['HEALTHY', 'VIGILANT', 'STRESSED', 'CRITICAL', 'EMERGENCY'];
    return stageOrder.indexOf(toStage.name) < stageOrder.indexOf(fromStage.name);
  }

  /**
   * Handle system deterioration
   * @param {Object} fromStage - Previous stage
   * @param {Object} toStage - New stage
   * @param {Object} context - Context
   */
  async handleDeterioration(fromStage, toStage, context) {
    console.log(`[AlertnessDecisionEngine] Health deteriorating: ${fromStage.name} → ${toStage.name}`);

    // Check for rapid deterioration pattern
    const recentTransitions = this.stageHistory.slice(-5);
    const rapidChanges = recentTransitions.filter(t => {
      const ageMs = Date.now() - t.timestamp.getTime();
      return ageMs < 10 * 60 * 1000; // Within 10 minutes
    });

    if (rapidChanges.length >= 3) {
      console.warn('[AlertnessDecisionEngine] Rapid deterioration detected! Multiple transitions in 10 minutes');
      await emit('rapid_deterioration', 'alertness-decision', {
        transitions: rapidChanges,
        current_stage: toStage.name
      });
    }
  }

  /**
   * Handle system recovery
   * @param {Object} fromStage - Previous stage
   * @param {Object} toStage - New stage
   * @param {Object} context - Context
   */
  async handleRecovery(fromStage, toStage, context) {
    console.log(`[AlertnessDecisionEngine] Health improving: ${fromStage.name} → ${toStage.name}`);

    await emit('health_recovery', 'alertness-decision', {
      from_stage: fromStage.name,
      to_stage: toStage.name,
      context
    });
  }

  /**
   * Record decision to database for audit
   * @param {Object} decision - Decision object
   */
  async recordDecision(decision) {
    try {
      await pool.query(`
        INSERT INTO alertness_decisions (
          level,
          stage,
          decision_json,
          context_json,
          actions_taken,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
      `, [
        decision.to_level,
        decision.to_stage,
        JSON.stringify(decision),
        JSON.stringify(decision.context),
        decision.actions.map(a => a.type)
      ]);

      // Keep local history
      this.decisionHistory.push(decision);
      if (this.decisionHistory.length > 50) {
        this.decisionHistory.shift();
      }
    } catch (err) {
      console.error('[AlertnessDecisionEngine] Failed to record decision:', err.message);
    }
  }

  /**
   * Get decision history
   * @param {number} limit - Number of decisions to return
   * @returns {Array} - Recent decisions
   */
  getHistory(limit = 10) {
    return this.decisionHistory.slice(-limit);
  }

  /**
   * Get current stage info
   * @returns {Object} - Current stage and level
   */
  getCurrentState() {
    return {
      level: this.currentLevel,
      stage: this.currentStage,
      stage_history: this.stageHistory.slice(-5),
      last_decision_time: this.lastDecisionTime
    };
  }

  /**
   * Check if specific action is allowed in current state
   * @param {string} action - Action to check
   * @returns {boolean}
   */
  isActionAllowed(action) {
    if (!this.currentStage) return false;

    const behavior = this.currentStage.behavior;

    switch (action) {
      case 'dispatch_task':
        return behavior.task_dispatch !== 'suspended' && behavior.task_dispatch !== 'halted';
      case 'dispatch_heavy_task':
        return behavior.allow_heavy_tasks;
      case 'dispatch_p2_task':
        return behavior.allow_p2_tasks;
      case 'plan_tasks':
        return this.currentStage.name === 'HEALTHY' || this.currentStage.name === 'VIGILANT';
      case 'use_cortex':
        return this.currentStage.name !== 'EMERGENCY';
      default:
        return true;
    }
  }
}

// Singleton instance
let _engineInstance = null;

/**
 * Get or create decision engine instance
 * @returns {AlertnessDecisionEngine}
 */
export function getDecisionEngine() {
  if (!_engineInstance) {
    _engineInstance = new AlertnessDecisionEngine();
  }
  return _engineInstance;
}

// ============================================================
// Exports
// ============================================================

export default {
  ALERTNESS_STAGES,
  AlertnessDecisionEngine,
  getDecisionEngine,
  getStageByLevel,
  getStageByName
};