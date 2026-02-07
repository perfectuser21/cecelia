/**
 * Plan Proposal System
 *
 * Provides structured planning proposals that sit between LLM/user input
 * and the existing dispatcher. All changes go through validation (whitelist,
 * DAG cycle detection, rate limiting) before being applied.
 *
 * Design principle: LLM proposes, algorithm executes, human approves.
 */

import pool from './db.js';

// ============================================================
// Constants
// ============================================================

const ALLOWED_CHANGE_TYPES = new Set([
  'create_task',
  'update_task',
  'set_focus',
  'add_dependency',
  'remove_dependency',
  'split_task',
  'merge_tasks',
]);

const ALLOWED_TASK_FIELDS = new Set([
  'priority', 'next_run_at', 'scheduled_for', 'title', 'description',
  'goal_id', 'project_id', 'task_type', 'status',
]);

const BULK_THRESHOLD = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

// In-memory rate limiter (resets on restart, which is fine)
const rateLimitBuckets = new Map();

// ============================================================
// Validation Layer
// ============================================================

/**
 * Validate a single change object.
 * @param {Object} change - { type, ...params }
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateChange(change) {
  const errors = [];

  if (!change || typeof change !== 'object') {
    return { valid: false, errors: ['change must be an object'] };
  }

  if (!ALLOWED_CHANGE_TYPES.has(change.type)) {
    errors.push(`action type "${change.type}" not in whitelist. Allowed: ${[...ALLOWED_CHANGE_TYPES].join(', ')}`);
  }

  if (change.type === 'update_task' && change.fields) {
    for (const field of Object.keys(change.fields)) {
      if (!ALLOWED_TASK_FIELDS.has(field)) {
        errors.push(`field "${field}" not allowed for update_task`);
      }
    }
  }

  if (change.type === 'create_task') {
    if (!change.title) errors.push('create_task requires title');
    if (!change.project_id) errors.push('create_task requires project_id');
  }

  if (change.type === 'add_dependency' || change.type === 'remove_dependency') {
    if (!change.task_id) errors.push(`${change.type} requires task_id`);
    if (!change.depends_on_id) errors.push(`${change.type} requires depends_on_id`);
  }

  if (change.type === 'set_focus') {
    if (!change.objective_id) errors.push('set_focus requires objective_id');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate all changes in a proposal.
 * @param {Array} changes
 * @returns {{ valid: boolean, errors: string[], requires_review: boolean }}
 */
function validateChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { valid: false, errors: ['changes must be a non-empty array'], requires_review: false };
  }

  const allErrors = [];
  for (let i = 0; i < changes.length; i++) {
    const result = validateChange(changes[i]);
    if (!result.valid) {
      allErrors.push(...result.errors.map(e => `changes[${i}]: ${e}`));
    }
  }

  const requires_review = changes.length > BULK_THRESHOLD;

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    requires_review,
  };
}

/**
 * Pure graph cycle detection (no DB dependency — testable).
 * @param {string} fromTaskId - The task that will have a new dependency
 * @param {string} toTaskId - The dependency target
 * @param {Map<string, string[]>} existingAdj - Current adjacency list (task → depends_on[])
 * @returns {boolean} true if cycle detected
 */
function hasCycleInGraph(fromTaskId, toTaskId, existingAdj) {
  if (fromTaskId === toTaskId) return true;

  // Clone and add the proposed edge
  const adj = new Map(existingAdj);
  const fromDeps = adj.get(fromTaskId) || [];
  adj.set(fromTaskId, [...fromDeps, toTaskId]);

  // BFS from toTaskId: can we reach fromTaskId through dependency edges?
  const visited = new Set();
  const queue = [toTaskId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === fromTaskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adj.get(current) || [];
    for (const n of neighbors) {
      if (!visited.has(n)) queue.push(n);
    }
  }

  return false;
}

/**
 * Detect cycles in task dependency graph (DAG check).
 * Loads current graph from DB, then delegates to hasCycleInGraph.
 * @param {string} fromTaskId - The task that will depend on toTaskId
 * @param {string} toTaskId - The dependency target
 * @param {Map} [adjOverride] - Optional adjacency overrides for batch checking
 * @returns {Promise<boolean>} true if cycle detected
 */
