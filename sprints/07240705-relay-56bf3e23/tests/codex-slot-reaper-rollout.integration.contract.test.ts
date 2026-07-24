import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";

const execFileAsync = promisify(execFile);
const DB_URL = process.env.DB_URL ?? "postgresql://localhost/cecelia";
const RUN = `reaper-${Date.now()}-${process.pid}`;
let client: pg.Client;

beforeAll(async () => {
  client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
});

afterAll(async () => {
  if (client) {
    for (const table of [
      "codex_slot_agent_observations",
      "codex_slot_audit",
      "codex_slot_sessions",
      "codex_account_leases",
      "codex_company_accounts",
      "codex_slot_rollout",
    ]) {
      const exists = await client.query<{ rel: string | null }>(
        "SELECT to_regclass($1)::text AS rel",
        [table],
      );
      if (exists.rows[0].rel) {
        await client.query(`DELETE FROM ${table} WHERE run_id=$1`, [RUN]);
      }
    }
    await client.end();
  }
});

async function authFilesUnder(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      if (entry.isFile() && entry.name === "auth.json") found.push(path);
    }
  }
  await walk(root);
  return found;
}

async function assertMissingRolloutEvidence(
  missing: string,
  inventoryEvidence: string | null,
  legacyEvidence: string | null,
) {
  const { transitionRollout, readRollout } =
    await import("../../../packages/brain/src/codex-slot/rollout.js");
  await expect(
    transitionRollout(client, {
      run_id: `${RUN}-${missing}`,
      from: "frozen",
      to: "inventory_complete",
      inventory_evidence_id: inventoryEvidence,
      legacy_probe_evidence_id: legacyEvidence,
    }),
  ).rejects.toThrow(/evidence|inventory|legacy/i);
  const row = await readRollout(client, `${RUN}-${missing}`);
  expect(row.state).toBe("frozen");
  expect(row.inventory_evidence_id).toBeNull();
  expect(row.legacy_probe_evidence_id).toBeNull();
}

async function assertReaperClassification(
  classification: string,
  expected: string,
) {
  const { CodexSlotRegistry } =
    await import("../../../packages/brain/src/codex-slot/registry.js");
  const { runCodexSlotReaper } =
    await import("../../../packages/brain/src/codex-slot/reaper.js");
  const registry = new CodexSlotRegistry(client);
  const suffix = `${classification}-${Date.now()}`;
  await client.query(
    `INSERT INTO codex_company_accounts(account_key, enabled, run_id)
     VALUES ($1, true, $2)`,
    [`${RUN}-${suffix}-account`, RUN],
  );
  const acquired = await registry.acquire({
    actor_id: `${RUN}-${suffix}-actor`,
    agent_id: "xian-m1",
    slot: 1,
    request_id: `${RUN}-${suffix}-request`,
    run_id: RUN,
  });
  await registry.recordAgentObservation(acquired.session_handle, {
    classification,
    agent_id: classification === "mismatch" ? "xian-m4" : "xian-m1",
    observed_at: new Date(),
    run_id: RUN,
  });

  const first = await runCodexSlotReaper(client, { run_id: RUN });
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const second = await runCodexSlotReaper(client, { run_id: RUN });
  const status = await registry.status(
    acquired.session_handle,
    `${RUN}-${suffix}-actor`,
  );
  expect(
    first.find(
      (x: { session_handle: string }) =>
        x.session_handle === acquired.session_handle,
    ),
  ).toMatchObject({ action: expected });
  expect(
    second.find(
      (x: { session_handle: string }) =>
        x.session_handle === acquired.session_handle,
    ),
  ).toMatchObject({ action: expected });
  expect(status.lease_state).toBe(
    expected === "released"
      ? "released"
      : expected === "quarantined"
        ? "quarantined"
        : "active",
  );
}

