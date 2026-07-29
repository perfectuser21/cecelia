import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  createPostgresGrantExecutionAuthority,
} from '../kernel-equivalence-grant-execution-authority.js';
import {
  canonicalJson,
  sha256Canonical,
} from '../kernel-equivalence-receipts.js';

const ACTOR_INSTANCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CASE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_GRANT_ID = '99999999-9999-4999-8999-999999999999';
const NONCE = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const GRANT_REF = `kernel-equivalence-grant:${GRANT_ID}`;

function grantFixture() {
  return {
    adapter_id: 'branch-protection-adapter',
    artifact_sha: 'a'.repeat(40),
    attempt_id: ATTEMPT_ID,
    behavior_id: 'branch-protection',
    brain_version: '1.268.29',
    cell_id: 'KERNEL-P0-01-BRANCH-PROTECTION::codex::normal',
    engine_version: '1.0.0',
    environment: 'isolated',
    expires_at: '2099-07-29T12:00:00.000Z',
    grant_id: GRANT_ID,
    issued_at: '2099-07-29T11:55:00.000Z',
    key_id: 'authority-2026-07',
    nonce: NONCE,
    provider: 'codex',
    resource_id: 'branch-protection-sandbox',
    resource_prefix: 'kernel-equivalence/run/attempt/',
    resource_ref: 'kernel-equivalence/run/attempt/branch-protection',
    run_id: RUN_ID,
    scenario: 'normal',
    schema_version: 'kernel-equivalence-execution-grant/v1',
    scopes: ['isolated_effect'],
    seam_id: 'branch-protection-seam',
    signature: 'signed-grant',
  };
}

function clientFixture(query) {
  return {
    query: vi.fn(query),
    release: vi.fn(),
  };
}

function expectedLockKey() {
  return createHash('sha256')
    .update(GRANT_ID, 'utf8')
    .digest()
    .readBigInt64BE(0)
    .toString();
}

function activeRow(grantSha256) {
  return {
    grant_id: GRANT_ID,
    grant_ref: GRANT_REF,
    grant_sha256: grantSha256,
    cell_id: grantFixture().cell_id,
    expires_at: grantFixture().expires_at,
    active: true,
    grant: grantFixture(),
  };
}

function anchorRow(grantSha256) {
  const { active: _active, grant: _grant, ...anchor } =
    activeRow(grantSha256);
  return anchor;
}

function eventRow(state, generation = 1) {
  return {
    grant_id: GRANT_ID,
    generation,
    state,
    actor_instance_id: ACTOR_INSTANCE_ID,
    actor_kind: state === 'published' ? 'controller' : 'runtime',
    occurred_at: '2026-07-29T07:00:00.000Z',
  };
}