async function detectCycle(fromTaskId, toTaskId, adjOverride = null) {
  if (fromTaskId === toTaskId) return true;

  // Build adjacency list from DB
  const result = await pool.query(`
    SELECT id, payload->'depends_on' as deps
    FROM tasks
    WHERE status NOT IN ('completed', 'cancelled')
      AND payload->'depends_on' IS NOT NULL
  `);

  const adj = new Map();
  for (const row of result.rows) {
    const deps = row.deps;
    if (Array.isArray(deps) && deps.length > 0) {
      adj.set(row.id, deps);
    }
  }

  // Apply overrides
  if (adjOverride) {
    for (const [k, v] of adjOverride) {
      const existing = adj.get(k) || [];
      adj.set(k, [...existing, ...v]);
    }
  }

  return hasCycleInGraph(fromTaskId, toTaskId, adj);
}

/**
 * Check rate limit for priority changes.
 * @param {string} source
 * @returns {{ allowed: boolean, remaining: number }}
 */
function checkRateLimit(source) {
  const now = Date.now();
  const key = `priority_${source}`;

  if (!rateLimitBuckets.has(key)) {
    rateLimitBuckets.set(key, []);
  }

  const bucket = rateLimitBuckets.get(key);
  // Prune old entries
  while (bucket.length > 0 && bucket[0] < now - RATE_LIMIT_WINDOW_MS) {
    bucket.shift();
  }

  const remaining = RATE_LIMIT_MAX - bucket.length;
  return { allowed: remaining > 0, remaining: Math.max(0, remaining) };
}

function recordRateLimit(source, count = 1) {
  const now = Date.now();
  const key = `priority_${source}`;
  if (!rateLimitBuckets.has(key)) {
    rateLimitBuckets.set(key, []);
  }
  const bucket = rateLimitBuckets.get(key);
  for (let i = 0; i < count; i++) {
    bucket.push(now);
  }
}

// ============================================================
// Core Operations
// ============================================================

/**
 * Create a new proposal.
 * @param {Object} input
 * @returns {Object} Created proposal
 */
