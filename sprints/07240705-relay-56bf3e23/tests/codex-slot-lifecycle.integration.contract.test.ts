import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import pg from "pg";

const DB_URL = process.env.DB_URL ?? "postgresql://localhost/cecelia";
const RUN = `contract-${Date.now()}-${process.pid}`;
let client: pg.Client;
let caseNo = 0;
let caseRun = "";
let actorA = "";
let actorB = "";

beforeAll(async () => {
  client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
});

beforeEach(() => {
  caseRun = `${RUN}-case-${++caseNo}`;
  actorA = `${caseRun}-actor-a`;
  actorB = `${caseRun}-actor-b`;
});

afterEach(async () => {
  if (client) {
    for (const table of [
      "codex_slot_audit",
      "codex_slot_sessions",
      "codex_account_leases",
      "codex_company_accounts",
    ]) {
      const exists = await client.query<{ rel: string | null }>(
        "SELECT to_regclass($1)::text AS rel",
        [table],
      );
      if (exists.rows[0].rel) {
        await client.query(`DELETE FROM ${table} WHERE run_id=$1`, [caseRun]);
      }
    }
  }
});

afterAll(async () => {
  if (client) await client.end();
});

async function seedAccount(label: string) {
  const accountKey = `${caseRun}-${label}-account`;
  await client.query(
    `INSERT INTO codex_company_accounts(account_key, enabled, run_id)
     VALUES ($1, true, $2)`,
    [accountKey, caseRun],
  );
  return accountKey;
}

describe("Codex Slot broker ↔ 真 Postgres 生命周期 [BEHAVIOR]", () => {
  it("durable acquire 单账号并发竞争只有一个 blocking lease 成功", async () => {
    const { CodexSlotRegistry } =
      await import("../../../packages/brain/src/codex-slot/registry.js");
    const accountKey = await seedAccount("single");
    const registry = new CodexSlotRegistry(client);
    const [a, b] = await Promise.allSettled([
      registry.acquire({
        actor_id: actorA,
        agent_id: "xian-m1",
        slot: 1,
        request_id: `${caseRun}-a`,
        run_id: caseRun,
      }),
      registry.acquire({
        actor_id: actorB,
        agent_id: "xian-m4",
        slot: 1,
        request_id: `${caseRun}-b`,
        run_id: caseRun,
      }),
    ]);
    expect([a, b].filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect([a, b].filter((r) => r.status === "rejected")).toHaveLength(1);

    const blocking = await client.query(
      `SELECT count(*)::int AS n
        FROM codex_account_leases
        WHERE account_key=$1 AND state IN ('active','quarantined','blocking')`,
      [accountKey],
    );
    expect(blocking.rows[0].n).toBe(1);
  });

  it("相同 request_id 重放返回同一 session handle，不产生双租约", async () => {
    const { CodexSlotRegistry } =
      await import("../../../packages/brain/src/codex-slot/registry.js");
    await seedAccount("replay");
    const registry = new CodexSlotRegistry(client);
    const request = {
      actor_id: actorA,
      agent_id: "xian-m1",
      slot: 1,
      request_id: `${caseRun}-replay`,
      run_id: caseRun,
    };
    const first = await registry.acquire(request);
    const replay = await registry.acquire(request);
    expect(replay.session_handle).toBe(first.session_handle);
    const rows = await client.query(
      `SELECT count(*)::int AS n FROM codex_account_leases
        WHERE actor_id=$1 AND request_id=$2`,
      [actorA, request.request_id],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it("actor B 对 actor A handle 的 status、stop 与 release 均被拒绝", async () => {
    const { CodexSlotRegistry } =
      await import("../../../packages/brain/src/codex-slot/registry.js");
    await seedAccount("ownership");
    const registry = new CodexSlotRegistry(client);
    const acquired = await registry.acquire({
      actor_id: actorA,
      agent_id: "xian-m1",
      slot: 1,
      request_id: `${caseRun}-ownership`,
      run_id: caseRun,
    });
    await expect(
      registry.status(acquired.session_handle, actorB),
    ).rejects.toThrow(/forbidden|owner|actor|归属/i);
    await expect(
      registry.stop(acquired.session_handle, actorB),
    ).rejects.toThrow(/forbidden|owner|actor|归属/i);
    await expect(
      registry.release(acquired.session_handle, actorB),
    ).rejects.toThrow(/forbidden|owner|actor|归属/i);
  });

  it("未知投递结果只 quarantine，禁止自行 release", async () => {
    const { CodexSlotRegistry } =
      await import("../../../packages/brain/src/codex-slot/registry.js");
    await seedAccount("unknown");
    const registry = new CodexSlotRegistry(client);
    const acquired = await registry.acquire({
      actor_id: actorB,
      agent_id: "xian-m4",
      slot: 2,
      request_id: `${caseRun}-unknown`,
      run_id: caseRun,
    });
    await registry.recordUnknownResult(acquired.session_handle, {
      phase: "accept_auth",
      sanitized_reason: "ssh_response_lost",
    });
    const row = await client.query(
      `SELECT state FROM codex_account_leases WHERE session_handle=$1`,
      [acquired.session_handle],
    );
    expect(row.rows[0].state).toBe("quarantined");
  });

  it("durable store 重建实例后仍可按 session handle readback", async () => {
    const { CodexSlotRegistry } =
      await import("../../../packages/brain/src/codex-slot/registry.js");
    await seedAccount("restart");
    const first = new CodexSlotRegistry(client);
    const acquired = await first.acquire({
      actor_id: actorA,
      agent_id: "xian-m4",
      slot: 2,
      request_id: `${caseRun}-restart`,
      run_id: caseRun,
    });
    const afterRestart = new CodexSlotRegistry(client);
    const readback = await afterRestart.status(acquired.session_handle, actorA);
    expect(readback.session_handle).toBe(acquired.session_handle);
    expect(["blocking", "active", "quarantined"]).toContain(
      readback.lease_state,
    );
  });
});
