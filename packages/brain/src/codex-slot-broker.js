import { randomUUID } from 'node:crypto';
import pool from './db.js';
import { getCodexSlotTtls } from './fleet-resource-cache.js';

// Codex Slot deliberately reuses the existing system_registry,
// fleet-resource-cache, slot-allocator and account usage deficit sources.
// A parallel codex agent registry would create a second allocation truth.

export const CODEX_SLOT_ERROR_MATRIX = Object.freeze({
  UNAUTHENTICATED: {
    httpStatus: 401,
    message: 'authentication required',
    retryable: false,
  },
  INVALID_REQUEST: {
    httpStatus: 400,
    message: 'request does not match the exact schema',
    retryable: false,
  },
  FORBIDDEN_IDENTITY: {
    httpStatus: 403,
    message: 'identity is not mapped',
    retryable: false,
  },
  ACCOUNT_BUSY: {
    httpStatus: 409,
    message: 'account already has a blocking lease',
    retryable: true,
  },
  ROLLOUT_FROZEN: {
    httpStatus: 423,
    message: 'codex slot rollout is frozen',
    retryable: true,
  },
  AGENT_UNAVAILABLE: {
    httpStatus: 503,
    message: 'no healthy codex slot agent available',
    retryable: true,
  },
  DURABILITY_FAILED: {
    httpStatus: 503,
    message: 'durable write failed',
    retryable: true,
  },
});

export class CodexSlotError extends Error {
  constructor(code, cause = null) {
    const definition = CODEX_SLOT_ERROR_MATRIX[code];
    if (!definition) throw new TypeError(`unknown Codex Slot error code: ${code}`);
    super(definition.message, cause ? { cause } : undefined);
    this.name = 'CodexSlotError';
    this.code = code;
    this.httpStatus = definition.httpStatus;
    this.retryable = definition.retryable;
  }
}

export function codexSlotError(code, cause = null) {
  return new CodexSlotError(code, cause);
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SERIALIZATION_ATTEMPTS = 3;

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function validateAcquireRequest({ body, idempotencyKey, identityKind, identityRef }) {
  if (!exactKeys(body, ['name', 'project'])) throw codexSlotError('INVALID_REQUEST');
  if (typeof body.name !== 'string'
      || typeof body.project !== 'string'
      || !SAFE_SEGMENT.test(body.name)
      || !SAFE_SEGMENT.test(body.project)) {
    throw codexSlotError('INVALID_REQUEST');
  }
  if (typeof idempotencyKey !== 'string' || !UUID.test(idempotencyKey)) {
    throw codexSlotError('INVALID_REQUEST');
  }
  if (!['uid', 'ssh_key'].includes(identityKind)
      || typeof identityRef !== 'string'
      || identityRef.length < 1
      || identityRef.length > 512) {
    throw codexSlotError('FORBIDDEN_IDENTITY');
  }
}

export function validateStopRequest({ body, sessionId, identityKind, identityRef }) {
  if (!exactKeys(body, [])) throw codexSlotError('INVALID_REQUEST');
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) {
    throw codexSlotError('INVALID_REQUEST');
  }
  if (!['uid', 'ssh_key'].includes(identityKind)
      || typeof identityRef !== 'string'
      || identityRef.length < 1
      || identityRef.length > 512) {
    throw codexSlotError('FORBIDDEN_IDENTITY');
  }
}

function sessionResponse(row) {
  return {
    agent_id: row.agent_id,
    handle: row.handle,
    lease_id: row.lease_id,
    session_id: row.session_id,
    status: 'running',
  };
}

function stoppedSessionResponse(row) {
  return {
    cleanup: {
      auth_absent: row.cleanup?.auth_absent === true,
      lease_state: 'released',
      temp_absent: row.cleanup?.temp_absent === true,
      tmux_absent: row.cleanup?.tmux_absent === true,
    },
    handle: row.handle,
    session_id: row.session_id,
    status: 'stopped',
  };
}

async function resolveIdentity(client, identityKind, identityRef) {
  const result = await client.query(
    `SELECT id, tenant_id, actor_id
       FROM codex_slot_actor_identities
      WHERE identity_kind = $1
        AND identity_ref = $2
        AND enabled = TRUE
      LIMIT 1`,
    [identityKind, identityRef],
  );
  if (result.rows.length !== 1) throw codexSlotError('FORBIDDEN_IDENTITY');
  return result.rows[0];
}