async function assertLegacyDisabled(script: string) {
  const home = await mkdtemp(join(tmpdir(), `${RUN}-legacy-home-`));
  try {
    const safeEnv = {
      HOME: home,
      PATH: "/usr/bin:/bin",
      TMPDIR: join(home, "tmp"),
      LC_ALL: "C",
      LANG: "C",
    };
    const result = await execFileAsync("/bin/bash", [script, "--help"], {
      cwd: process.cwd(),
      env: safeEnv,
    }).then(
      () => ({ code: 0 }),
      (error: { code?: number }) => ({ code: error.code ?? 1 }),
    );
    expect(result.code).not.toBe(0);
    expect(await authFilesUnder(home)).toEqual([]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

describe("Codex Slot rollout、旧入口与 reaper 真接缝 [BEHAVIOR]", () => {
  it("rollout 成功按 frozen→inventory_complete→broker_only 原子持久化", async () => {
    const { transitionRollout, readRollout } =
      await import("../../../packages/brain/src/codex-slot/rollout.js");
    await transitionRollout(client, {
      run_id: RUN,
      from: "frozen",
      to: "inventory_complete",
      inventory_evidence_id: `${RUN}-inventory`,
      legacy_probe_evidence_id: `${RUN}-legacy`,
    });
    expect((await readRollout(client, RUN)).state).toBe("inventory_complete");
    await transitionRollout(client, {
      run_id: RUN,
      from: "inventory_complete",
      to: "broker_only",
      inventory_evidence_id: `${RUN}-inventory`,
      legacy_probe_evidence_id: `${RUN}-legacy`,
    });
    const final = await readRollout(client, RUN);
    expect(final).toMatchObject({
      state: "broker_only",
      inventory_evidence_id: `${RUN}-inventory`,
      legacy_probe_evidence_id: `${RUN}-legacy`,
    });
  });

  it("rollout 有 blocking lease 时拒绝 inventory_complete 并保持 frozen", async () => {
    const { transitionRollout, readRollout } =
      await import("../../../packages/brain/src/codex-slot/rollout.js");
    await client.query(
      `INSERT INTO codex_company_accounts(account_key, enabled, run_id)
       VALUES ($1, true, $2)`,
      [`${RUN}-blocking-account`, RUN],
    );
    await client.query(
      `INSERT INTO codex_account_leases
         (account_key, actor_id, session_handle, request_id, state, run_id)
       VALUES ($1, $2, $3, $4, 'blocking', $5)`,
      [
        `${RUN}-blocking-account`,
        `${RUN}-actor`,
        `${RUN}-blocking-handle`,
        `${RUN}-blocking-request`,
        RUN,
      ],
    );
    await expect(
      transitionRollout(client, {
        run_id: RUN,
        from: "frozen",
        to: "inventory_complete",
        inventory_evidence_id: `${RUN}-inventory-2`,
        legacy_probe_evidence_id: `${RUN}-legacy-2`,
      }),
    ).rejects.toThrow(/blocking|lease/i);
    expect((await readRollout(client, RUN)).state).toBe("frozen");
  });

  it("rollout 缺少 inventory_evidence_id 时拒绝且不部分持久化", async () => {
    await assertMissingRolloutEvidence(
      "inventory_evidence_id",
      null,
      `${RUN}-legacy-only`,
    );
  });

  it("rollout 缺少 legacy_probe_evidence_id 时拒绝且不部分持久化", async () => {
    await assertMissingRolloutEvidence(
      "legacy_probe_evidence_id",
      `${RUN}-inventory-only`,
      null,
    );
  });

  it("reaper 对 alive 产生 heartbeat 且第二轮幂等", async () => {
    await assertReaperClassification("alive", "heartbeat");
  });

  it("reaper 对 stopped 产生 released 且第二轮幂等", async () => {
    await assertReaperClassification("stopped", "released");
  });

  it("reaper 对 unreachable 产生 quarantined 且第二轮幂等", async () => {
    await assertReaperClassification("unreachable", "quarantined");
  });

  it("reaper 对 mismatch 产生 quarantined 且第二轮幂等", async () => {
    await assertReaperClassification("mismatch", "quarantined");
  });

  it("reaper 对 unknown 产生 quarantined 且第二轮幂等", async () => {
    await assertReaperClassification("unknown", "quarantined");
  });

  it("旧入口 codex-request 真执行非零且显式环境白名单下零 auth 写入", async () => {
    await assertLegacyDisabled("scripts/codex-request.sh");
  });

  it("旧入口 codex-remote-launch 真执行非零且显式环境白名单下零 auth 写入", async () => {
    await assertLegacyDisabled("scripts/codex-remote-launch.sh");
  });

  it("client、agent、installer 同时通过 Bash 3.2 与现代 Bash 语法/零参数分支", async () => {
    const bash32 = process.env.BASH_32_BIN ?? "/bin/bash";
    const modern = process.env.BASH_MODERN_BIN ?? "/opt/homebrew/bin/bash";
    const scripts = [
      "scripts/codex-slot-client.sh",
      "scripts/codex-slot-agent.sh",
      "packages/brain/scripts/install-codex-slot.sh",
    ];
    const oldVersion = (await execFileAsync(bash32, ["--version"])).stdout;
    const modernVersion = (await execFileAsync(modern, ["--version"])).stdout;
    expect(oldVersion).toMatch(/version 3\.2/);
    expect(modernVersion).toMatch(/version (4|5|6)\./);
    for (const shell of [bash32, modern]) {
      for (const script of scripts) await execFileAsync(shell, ["-n", script]);
      const result = await execFileAsync(
        shell,
        ["scripts/codex-slot-client.sh"],
        {
          env: {
            HOME: tmpdir(),
            PATH: "/usr/bin:/bin",
            LC_ALL: "C",
            LANG: "C",
          },
        },
      ).then(
        () => ({ code: 0 }),
        (error: { code?: number }) => ({ code: error.code ?? 1 }),
      );
      expect(result.code).not.toBe(0);
    }
  });

  it("scheduler JOBS 真实接线 codex-slot-reaper 且周期为 60 秒", async () => {
    const { JOBS } =
      await import("../../../packages/brain/src/scheduler-jobs.js");
    const job = JOBS.find(
      (entry: { name: string }) => entry.name === "codex-slot-reaper",
    );
    expect(job).toBeDefined();
    expect(job.intervalMs).toBe(60_000);
  });
});