async function createProposal(input) {
  const { source, type, scope, scope_id, title, description, changes } = input;

  // Validate source
  if (!['llm_proposal', 'user_ui'].includes(source)) {
    throw new Error('source must be llm_proposal or user_ui');
  }

  // Validate changes
  const validation = validateChanges(changes);
  if (!validation.valid) {
    throw new Error(`Invalid changes: ${validation.errors.join('; ')}`);
  }

  // Count priority changes for rate limiting
  const priorityChanges = changes.filter(c =>
    c.type === 'update_task' && c.fields?.priority
  ).length;

  if (priorityChanges > 0) {
    const rateCheck = checkRateLimit(source);
    if (!rateCheck.allowed) {
      throw new Error(`Rate limit exceeded: max ${RATE_LIMIT_MAX} priority changes per minute`);
    }
  }

  // Check DAG for dependency changes
  for (const change of changes) {
    if (change.type === 'add_dependency') {
      const hasCycle = await detectCycle(change.task_id, change.depends_on_id);
      if (hasCycle) {
        throw new Error(`Dependency cycle detected: ${change.task_id} → ${change.depends_on_id}`);
      }
    }
  }

  // Determine risk level
  let risk_level = input.risk_level || 'low';
  if (changes.length > BULK_THRESHOLD) risk_level = 'medium';
  if (changes.length > 15) risk_level = 'high';

  // Determine initial status
  const status = validation.requires_review ? 'pending_review' : 'pending_review';

  const result = await pool.query(`
    INSERT INTO proposals (source, type, scope, scope_id, title, description, changes, risk_level, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    source,
    type || 'reorder',
    scope || null,
    scope_id || null,
    title,
    description || null,
    JSON.stringify(changes),
    risk_level,
    status,
  ]);

  return result.rows[0];
}

/**
 * Approve a proposal.
 * @param {string} proposalId
 * @param {string} approvedBy
 * @returns {Object} Updated proposal
 */
async function approveProposal(proposalId, approvedBy = 'user') {
  const proposal = await getProposal(proposalId);
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'pending_review' && proposal.status !== 'draft') {
    throw new Error(`Cannot approve proposal in status "${proposal.status}"`);
  }

  await pool.query(`
    UPDATE proposals SET status = 'approved', approved_at = NOW(), approved_by = $2, updated_at = NOW()
    WHERE id = $1
  `, [proposalId, approvedBy]);

  // Auto-apply
  return applyProposal(proposalId);
}

/**
 * Apply an approved proposal — execute all changes.
 * Takes a snapshot of affected entities before applying for rollback.
 * @param {string} proposalId
 * @returns {Object} Application result
 */
async function applyProposal(proposalId) {
  const proposal = await getProposal(proposalId);
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'approved') {
    throw new Error(`Cannot apply proposal in status "${proposal.status}"`);
  }

  const changes = proposal.changes || [];
  const snapshot = { tasks: {}, focus: null };
  const results = [];

  for (const change of changes) {
    try {
      let result;
      switch (change.type) {
        case 'create_task': {
          const taskResult = await pool.query(`
            INSERT INTO tasks (title, description, priority, project_id, goal_id, status, task_type, payload)
            VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7)
            RETURNING id, title
          `, [
            change.title,
            change.description || '',
            change.priority || 'P1',
            change.project_id,
            change.goal_id || null,
            change.skill || 'dev',
            JSON.stringify({
              depends_on: change.depends_on || [],
              estimated_minutes: change.estimated_minutes || null,
              proposal_id: proposalId,
            }),
          ]);
          result = { success: true, action: 'created', task_id: taskResult.rows[0].id };
          break;
        }

        case 'update_task': {
          // Snapshot before update
          const before = await pool.query('SELECT * FROM tasks WHERE id = $1', [change.task_id]);
          if (before.rows[0]) {
            snapshot.tasks[change.task_id] = before.rows[0];
          }

          const sets = [];
          const values = [change.task_id];
          let idx = 2;

          for (const [field, value] of Object.entries(change.fields || {})) {
            if (!ALLOWED_TASK_FIELDS.has(field)) continue;

            if (field === 'next_run_at' || field === 'scheduled_for') {
              // These go into payload
              await pool.query(`
                UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
                WHERE id = $1
              `, [change.task_id, JSON.stringify({ [field]: value })]);
            } else {
              sets.push(`${field} = $${idx}`);
              values.push(value);
              idx++;
            }
          }

          if (sets.length > 0) {
            sets.push('updated_at = NOW()');
            await pool.query(
              `UPDATE tasks SET ${sets.join(', ')} WHERE id = $1`,
              values
            );
          }

          result = { success: true, action: 'updated', task_id: change.task_id };
          break;
        }

        case 'set_focus': {
          // Snapshot current focus
          const focusBefore = await pool.query(
            "SELECT value_json FROM working_memory WHERE key = 'daily_focus_override'"
          );
          snapshot.focus = focusBefore.rows[0]?.value_json || null;

          await pool.query(`
            INSERT INTO working_memory (key, value_json, updated_at)
            VALUES ('daily_focus_override', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()
          `, [{ objective_id: change.objective_id }]);

          result = { success: true, action: 'focus_set', objective_id: change.objective_id };
          break;
        }

        case 'add_dependency': {
          // Snapshot
          const taskBefore = await pool.query('SELECT id, payload FROM tasks WHERE id = $1', [change.task_id]);
          if (taskBefore.rows[0]) {
            snapshot.tasks[change.task_id] = snapshot.tasks[change.task_id] || taskBefore.rows[0];
          }

          const currentDeps = taskBefore.rows[0]?.payload?.depends_on || [];
          if (!currentDeps.includes(change.depends_on_id)) {
            const newDeps = [...currentDeps, change.depends_on_id];
            await pool.query(`
              UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
              WHERE id = $1
            `, [change.task_id, JSON.stringify({ depends_on: newDeps })]);
          }

          result = { success: true, action: 'dependency_added', task_id: change.task_id, depends_on: change.depends_on_id };
          break;
        }

        case 'remove_dependency': {
          const taskBefore2 = await pool.query('SELECT id, payload FROM tasks WHERE id = $1', [change.task_id]);
          if (taskBefore2.rows[0]) {
            snapshot.tasks[change.task_id] = snapshot.tasks[change.task_id] || taskBefore2.rows[0];
          }

          const deps = taskBefore2.rows[0]?.payload?.depends_on || [];
          const filtered = deps.filter(d => d !== change.depends_on_id);
          await pool.query(`
            UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
            WHERE id = $1
          `, [change.task_id, JSON.stringify({ depends_on: filtered })]);

          result = { success: true, action: 'dependency_removed', task_id: change.task_id };
          break;
        }

        case 'split_task':
        case 'merge_tasks':
          // These are more complex — implement as needed
          result = { success: false, action: change.type, error: 'not yet implemented' };
          break;

        default:
          result = { success: false, error: `unknown change type: ${change.type}` };
      }

      results.push({ ...change, result });
    } catch (err) {
      results.push({ ...change, result: { success: false, error: err.message } });
    }
  }

  // Record priority changes for rate limiting
  const priorityChanges = changes.filter(c =>
    c.type === 'update_task' && c.fields?.priority
  ).length;
  if (priorityChanges > 0) {
    recordRateLimit(proposal.source, priorityChanges);
  }

  // Save snapshot and mark as applied
  await pool.query(`
    UPDATE proposals SET status = 'applied', applied_at = NOW(), snapshot = $2, updated_at = NOW()
    WHERE id = $1
  `, [proposalId, JSON.stringify(snapshot)]);

  return {
    proposal_id: proposalId,
    status: 'applied',
    results,
    applied_at: new Date().toISOString(),
  };
}

/**
 * Rollback an applied proposal using the stored snapshot.
 * @param {string} proposalId
 * @returns {Object} Rollback result
 */
async function rollbackProposal(proposalId) {
  const proposal = await getProposal(proposalId);
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'applied') {
    throw new Error(`Cannot rollback proposal in status "${proposal.status}"`);
  }

  const snapshot = proposal.snapshot || {};
  const results = [];

  // Restore tasks from snapshot
  for (const [taskId, taskData] of Object.entries(snapshot.tasks || {})) {
    try {
      await pool.query(`
        UPDATE tasks SET priority = $2, status = $3, payload = $4, updated_at = NOW()
        WHERE id = $1
      `, [taskId, taskData.priority, taskData.status, taskData.payload || {}]);
      results.push({ task_id: taskId, restored: true });
    } catch (err) {
      results.push({ task_id: taskId, restored: false, error: err.message });
    }
  }

  // Restore focus if snapshotted
  if (snapshot.focus !== undefined) {
    if (snapshot.focus === null) {
      await pool.query("DELETE FROM working_memory WHERE key = 'daily_focus_override'");
    } else {
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ('daily_focus_override', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()
      `, [snapshot.focus]);
    }
    results.push({ focus: 'restored' });
  }

  // Delete tasks created by this proposal
  const changes = proposal.changes || [];
  for (const change of changes) {
    if (change.type === 'create_task') {
      const created = await pool.query(
        "SELECT id FROM tasks WHERE payload->>'proposal_id' = $1",
        [proposalId]
      );
      for (const row of created.rows) {
        await pool.query("DELETE FROM tasks WHERE id = $1 AND status = 'queued'", [row.id]);
        results.push({ task_id: row.id, deleted: true });
      }
    }
  }

  await pool.query(`
    UPDATE proposals SET status = 'rolled_back', rolled_back_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `, [proposalId]);

  return {
    proposal_id: proposalId,
    status: 'rolled_back',
    results,
  };
}