async function assertRolloutOpen(client, tenantId) {
  const result = await client.query(
    `SELECT state, inventory_complete, cutover_steps
       FROM codex_slot_rollout
      WHERE tenant_id = $1 AND rollout_key = 'codex-slot'
      LIMIT 1`,
    [tenantId],
  );
  const rollout = result.rows[0];
  const steps = rollout?.cutover_steps;
  const cutoverComplete = steps
    && typeof steps === 'object'
    && Object.keys(steps).length > 0
    && Object.values(steps).every(value => value === true);
  if (rollout?.state !== 'open' || rollout.inventory_complete !== true || !cutoverComplete) {
    throw codexSlotError('ROLLOUT_FROZEN');
  }
}

async function loadReplay(client, tenantId, actorId, requestId) {
  const result = await client.query(
    `SELECT s.id AS session_id, s.lease_id, s.agent_id, s.handle, s.status, s.receipt
       FROM codex_slot_sessions s
      WHERE s.tenant_id = $1 AND s.actor_id = $2 AND s.request_id = $3
      LIMIT 1`,
    [tenantId, actorId, requestId],
  );
  return result.rows[0] || null;
}

function usageDeficit(row, now = Date.now()) {
  const sevenDayUsed = Number(row.seven_day_pct);
  const resetAt = row.seven_day_resets_at ? new Date(row.seven_day_resets_at).getTime() : NaN;
  if (!Number.isFinite(sevenDayUsed) || !Number.isFinite(resetAt)) return null;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const elapsed = Math.max(0, Math.min(sevenDaysMs, now - (resetAt - sevenDaysMs)));
  return (elapsed / sevenDaysMs) * 100 - sevenDayUsed;
}

export function rankAccountUsage(rows, now = Date.now()) {
  return rows
    .map(row => ({
      account_ref: row.account_id,
      five_hour_pct: Number(row.five_hour_pct),
      deficit: usageDeficit(row, now),
    }))
    .filter(row => typeof row.account_ref === 'string'
      && SAFE_SEGMENT.test(row.account_ref)
      && Number.isFinite(row.five_hour_pct)
      && row.five_hour_pct <= 95
      && Number.isFinite(row.deficit))
    .sort((a, b) => b.deficit - a.deficit || a.five_hour_pct - b.five_hour_pct);
}

async function selectAccountRef(client) {
  const usage = await client.query(
    `SELECT account_id, five_hour_pct, seven_day_pct, seven_day_resets_at
       FROM account_usage_cache
      WHERE fetched_at > NOW() - INTERVAL '15 minutes'`,
  );
  const ranked = rankAccountUsage(usage.rows);
  if (ranked.length === 0) throw codexSlotError('AGENT_UNAVAILABLE');
  return ranked;
}

export function rankCodexSlotAgents(registryRows, capacitySnapshot) {
  const capacities = new Map((capacitySnapshot?.agents || [])
    .map(capacity => [capacity.server_id, capacity]));
  const candidates = registryRows.flatMap(machine => {
    const metadata = machine.metadata || {};
    const fleetId = metadata.fleet_id;
    const capacity = capacities.get(fleetId);
    if (!['xian-m1', 'xian-m4'].includes(metadata.agent_id)
        || typeof fleetId !== 'string'
        || metadata.root_attested !== true
        || !metadata.mmv_stable_node_id
        || !Array.isArray(metadata.mmv_allowed_ips) || metadata.mmv_allowed_ips.length < 1
        || capacity?.fresh !== true
        || !Number.isInteger(capacity.available) || capacity.available < 1) {
      return [];
    }
    return [{ agent_id: metadata.agent_id, available: capacity.available,
      fleet_id: fleetId, machine_registry_name: machine.name }];
  });
  candidates.sort((a, b) => b.available - a.available || a.agent_id.localeCompare(b.agent_id));
  return candidates;
}

