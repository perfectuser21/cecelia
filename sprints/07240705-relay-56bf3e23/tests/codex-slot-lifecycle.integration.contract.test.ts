import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DB_URL = process.env.DB_URL ?? 'postgresql://localhost/cecelia';
const RUN = `contract-${Date.now()}-${process.pid}`;
const ACTOR_A = `${RUN}-actor-a`;
const ACTOR_B = `${RUN}-actor-b`;
let client: pg.Client;

beforeAll(async () => {
  client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
});

afterAll(async () => {
  if (client) {
    const tables = await client.query<{ sessions: string | null }>(
      `SELECT to_regclass('codex_slot_sessions')::text AS sessions`,
    );
    if (tables.rows[0].sessions) {
      await client.query('DELETE FROM codex_slot_sessions WHERE actor_id = ANY($1)', [
        [ACTOR_A, ACTOR_B],
      ]);
      await client.query('DELETE FROM codex_account_leases WHERE actor_id = ANY($1)', [
        [ACTOR_A, ACTOR_B],
      ]);
      await client.query('DELETE FROM codex_company_accounts WHERE account_key LIKE $1', [
        `${RUN}%`,
      ]);
    }
    await client.end();
  }
});

describe('Codex Slot broker ↔ 真 Postgres 生命周期 [BEHAVIOR]', () => {
  it('durable acquire 对同一公司账号只产生一个 blocking lease', async () => {
    const { CodexSlotRegistry } = await import(
      '../../../packages/brain/src/codex-slot/registry.js'
    );
    await client.query(
      `INSERT INTO codex_company_accounts(account_key, enabled)
       VALUES ($1, true), ($2, true)`,
      [`${RUN}-account-1`, `${RUN}-account-2`],
    );
    const registry = new CodexSlotRegistry(client);
    const [a, b] = await Promise.allSettled([
      registry.acquire({
        actor_id: ACTOR_A,
        agent_id: 'xian-m1',
        slot: 1,
        idempotency_key: `${RUN}-a`,
      }),
      registry.acquire({
        actor_id: ACTOR_B,
        agent_id: 'xian-m4',
        slot: 1,
        idempotency_key: `${RUN}-b`,
      }),
    ]);
    expect([a, b].filter((r) => r.status === 'fulfilled')).toHaveLength(2);

    const dup = await client.query(
      `SELECT account_key, count(*)::int AS n
         FROM codex_account_leases
        WHERE actor_id = ANY($1) AND state IN ('active','quarantined','blocking')
        GROUP BY account_key HAVING count(*) > 1`,
      [[ACTOR_A, ACTOR_B]],
    );
    expect(dup.rows).toEqual([]);
  });

  it('相同 idempotency key 重放返回同一 session handle，不产生双租约', async () => {
    const { CodexSlotRegistry } = await import(
      '../../../packages/brain/src/codex-slot/registry.js'
    );
    const registry = new CodexSlotRegistry(client);
    const request = {
      actor_id: ACTOR_A,
      agent_id: 'xian-m1',
      slot: 1,
      idempotency_key: `${RUN}-replay`,
    };
    const first = await registry.acquire(request);
    const replay = await registry.acquire(request);
    expect(replay.session_handle).toBe(first.session_handle);
    const rows = await client.query(
      `SELECT count(*)::int AS n FROM codex_account_leases
        WHERE actor_id=$1 AND idempotency_key=$2`,
      [ACTOR_A, request.idempotency_key],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('未知投递结果只 quarantine，禁止自行 release', async () => {
    const { CodexSlotRegistry } = await import(
      '../../../packages/brain/src/codex-slot/registry.js'
    );
    const registry = new CodexSlotRegistry(client);
    const acquired = await registry.acquire({
      actor_id: ACTOR_B,
      agent_id: 'xian-m4',
      slot: 2,
      idempotency_key: `${RUN}-unknown`,
    });
    await registry.recordUnknownResult(acquired.session_handle, {
      phase: 'accept_auth',
      sanitized_reason: 'ssh_response_lost',
    });
    const row = await client.query(
      `SELECT state FROM codex_account_leases WHERE session_handle=$1`,
      [acquired.session_handle],
    );
    expect(row.rows[0].state).toBe('quarantined');
  });

  it('durable store 重建实例后仍可按 session handle readback', async () => {
    const { CodexSlotRegistry } = await import(
      '../../../packages/brain/src/codex-slot/registry.js'
    );
    const first = new CodexSlotRegistry(client);
    const acquired = await first.acquire({
      actor_id: ACTOR_A,
      agent_id: 'xian-m4',
      slot: 2,
      idempotency_key: `${RUN}-restart`,
    });
    const afterRestart = new CodexSlotRegistry(client);
    const readback = await afterRestart.status(acquired.session_handle, ACTOR_A);
    expect(readback.session_handle).toBe(acquired.session_handle);
    expect(['blocking', 'active', 'quarantined']).toContain(readback.lease_state);
  });
});