/**
 * Reject a proposal.
 */
async function rejectProposal(proposalId, reason = '') {
  const proposal = await getProposal(proposalId);
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'pending_review' && proposal.status !== 'draft') {
    throw new Error(`Cannot reject proposal in status "${proposal.status}"`);
  }

  await pool.query(`
    UPDATE proposals SET status = 'rejected', updated_at = NOW()
    WHERE id = $1
  `, [proposalId]);

  return { proposal_id: proposalId, status: 'rejected', reason };
}

/**
 * Get a proposal by ID.
 */
async function getProposal(proposalId) {
  const result = await pool.query('SELECT * FROM proposals WHERE id = $1', [proposalId]);
  return result.rows[0] || null;
}

/**
 * List proposals with optional filters.
 */
async function listProposals({ status, limit = 20 } = {}) {
  let query = 'SELECT * FROM proposals';
  const params = [];

  if (status) {
    query += ' WHERE status = $1';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
  params.push(limit);

  const result = await pool.query(query, params);
  return result.rows;
}

// ============================================================
// Exports
// ============================================================

export {
  createProposal,
  approveProposal,
  applyProposal,
  rollbackProposal,
  rejectProposal,
  getProposal,
  listProposals,
  validateChange,
  validateChanges,
  detectCycle,
  hasCycleInGraph,
  checkRateLimit,
  ALLOWED_CHANGE_TYPES,
  ALLOWED_TASK_FIELDS,
  BULK_THRESHOLD,
};