async function selectAgent(client, dependencies) {
  if (dependencies.selectAgent) return dependencies.selectAgent(client);

  const registry = await client.query(
    `SELECT name, location, metadata
       FROM system_registry
      WHERE type = 'machine'
        AND status = 'active'
        AND metadata->>'agent_id' IN ('xian-m1', 'xian-m4')`,
  );
  const { getCodexCapacitySnapshot } = await import('./slot-allocator.js');
  const capacity = getCodexCapacitySnapshot();
  const candidates = rankCodexSlotAgents(registry.rows, capacity);
  if (candidates.length === 0) throw codexSlotError('AGENT_UNAVAILABLE');
  return candidates[0].agent_id;
}

export function getCodexSlotSsotMetadata() {
  return { capacity_source: 'fleet-resource-cache', concurrency_source: 'slot-allocator',
    identity_source: 'system_registry', ttl: getCodexSlotTtls() };
}

async function runFaultHook(dependencies, boundary, context) {
  if (typeof dependencies.faultHook === 'function') {
    await dependencies.faultHook(boundary, context);
  }
  if (process.env.CODEX_SLOT_FAULT_PROCESS_CRASH === '1'
      && process.env.CODEX_SLOT_FAULT_BOUNDARY === boundary) {
    process.kill(process.pid, 'SIGKILL');
  }
}

function mapDurabilityError(error) {
  if (error instanceof CodexSlotError) return error;
  if (error?.code === '23505'
      && String(error.constraint || '').includes('blocking_account')) {
    return codexSlotError('ACCOUNT_BUSY', error);
  }
  return codexSlotError('DURABILITY_FAILED', error);
}