describe('PostgreSQL grant execution authority', () => {
  it('rejects a factory lock timeout above the supported maximum', () => {
    expect(() => createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn() },
      actorInstanceId: ACTOR_INSTANCE_ID,
      lockTimeoutMs: 300_001,
    })).toThrowError(expect.objectContaining({
      code: 'grant_authority_configuration_invalid',
    }));
  });

  it('registers an exact pending signed grant on one dedicated transaction client', async () => {
    const grant = grantFixture();
    const grantSha256 = sha256Canonical(grant);
    const dbAnchor = {
      ...anchorRow(grantSha256),
      expires_at: new Date(grant.expires_at),
    };
    const client = clientFixture(async (sql, parameters) => {
      const call = client.query.mock.calls.length;
      if (call === 1) {
        expect(sql).toBe('BEGIN');
        expect(parameters).toBeUndefined();
        return { rows: [] };
      }
      if (call === 2) {
        expect(sql).toMatch(/kernel_equivalence_register_grant_authority/);
        expect(parameters).toEqual([
          CASE_ID,
          JSON.stringify(grant),
          grantSha256,
        ]);
        return {
          rowCount: 1,
          rows: [dbAnchor],
        };
      }
      expect(call).toBe(3);
      expect(sql).toBe('COMMIT');
      expect(parameters).toBeUndefined();
      return { rows: [] };
    });
    const pool = { connect: vi.fn(async () => client) };
    const authority = createPostgresGrantExecutionAuthority({
      pool,
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.keys(authority).sort()).toEqual([
      'consumeNonceIfActive',
      'invokeWhileActive',
      'markGrantPublished',
      'registerPendingGrant',
      'resolveActiveGrant',
      'revokeGrant',
    ]);
    await expect(authority.registerPendingGrant({
      case_id: CASE_ID,
      grant,
      grant_sha256: grantSha256,
    })).resolves.toEqual({
      ...dbAnchor,
    });
    expect(pool.connect).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rejects Date objects instead of hashing them differently from JSON wire', async () => {
    const grant = {
      ...grantFixture(),
      issued_at: new Date(grantFixture().issued_at),
    };
    const pool = { connect: vi.fn() };
    const authority = createPostgresGrantExecutionAuthority({
      pool,
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.registerPendingGrant({
      case_id: CASE_ID,
      grant,
      grant_sha256: sha256Canonical(grant),
    })).rejects.toMatchObject({
      code: 'grant_registration_invalid',
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('snapshots nested grant bytes before register awaits a connection', async () => {
    const grant = grantFixture();
    const originalGrant = structuredClone(grant);
    const grantSha256 = sha256Canonical(originalGrant);
    let finishConnect;
    const connectBarrier = new Promise((resolve) => {
      finishConnect = resolve;
    });
    const client = clientFixture(async (sql, parameters) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      expect(sql).toMatch(/kernel_equivalence_register_grant_authority/);
      expect(parameters).toEqual([
        CASE_ID,
        canonicalJson(originalGrant),
        grantSha256,
      ]);
      return {
        rowCount: 1,
        rows: [anchorRow(grantSha256)],
      };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: {
        connect: vi.fn(async () => {
          await connectBarrier;
          return client;
        }),
      },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    const registration = authority.registerPendingGrant({
      case_id: CASE_ID,
      grant,
      grant_sha256: grantSha256,
    });
    grant.cell_id = 'KERNEL-P0-02-CREDENTIAL-GUARD::codex::normal';
    grant.signature = 'mutated-after-call';
    finishConnect();

    await expect(registration).resolves.toMatchObject({
      grant_id: GRANT_ID,
      grant_sha256: grantSha256,
      cell_id: originalGrant.cell_id,
    });
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('publishes and resolves only the exact UUID/SHA/cell DB authority', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const cellId = grantFixture().cell_id;
    const client = clientFixture(async (sql, parameters) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (/kernel_equivalence_append_grant_event/.test(sql)) {
        expect(parameters).toEqual([
          GRANT_ID,
          grantSha256,
          'published',
          ACTOR_INSTANCE_ID,
          JSON.stringify({}),
        ]);
        return {
          rowCount: 1,
          rows: [eventRow('published')],
        };
      }
      expect(sql).toMatch(/kernel_equivalence_resolve_active_grant/);
      expect(parameters).toEqual([GRANT_ID, grantSha256, cellId]);
      return { rowCount: 1, rows: [activeRow(grantSha256)] };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.markGrantPublished({
      grant_id: GRANT_ID,
      grant_sha256: grantSha256,
    })).resolves.toEqual({
      ...eventRow('published'),
    });
    await expect(authority.resolveActiveGrant({
      grant_id: GRANT_ID,
      grant_sha256: grantSha256,
      cell_id: cellId,
    })).resolves.toEqual(activeRow(grantSha256));
    expect(client.release).toHaveBeenCalledTimes(2);
  });

  it.each(['register', 'publish'])(
    'destroys the client when %s COMMIT outcome is uncertain',
    async (operation) => {
      const grant = grantFixture();
      const grantSha256 = sha256Canonical(grant);
      const commitFailure = Object.assign(
        new Error('connection ended during COMMIT'),
        { code: '08006' },
      );
      const client = clientFixture(async (sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
        if (/kernel_equivalence_register_grant_authority/.test(sql)) {
          return { rowCount: 1, rows: [anchorRow(grantSha256)] };
        }
        if (/kernel_equivalence_append_grant_event/.test(sql)) {
          return { rowCount: 1, rows: [eventRow('published')] };
        }
        if (sql === 'COMMIT') throw commitFailure;
        throw new Error(`unexpected query: ${sql}`);
      });
      const authority = createPostgresGrantExecutionAuthority({
        pool: { connect: vi.fn(async () => client) },
        actorInstanceId: ACTOR_INSTANCE_ID,
      });

      const promise = operation === 'register'
        ? authority.registerPendingGrant({
          case_id: CASE_ID,
          grant,
          grant_sha256: grantSha256,
        })
        : authority.markGrantPublished({
          grant_id: GRANT_ID,
          grant_sha256: grantSha256,
        });
      await expect(promise).rejects.toMatchObject({
        code: 'grant_transaction_outcome_unknown',
        disposition: 'effect_unknown',
        safe_no_effect: false,
        effect_possible: true,
      });
      expect(client.release).toHaveBeenCalledOnce();
      expect(client.release).toHaveBeenCalledWith(true);
    },
  );

  it('destroys a generic transaction when ROLLBACK is not confirmed', async () => {
    const grant = grantFixture();
    const grantSha256 = sha256Canonical(grant);
    const client = clientFixture(async (sql) => {
      if (sql === 'BEGIN') return { rows: [] };
      if (/kernel_equivalence_register_grant_authority/.test(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (sql === 'ROLLBACK') {
        throw new Error('connection ended during ROLLBACK');
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.registerPendingGrant({
      case_id: CASE_ID,
      grant,
      grant_sha256: grantSha256,
    })).rejects.toMatchObject({
      code: 'grant_rollback_outcome_unknown',
      disposition: 'effect_unknown',
      safe_no_effect: false,
      effect_possible: true,
    });
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('rejects malformed signed-grant identity before registration connects', async () => {
    const grant = {
      ...grantFixture(),
      attempt_id: 'not-a-uuid',
    };
    const pool = { connect: vi.fn() };
    const authority = createPostgresGrantExecutionAuthority({
      pool,
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.registerPendingGrant({
      case_id: CASE_ID,
      grant,
      grant_sha256: sha256Canonical(grant),
    })).rejects.toMatchObject({ code: 'grant_registration_invalid' });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('requires the exact 23-field signed grant shape at every execution seam', async () => {
    const grant = {
      ...grantFixture(),
      caller_controlled: true,
    };
    const pool = { connect: vi.fn() };
    const authority = createPostgresGrantExecutionAuthority({
      pool,
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.consumeNonceIfActive({
      grant,
    })).rejects.toMatchObject({ code: 'grant_authority_request_invalid' });
    await expect(authority.invokeWhileActive({
      grant,
      invoke: vi.fn(),
    })).rejects.toMatchObject({ code: 'grant_authority_request_invalid' });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('fails closed on malformed identity and mismatched DB revalidation', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const cellId = grantFixture().cell_id;
    const invalidPool = { connect: vi.fn() };
    const invalidAuthority = createPostgresGrantExecutionAuthority({
      pool: invalidPool,
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(invalidAuthority.resolveActiveGrant({
      grant_id: GRANT_ID,
      grant_sha256: grantSha256.toUpperCase(),
      cell_id: cellId,
    })).rejects.toMatchObject({ code: 'grant_authority_request_invalid' });
    expect(invalidPool.connect).not.toHaveBeenCalled();

    const client = clientFixture(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      return {
        rowCount: 1,
        rows: [{
          ...activeRow(grantSha256),
          expires_at: '2098-07-29T12:00:00.000Z',
        }],
      };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.resolveActiveGrant({
      grant_id: GRANT_ID,
      grant_sha256: grantSha256,
      cell_id: cellId,
    })).rejects.toMatchObject({ code: 'grant_authority_revalidation_failed' });
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringMatching(/kernel_equivalence_resolve_active_grant/),
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('consumes a nonce only while holding the per-grant shared session lock', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const cellId = grantFixture().cell_id;
    const order = [];
    const client = clientFixture(async (sql, parameters) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') {
        order.push(sql.toLowerCase());
        return { rows: [] };
      }
      if (/set_config\('statement_timeout'/.test(sql)) {
        order.push('timeout');
        expect(parameters).toEqual(['1500ms']);
        return { rows: [] };
      }
      if (/pg_advisory_lock_shared/.test(sql)) {
        order.push('lock_shared');
        expect(parameters).toEqual([expectedLockKey()]);
        return { rows: [] };
      }
      if (/kernel_equivalence_resolve_active_grant/.test(sql)) {
        order.push('resolve');
        return { rowCount: 1, rows: [activeRow(grantSha256)] };
      }
      if (/INSERT INTO kernel_equivalence_execution_nonces/.test(sql)) {
        order.push('nonce');
        expect(sql).toMatch(/clock_timestamp\(\)[\s\S]+ON CONFLICT DO NOTHING/);
        expect(parameters.slice(0, 6)).toEqual([
          GRANT_ID,
          NONCE,
          cellId,
          RUN_ID,
          ATTEMPT_ID,
          grantFixture().expires_at,
        ]);
        expect(parameters[6]).toEqual(expect.any(Number));
        return {
          rowCount: 1,
          rows: [{ grant_id: GRANT_ID }],
        };
      }
      expect(sql).toMatch(/pg_advisory_unlock_shared/);
      order.push('unlock_shared');
      expect(parameters).toEqual([expectedLockKey()]);
      return { rowCount: 1, rows: [{ unlocked: true }] };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.consumeNonceIfActive({
      grant: grantFixture(),
      timeoutMs: 1_500,
    })).resolves.toEqual({
      consumed: true,
    });
    expect(order).toEqual([
      'begin',
      'timeout',
      'lock_shared',
      'resolve',
      'nonce',
      'commit',
      'unlock_shared',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('preserves the nonce consumer contract when an exact nonce is already used', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const client = clientFixture(async (sql) => {
      if (
        sql === 'BEGIN'
        || sql === 'COMMIT'
        || /set_config\('statement_timeout'/.test(sql)
        || /pg_advisory_lock_shared/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/kernel_equivalence_resolve_active_grant/.test(sql)) {
        return { rowCount: 1, rows: [activeRow(grantSha256)] };
      }
      if (/kernel_equivalence_execution_nonces/.test(sql)) {
        if (/INSERT INTO/.test(sql)) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [{
            grant_id: GRANT_ID,
            nonce: NONCE,
            cell_id: grantFixture().cell_id,
            run_id: RUN_ID,
            attempt_id: ATTEMPT_ID,
            expires_at: new Date(grantFixture().expires_at),
          }],
        };
      }
      return { rowCount: 1, rows: [{ unlocked: true }] };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.consumeNonceIfActive({
      grant: grantFixture(),
    })).resolves.toEqual({ consumed: false });
    expect(client.query.mock.calls.some(
      ([sql]) => /kernel_equivalence_append_grant_event/.test(sql),
    )).toBe(false);
    expect(client.query.mock.calls.some(
      ([sql]) => /SELECT grant_id, nonce, cell_id/.test(sql),
    )).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('fails closed when nonce INSERT returns zero without an exact conflict', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const client = clientFixture(async (sql) => {
      if (
        sql === 'BEGIN'
        || sql === 'ROLLBACK'
        || /set_config\('statement_timeout'/.test(sql)
        || /pg_advisory_lock_shared/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/kernel_equivalence_resolve_active_grant/.test(sql)) {
        return { rowCount: 1, rows: [activeRow(grantSha256)] };
      }
      if (/INSERT INTO kernel_equivalence_execution_nonces/.test(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (/SELECT grant_id, nonce, cell_id/.test(sql)) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [{ unlocked: true }] };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.consumeNonceIfActive({
      grant: grantFixture(),
    })).rejects.toMatchObject({
      code: 'grant_nonce_consumption_failed',
    });
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringMatching(/set_config/),
      expect.stringMatching(/pg_advisory_lock_shared/),
      expect.stringMatching(/kernel_equivalence_resolve_active_grant/),
      expect.stringMatching(/INSERT INTO kernel_equivalence_execution_nonces/),
      expect.stringMatching(/SELECT grant_id, nonce, cell_id/),
      'ROLLBACK',
      expect.stringMatching(/pg_advisory_unlock_shared/),
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rejects a pre-aborted nonce request before opening a DB session', async () => {
    const pool = { connect: vi.fn() };
    const authority = createPostgresGrantExecutionAuthority({
      pool,
      actorInstanceId: ACTOR_INSTANCE_ID,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(authority.consumeNonceIfActive({
      grant: grantFixture(),
      signal: controller.signal,
    })).rejects.toMatchObject({
      code: 'grant_nonce_consumption_aborted',
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('destroys the locked session when nonce cancellation arrives after revalidation', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const controller = new AbortController();
    const order = [];
    const client = clientFixture(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') {
        order.push(sql.toLowerCase());
        return { rows: [] };
      }
      if (
        /set_config\('statement_timeout'/.test(sql)
        || /pg_advisory_lock_shared/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/kernel_equivalence_resolve_active_grant/.test(sql)) {
        order.push('resolve');
        controller.abort();
        return { rowCount: 1, rows: [activeRow(grantSha256)] };
      }
      if (/kernel_equivalence_execution_nonces/.test(sql)) {
        order.push('nonce');
        return { rowCount: 1, rows: [{ grant_id: GRANT_ID }] };
      }
      order.push('unlock');
      return { rowCount: 1, rows: [{ unlocked: true }] };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.consumeNonceIfActive({
      grant: grantFixture(),
      signal: controller.signal,
    })).rejects.toMatchObject({
      code: 'grant_nonce_consumption_aborted',
    });
    expect(order).toEqual(['begin', 'resolve']);
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('fails closed and destroys the client when abort races after nonce COMMIT', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const controller = new AbortController();
    const client = clientFixture(async (sql) => {
      if (
        sql === 'BEGIN'
        || /set_config\('statement_timeout'/.test(sql)
        || /pg_advisory_lock_shared/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/kernel_equivalence_resolve_active_grant/.test(sql)) {
        return { rowCount: 1, rows: [activeRow(grantSha256)] };
      }
      if (/INSERT INTO kernel_equivalence_execution_nonces/.test(sql)) {
        return { rowCount: 1, rows: [{ grant_id: GRANT_ID }] };
      }
      if (sql === 'COMMIT') {
        controller.abort();
        return { rows: [] };
      }
      return { rowCount: 1, rows: [{ unlocked: true }] };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.consumeNonceIfActive({
      grant: grantFixture(),
      signal: controller.signal,
    })).rejects.toMatchObject({
      code: 'grant_nonce_cancellation_unconfirmed',
    });
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledWith(true);
    expect(client.query.mock.calls.some(
      ([sql]) => /pg_advisory_unlock_shared/.test(sql),
    )).toBe(false);
  });

  it('fails closed when abort arrives while post-COMMIT shared unlock awaits', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const controller = new AbortController();
    let announceUnlock;
    let finishUnlock;
    const unlockStarted = new Promise((resolve) => {
      announceUnlock = resolve;
    });
    const unlockBarrier = new Promise((resolve) => {
      finishUnlock = resolve;
    });
    const client = clientFixture(async (sql) => {
      if (
        sql === 'BEGIN'
        || sql === 'COMMIT'
        || /set_config\('statement_timeout'/.test(sql)
        || /pg_advisory_lock_shared/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/kernel_equivalence_resolve_active_grant/.test(sql)) {
        return { rowCount: 1, rows: [activeRow(grantSha256)] };
      }
      if (/INSERT INTO kernel_equivalence_execution_nonces/.test(sql)) {
        return { rowCount: 1, rows: [{ grant_id: GRANT_ID }] };
      }
      if (/pg_advisory_unlock_shared/.test(sql)) {
        announceUnlock();
        await unlockBarrier;
        return { rowCount: 1, rows: [{ unlocked: true }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    const consumption = authority.consumeNonceIfActive({
      grant: grantFixture(),
      signal: controller.signal,
    });
    await unlockStarted;
    controller.abort();
    finishUnlock();

    await expect(consumption).rejects.toMatchObject({
      code: 'grant_nonce_cancellation_unconfirmed',
      disposition: 'effect_unknown',
      safe_no_effect: false,
      effect_possible: true,
    });
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('does not double-release when aborted unlock later rejects', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const controller = new AbortController();
    let announceUnlock;
    let rejectUnlock;
    const unlockStarted = new Promise((resolve) => {
      announceUnlock = resolve;
    });
    const unlockBarrier = new Promise((_resolve, reject) => {
      rejectUnlock = reject;
    });
    const client = clientFixture(async (sql) => {
      if (
        sql === 'BEGIN'
        || sql === 'COMMIT'
        || /set_config\('statement_timeout'/.test(sql)
        || /pg_advisory_lock_shared/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/kernel_equivalence_resolve_active_grant/.test(sql)) {
        return { rowCount: 1, rows: [activeRow(grantSha256)] };
      }
      if (/INSERT INTO kernel_equivalence_execution_nonces/.test(sql)) {
        return { rowCount: 1, rows: [{ grant_id: GRANT_ID }] };
      }
      if (/pg_advisory_unlock_shared/.test(sql)) {
        announceUnlock();
        await unlockBarrier;
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    client.release.mockImplementation(() => {
      if (client.release.mock.calls.length > 1) {
        throw new Error('Release called on client which has already been released');
      }
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    const consumption = authority.consumeNonceIfActive({
      grant: grantFixture(),
      signal: controller.signal,
    });
    await unlockStarted;
    controller.abort();
    rejectUnlock(new Error('socket destroyed during unlock'));

    await expect(consumption).rejects.toMatchObject({
      disposition: 'effect_unknown',
      safe_no_effect: false,
      effect_possible: true,
    });
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('commits durable intent before invoke and records completion before shared unlock', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const cellId = grantFixture().cell_id;
    const order = [];
    let transaction = 0;
    const client = clientFixture(async (sql, parameters) => {
      if (sql === 'BEGIN') {
        transaction += 1;
        order.push(`begin:${transaction}`);
        return { rows: [] };
      }
      if (sql === 'COMMIT') {
        order.push(`commit:${transaction}`);
        return { rows: [] };
      }
      if (/set_config\('statement_timeout'/.test(sql)) {
        order.push('timeout');
        expect(parameters).toEqual(['1500ms']);
        return { rows: [] };
      }
      if (/pg_advisory_lock_shared/.test(sql)) {
        order.push('lock_shared');
        return { rows: [] };
      }
      if (/kernel_equivalence_resolve_active_grant/.test(sql)) {
        order.push('resolve');
        return { rowCount: 1, rows: [activeRow(grantSha256)] };
      }
      if (/kernel_equivalence_append_grant_event/.test(sql)) {
        const state = parameters[2];
        order.push(state);
        if (state !== 'execution_intent') {
          expect(JSON.parse(parameters[4])).toEqual({
            intent_generation: 3,
          });
        }
        return {
          rowCount: 1,
          rows: [eventRow(
            state,
            state === 'execution_intent' ? 3 : 4,
          )],
        };
      }
      expect(sql).toMatch(/pg_advisory_unlock_shared/);
      order.push('unlock_shared');
      return { rowCount: 1, rows: [{ unlocked: true }] };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });
    const invoke = vi.fn(async (signal) => {
      order.push('invoke');
      expect(signal).toBeNull();
      return { receipt_id: 'effect-receipt' };
    });

    await expect(authority.invokeWhileActive({
      grant: grantFixture(),
      invoke,
      timeoutMs: 1_500,
    })).resolves.toEqual({
      grant_ref: GRANT_REF,
      disposition: 'effect_completed',
      result: { receipt_id: 'effect-receipt' },
    });
    expect(order).toEqual([
      'begin:1',
      'timeout',
      'lock_shared',
      'resolve',
      'execution_intent',
      'commit:1',
      'invoke',
      'begin:2',
      'timeout',
      'effect_completed',
      'commit:2',
      'unlock_shared',
    ]);
    expect(invoke).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('treats an ordinary signal abort as effect_unknown and passes stable context', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const cellId = grantFixture().cell_id;
    const states = [];
    const client = clientFixture(async (sql, parameters) => {
      if (
        sql === 'BEGIN'
        || sql === 'COMMIT'
        || /set_config\('statement_timeout'/.test(sql)
        || /pg_advisory_lock_shared/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/kernel_equivalence_resolve_active_grant/.test(sql)) {
        return { rowCount: 1, rows: [activeRow(grantSha256)] };
      }
      if (/kernel_equivalence_append_grant_event/.test(sql)) {
        states.push(parameters[2]);
        return {
          rowCount: 1,
          rows: [eventRow(parameters[2], states.length + 2)],
        };
      }
      return { rowCount: 1, rows: [{ unlocked: true }] };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });
    const controller = new AbortController();
    controller.abort();
    const invoke = vi.fn(async (signal) => {
      expect(signal).toBe(controller.signal);
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });

    await expect(authority.invokeWhileActive({
      grant: grantFixture(),
      invoke,
      signal: controller.signal,
    })).rejects.toMatchObject({
      code: 'grant_effect_unknown',
      disposition: 'effect_unknown',
      safe_no_effect: false,
      effect_possible: true,
    });
    expect(states).toEqual(['execution_intent', 'effect_unknown']);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('records effect_unknown and never reports safe_no_effect when invoke throws', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const cellId = grantFixture().cell_id;
    const states = [];
    const client = clientFixture(async (sql, parameters) => {
      if (
        sql === 'BEGIN'
        || sql === 'COMMIT'
        || /set_config\('statement_timeout'/.test(sql)
        || /pg_advisory_lock_shared/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/kernel_equivalence_resolve_active_grant/.test(sql)) {
        return { rowCount: 1, rows: [activeRow(grantSha256)] };
      }
      if (/kernel_equivalence_append_grant_event/.test(sql)) {
        states.push(parameters[2]);
        return {
          rowCount: 1,
          rows: [eventRow(parameters[2], states.length + 2)],
        };
      }
      return { rowCount: 1, rows: [{ unlocked: true }] };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.invokeWhileActive({
      grant: grantFixture(),
      invoke: async () => {
        throw new Error('transport ended after dispatch');
      },
    })).rejects.toMatchObject({
      code: 'grant_effect_unknown',
      disposition: 'effect_unknown',
      safe_no_effect: false,
      effect_possible: true,
    });
    expect(states).toEqual(['execution_intent', 'effect_unknown']);
    expect(client.query.mock.calls.at(-1)[0]).toMatch(
      /pg_advisory_unlock_shared/,
    );
  });

  it('records aborted_before_effect only for an explicit pre-effect callback failure', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const states = [];
    const client = clientFixture(async (sql, parameters) => {
      if (
        sql === 'BEGIN'
        || sql === 'COMMIT'
        || /set_config\('statement_timeout'/.test(sql)
        || /pg_advisory_lock_shared/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/kernel_equivalence_resolve_active_grant/.test(sql)) {
        return { rowCount: 1, rows: [activeRow(grantSha256)] };
      }
      if (/kernel_equivalence_append_grant_event/.test(sql)) {
        states.push(parameters[2]);
        return {
          rowCount: 1,
          rows: [eventRow(parameters[2], states.length + 2)],
        };
      }
      return { rowCount: 1, rows: [{ unlocked: true }] };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.invokeWhileActive({
      grant: grantFixture(),
      invoke: async () => {
        throw Object.assign(new Error('dispatch rejected locally'), {
          effectStarted: false,
        });
      },
    })).rejects.toMatchObject({
      code: 'grant_effect_aborted_before_effect',
      disposition: 'aborted_before_effect',
      safe_no_effect: true,
      effect_possible: false,
    });
    expect(states).toEqual([
      'execution_intent',
      'aborted_before_effect',
    ]);
  });

  it('upgrades a safe callback failure to unknown when shared unlock is uncertain', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const client = clientFixture(async (sql, parameters) => {
      if (
        sql === 'BEGIN'
        || sql === 'COMMIT'
        || /set_config\('statement_timeout'/.test(sql)
        || /pg_advisory_lock_shared/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/kernel_equivalence_resolve_active_grant/.test(sql)) {
        return { rowCount: 1, rows: [activeRow(grantSha256)] };
      }
      if (/kernel_equivalence_append_grant_event/.test(sql)) {
        return {
          rowCount: 1,
          rows: [eventRow(parameters[2], parameters[2] ===
            'execution_intent' ? 3 : 4)],
        };
      }
      if (/pg_advisory_unlock_shared/.test(sql)) {
        throw new Error('unlock connection lost');
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.invokeWhileActive({
      grant: grantFixture(),
      invoke: async () => {
        throw Object.assign(new Error('local rejection'), {
          effectStarted: false,
        });
      },
    })).rejects.toMatchObject({
      code: 'grant_unlock_outcome_unknown',
      disposition: 'effect_unknown',
      safe_no_effect: false,
      effect_possible: true,
    });
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('destroys an intent COMMIT-uncertain client without invoking the effect', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const commitFailure = Object.assign(
      new Error('connection ended during COMMIT'),
      { code: '08006' },
    );
    const client = clientFixture(async (sql, parameters) => {
      if (
        sql === 'BEGIN'
        || /set_config\('statement_timeout'/.test(sql)
        || /pg_advisory_lock_shared/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/kernel_equivalence_resolve_active_grant/.test(sql)) {
        return { rowCount: 1, rows: [activeRow(grantSha256)] };
      }
      if (/kernel_equivalence_append_grant_event/.test(sql)) {
        return {
          rowCount: 1,
          rows: [eventRow(parameters[2], 3)],
        };
      }
      if (sql === 'COMMIT') throw commitFailure;
      throw new Error(`unexpected query: ${sql}`);
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });
    const invoke = vi.fn();

    await expect(authority.invokeWhileActive({
      grant: grantFixture(),
      invoke,
    })).rejects.toMatchObject({
      disposition: 'effect_unknown',
      safe_no_effect: false,
      effect_possible: true,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledWith(true);
    expect(client.query.mock.calls.some(
      ([sql]) => /pg_advisory_unlock_shared/.test(sql),
    )).toBe(false);
  });

  it('keeps revoke bound to lock A when caller mutates input to grant B', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    let announceLock;
    let finishLock;
    const lockStarted = new Promise((resolve) => {
      announceLock = resolve;
    });
    const lockBarrier = new Promise((resolve) => {
      finishLock = resolve;
    });
    const client = clientFixture(async (sql, parameters) => {
      if (
        sql === 'BEGIN'
        || sql === 'COMMIT'
        || /set_config\('statement_timeout'/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/pg_advisory_lock\(/.test(sql)) {
        expect(parameters).toEqual([expectedLockKey()]);
        announceLock();
        await lockBarrier;
        return { rows: [] };
      }
      if (/kernel_equivalence_revoke_grant/.test(sql)) {
        expect(parameters).toEqual([
          GRANT_ID,
          grantSha256,
          ACTOR_INSTANCE_ID,
          'controller_shutdown',
        ]);
        return {
          rowCount: 1,
          rows: [{
            grant_id: GRANT_ID,
            safe_no_effect: true,
            effect_possible: false,
            disposition: 'safe_no_effect',
            revoked_at: new Date('2026-07-29T07:00:00.000Z'),
          }],
        };
      }
      return { rowCount: 1, rows: [{ unlocked: true }] };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });
    const input = {
      grant_id: GRANT_ID,
      grant_sha256: grantSha256,
      reason: 'controller_shutdown',
      timeoutMs: 1_500,
    };

    const revocation = authority.revokeGrant(input);
    await lockStarted;
    input.grant_id = OTHER_GRANT_ID;
    input.grant_sha256 = 'b'.repeat(64);
    input.reason = 'mutated_reason';
    input.timeoutMs = 3_000;
    finishLock();

    await expect(revocation).resolves.toEqual({
      grant_ref: GRANT_REF,
      revoked: true,
      safe_no_effect: true,
      effect_possible: false,
      disposition: 'safe_no_effect',
    });
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('takes the exclusive session lock before DB-derived revocation disposition', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const order = [];
    const client = clientFixture(async (sql, parameters) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') {
        order.push(sql.toLowerCase());
        return { rows: [] };
      }
      if (/set_config\('statement_timeout'/.test(sql)) {
        order.push('timeout');
        expect(parameters).toEqual(['1500ms']);
        return { rows: [] };
      }
      if (/pg_advisory_lock\(/.test(sql)) {
        order.push('lock_exclusive');
        expect(parameters).toEqual([expectedLockKey()]);
        return { rows: [] };
      }
      if (/kernel_equivalence_revoke_grant/.test(sql)) {
        order.push('revoke');
        expect(parameters).toEqual([
          GRANT_ID,
          grantSha256,
          ACTOR_INSTANCE_ID,
          'controller_shutdown',
        ]);
        expect(parameters).not.toContain(true);
        expect(parameters).not.toContain(false);
        return {
          rowCount: 1,
          rows: [{
            grant_id: GRANT_ID,
            safe_no_effect: false,
            effect_possible: true,
            disposition: 'effect_possible',
            revoked_at: new Date('2026-07-29T07:00:00.000Z'),
          }],
        };
      }
      expect(sql).toMatch(/pg_advisory_unlock\(/);
      order.push('unlock_exclusive');
      return { rowCount: 1, rows: [{ unlocked: true }] };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    const result = await authority.revokeGrant({
      grant_id: GRANT_ID,
      grant_sha256: grantSha256,
      reason: 'controller_shutdown',
      timeoutMs: 1_500,
    });

    expect(result).toEqual({
      grant_ref: GRANT_REF,
      revoked: true,
      safe_no_effect: false,
      effect_possible: true,
      disposition: 'effect_possible',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(order).toEqual([
      'begin',
      'timeout',
      'lock_exclusive',
      'revoke',
      'commit',
      'unlock_exclusive',
    ]);
  });

  it('destroys a locked transaction when ROLLBACK is not confirmed', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const client = clientFixture(async (sql) => {
      if (
        sql === 'BEGIN'
        || /set_config\('statement_timeout'/.test(sql)
        || /pg_advisory_lock\(/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/kernel_equivalence_revoke_grant/.test(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (sql === 'ROLLBACK') {
        throw new Error('connection ended during ROLLBACK');
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.revokeGrant({
      grant_id: GRANT_ID,
      grant_sha256: grantSha256,
      reason: 'rollback_failure_test',
      timeoutMs: 1_500,
    })).rejects.toMatchObject({
      code: 'grant_rollback_outcome_unknown',
      disposition: 'effect_unknown',
      safe_no_effect: false,
      effect_possible: true,
    });
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledWith(true);
    expect(client.query.mock.calls.some(
      ([sql]) => /pg_advisory_unlock/.test(sql),
    )).toBe(false);
  });

  it.each([
    ['different grant', {
      grant_id: '99999999-9999-4999-8999-999999999999',
      safe_no_effect: true,
      effect_possible: false,
      disposition: 'safe_no_effect',
      revoked_at: new Date('2026-07-29T07:00:00.000Z'),
    }],
    ['invalid revoked_at', {
      grant_id: GRANT_ID,
      safe_no_effect: true,
      effect_possible: false,
      disposition: 'safe_no_effect',
      revoked_at: new Date(Number.NaN),
    }],
    ['inconsistent disposition', {
      grant_id: GRANT_ID,
      safe_no_effect: false,
      effect_possible: true,
      disposition: 'safe_no_effect',
      revoked_at: new Date('2026-07-29T07:00:00.000Z'),
    }],
  ])('rejects a migration-shaped revoke row with %s', async (_label, row) => {
    const grantSha256 = sha256Canonical(grantFixture());
    const client = clientFixture(async (sql) => {
      if (
        sql === 'BEGIN'
        || sql === 'ROLLBACK'
        || /set_config\('statement_timeout'/.test(sql)
        || /pg_advisory_lock\(/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/kernel_equivalence_revoke_grant/.test(sql)) {
        return { rowCount: 1, rows: [row] };
      }
      return { rowCount: 1, rows: [{ unlocked: true }] };
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.revokeGrant({
      grant_id: GRANT_ID,
      grant_sha256: grantSha256,
      reason: 'invalid_readback_test',
      timeoutMs: 1_500,
    })).rejects.toMatchObject({
      code: 'grant_revocation_result_invalid',
    });
    expect(client.query.mock.calls.at(-1)[0]).toMatch(
      /pg_advisory_unlock\(/,
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('destroys an uncertain lock client and reports effect_possible, never safe', async () => {
    const grantSha256 = sha256Canonical(grantFixture());
    const timeout = Object.assign(new Error('lock timeout'), { code: '57014' });
    const client = clientFixture(async (sql) => {
      if (
        sql === 'BEGIN'
        || sql === 'ROLLBACK'
        || /set_config\('statement_timeout'/.test(sql)
      ) {
        return { rows: [] };
      }
      if (/pg_advisory_lock\(/.test(sql)) throw timeout;
      throw new Error(`unexpected query: ${sql}`);
    });
    const authority = createPostgresGrantExecutionAuthority({
      pool: { connect: vi.fn(async () => client) },
      actorInstanceId: ACTOR_INSTANCE_ID,
    });

    await expect(authority.revokeGrant({
      grant_id: GRANT_ID,
      grant_sha256: grantSha256,
      reason: 'timeout_test',
      timeoutMs: 1_500,
    })).rejects.toMatchObject({
      code: 'grant_lock_outcome_unknown',
      disposition: 'effect_unknown',
      safe_no_effect: false,
      effect_possible: true,
    });
    expect(client.release).toHaveBeenCalledWith(true);
    expect(client.query.mock.calls.some(
      ([sql]) => /pg_advisory_unlock/.test(sql),
    )).toBe(false);
  });
});