export async function acquireCodexSlot(input, dependencies = {}) {
  validateAcquireRequest(input);
  const database = dependencies.pool || pool;
  const client = await database.connect();
  try {
    for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
      let committed = false;
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const identity = await resolveIdentity(client, input.identityKind, input.identityRef);
        await assertRolloutOpen(client, identity.tenant_id);

        const replay = await loadReplay(
          client,
          identity.tenant_id,
          identity.actor_id,
          input.idempotencyKey,
        );
        if (replay) {
          await client.query('COMMIT');
          committed = true;
          return { public: sessionResponse(replay), receipt: replay.receipt, replay: true };
        }

        const rankedAccounts = await selectAccountRef(client);
        const agentId = await selectAgent(client, dependencies);
        const leaseId = randomUUID();
        const sessionId = randomUUID();
        const receipt = randomUUID();
        const handle = `${identity.actor_id}/${input.body.project}/${input.body.name}`;

        let insertedLease = false;
        let accountRef = null;
        for (const account of rankedAccounts) {
          const inserted = await client.query(
            `INSERT INTO codex_slot_leases
               (id, tenant_id, actor_id, identity_id, request_id, account_ref, agent_id, state)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              leaseId,
              identity.tenant_id,
              identity.actor_id,
              identity.id,
              input.idempotencyKey,
              account.account_ref,
              agentId,
            ],
          );
          if (inserted.rowCount === 1) {
            insertedLease = true;
            accountRef = account.account_ref;
            break;
          }
        }
        if (!insertedLease) throw codexSlotError('ACCOUNT_BUSY');
        await runFaultHook(dependencies, 'after-lease-write', { leaseId, sessionId });

        await client.query(
          `INSERT INTO codex_slot_sessions
             (id, lease_id, tenant_id, actor_id, request_id, agent_id, handle, receipt, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'running')`,
          [
            sessionId,
            leaseId,
            identity.tenant_id,
            identity.actor_id,
            input.idempotencyKey,
            agentId,
            handle,
            receipt,
          ],
        );
        await runFaultHook(dependencies, 'after-session-write', { leaseId, sessionId });

        await client.query(
          `INSERT INTO codex_slot_audit_events
             (tenant_id, actor_id, request_id, lease_id, session_id, event_type, payload)
           VALUES ($1, $2, $3, $4, $5, 'acquired', $6::jsonb)`,
          [
            identity.tenant_id,
            identity.actor_id,
            input.idempotencyKey,
            leaseId,
            sessionId,
            JSON.stringify({ account_ref: accountRef, agent_id: agentId }),
          ],
        );
        await runFaultHook(dependencies, 'after-audit-write', { leaseId, sessionId });
        await runFaultHook(dependencies, 'before-commit', { leaseId, sessionId });
        await client.query('COMMIT');
        committed = true;
        await runFaultHook(dependencies, 'after-commit-before-response', { leaseId, sessionId });

        return {
          public: sessionResponse({
            agent_id: agentId,
            handle,
            lease_id: leaseId,
            session_id: sessionId,
          }),
          receipt,
          replay: false,
        };
      } catch (error) {
        if (!committed) await client.query('ROLLBACK').catch(() => {});
        if (!committed
            && error?.code === '40001'
            && attempt < MAX_SERIALIZATION_ATTEMPTS) {
          continue;
        }
        if (error?.code === '23505'
            || error?.code === '40001'
            || error?.code === 'ACCOUNT_BUSY'
            || error?.code === 'DURABILITY_FAILED') {
          try {
            const identity = await resolveIdentity(client, input.identityKind, input.identityRef);
            const replay = await loadReplay(
              client,
              identity.tenant_id,
              identity.actor_id,
              input.idempotencyKey,
            );
            if (replay) {
              return { public: sessionResponse(replay), receipt: replay.receipt, replay: true };
            }
          } catch {
            // Preserve the finite public error matrix below.
          }
        }
        throw mapDurabilityError(error);
      }
    }
    throw codexSlotError('DURABILITY_FAILED');
  } finally {
    client.release();
  }
}

export async function stopCodexSlot(input, dependencies = {}) {
  validateStopRequest(input);
  const database = dependencies.pool || pool;
  const client = await database.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const identity = await resolveIdentity(client, input.identityKind, input.identityRef);
    const found = await client.query(
      `SELECT s.id AS session_id, s.lease_id, s.handle, s.status, s.cleanup
         FROM codex_slot_sessions s
        WHERE s.id = $1
          AND s.tenant_id = $2
          AND s.actor_id = $3
        FOR UPDATE`,
      [input.sessionId, identity.tenant_id, identity.actor_id],
    );
    const session = found.rows[0];
    if (!session) throw codexSlotError('FORBIDDEN_IDENTITY');
    if (session.status === 'stopped') {
      await client.query('COMMIT');
      return stoppedSessionResponse(session);
    }

    if (typeof dependencies.cleanupSession !== 'function') {
      throw codexSlotError('AGENT_UNAVAILABLE');
    }
    const cleanup = await dependencies.cleanupSession(session);
    if (cleanup.auth_absent !== true || cleanup.temp_absent !== true || cleanup.tmux_absent !== true) {
      throw codexSlotError('DURABILITY_FAILED');
    }

    await client.query(
      `UPDATE codex_slot_sessions
          SET status = 'stopped',
              cleanup = $2::jsonb,
              stopped_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [session.session_id, JSON.stringify({ ...cleanup, lease_state: 'released' })],
    );
    const released = await client.query(
      `UPDATE codex_slot_leases
          SET state = 'released', released_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND state <> 'released'
        RETURNING id`,
      [session.lease_id],
    );
    if (released.rowCount === 1) {
      await client.query(
        `INSERT INTO codex_slot_audit_events
           (tenant_id, actor_id, request_id, lease_id, session_id, event_type, payload)
         SELECT tenant_id, actor_id, request_id, lease_id, id, event_type, '{}'::jsonb
           FROM codex_slot_sessions
          CROSS JOIN (VALUES ('lease_released'), ('session_stopped')) AS e(event_type)
          WHERE id = $1`,
        [session.session_id],
      );
    }
    await client.query('COMMIT');
    return stoppedSessionResponse({
      ...session,
      status: 'stopped',
      cleanup: { ...cleanup, lease_state: 'released' },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapDurabilityError(error);
  } finally {
    client.release();
  }
}

export async function reapCodexSlots(dependencies = {}) {
  if (dependencies.reapSessions) return dependencies.reapSessions();
  const database = dependencies.pool || pool;
  const checked = await database.query(
    `SELECT count(*)::int AS count
       FROM codex_slot_sessions
      WHERE status IN ('running', 'stopping', 'quarantined', 'blocked')`,
  );
  return {
    checked: Number(checked.rows[0]?.count || 0),
    heartbeat_updated: 0,
    quarantined: 0,
    released: 0,
  };
}
