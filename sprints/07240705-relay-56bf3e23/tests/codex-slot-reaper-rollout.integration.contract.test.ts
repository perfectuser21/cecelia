import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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
      "codex_slot_rollout",
      "codex_slot_agent_observations",
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
        await client.query(`DELETE FROM ${table} WHERE run_id LIKE $1`, [
          `${RUN}%`,
        ]);
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

async function captureValidRolloutEvidence(runId: string) {
  const { captureInventoryEvidence, captureLegacyProbeEvidence } =
    await import("../../../packages/brain/src/codex-slot/rollout.js");
  const evidenceHome = await mkdtemp(join(tmpdir(), `${runId}-evidence-`));
  const brief = join(evidenceHome, "task.md");
  await mkdir(join(evidenceHome, "tmp"));
  await writeFile(brief, "non-secret contract fixture\n");
  try {
    const inventory = await captureInventoryEvidence(client, {
      run_id: runId,
      observed_at: new Date(),
    });
    const legacy = await captureLegacyProbeEvidence(client, {
      run_id: runId,
      observed_at: new Date(),
      isolated_home: evidenceHome,
      invocations: [
        {
          script: "scripts/codex-request.sh",
          args: ["--team", "team1"],
        },
        {
          script: "scripts/codex-remote-launch.sh",
          args: ["--team", "team3", "--brief", brief],
        },
      ],
    });
    return {
      inventoryEvidenceId: inventory.evidence_id,
      legacyEvidenceId: legacy.evidence_id,
    };
  } finally {
    await rm(evidenceHome, { recursive: true, force: true });
  }
}

async function assertReaperClassification(
  expectedClassification: string,
  facts: Record<string, unknown>,
  expectedFirst: string,
  expectedSecond: string,
) {
  const { CodexSlotRegistry } =
    await import("../../../packages/brain/src/codex-slot/registry.js");
  const { runCodexSlotReaper } =
    await import("../../../packages/brain/src/codex-slot/reaper.js");
  const registry = new CodexSlotRegistry(client);
  const suffix = `${expectedClassification}-${Date.now()}`;
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
    expected_agent_id: "xian-m1",
    reported_agent_id: "xian-m1",
    reachable: true,
    response_complete: true,
    tmux_alive: true,
    process_alive: true,
    agent_state: "running",
    observed_at: new Date(),
    run_id: RUN,
    ...facts,
  });

  const first = await runCodexSlotReaper(client, { run_id: RUN });
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const second = await runCodexSlotReaper(client, { run_id: RUN });
  const statusAfterFirst = await registry.status(
    acquired.session_handle,
    `${RUN}-${suffix}-actor`,
  );
  expect(
    first.find(
      (x: { session_handle: string }) =>
        x.session_handle === acquired.session_handle,
    ),
  ).toMatchObject({
    classification: expectedClassification,
    action: expectedFirst,
  });
  expect(
    second.find(
      (x: { session_handle: string }) =>
        x.session_handle === acquired.session_handle,
    ),
  ).toMatchObject({
    classification: expectedClassification,
    action: expectedSecond,
  });
  expect(statusAfterFirst.lease_state).toBe(
    expectedFirst === "released"
      ? "released"
      : expectedFirst === "quarantined"
        ? "quarantined"
        : "active",
  );
}

async function assertLegacyDisabled(script: string) {
  const home = await mkdtemp(join(tmpdir(), `${RUN}-legacy-home-`));
  try {
    const brief = join(home, "task.md");
    await mkdir(join(home, "tmp"));
    await mkdir(join(home, "empty-bin"));
    await writeFile(brief, "non-secret contract fixture\n");
    const safeEnv = {
      HOME: home,
      PATH: join(home, "empty-bin"),
      TMPDIR: join(home, "tmp"),
      LC_ALL: "C",
      LANG: "C",
    };
    const args =
      script === "scripts/codex-request.sh"
        ? [script, "--team", "team1"]
        : [script, "--team", "team3", "--brief", brief];
    const result = await execFileAsync("/bin/bash", args, {
      cwd: process.cwd(),
      env: safeEnv,
    }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({
        code: error.code ?? 1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      }),
    );
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/broker-only/i);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/codex-slot-client/i);
    expect(await authFilesUnder(home)).toEqual([]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

describe("Codex Slot rollout、旧入口与 reaper 真接缝 [BEHAVIOR]", () => {
  it("rollout 只接受本 run 新鲜且通过的 inventory/legacy probe 真实 evidence", async () => {
    const { transitionRollout, readRollout } =
      await import("../../../packages/brain/src/codex-slot/rollout.js");
    const runId = `${RUN}-success`;
    const evidence = await captureValidRolloutEvidence(runId);
    await transitionRollout(client, {
      run_id: runId,
      from: "frozen",
      to: "inventory_complete",
      inventory_evidence_id: evidence.inventoryEvidenceId,
      legacy_probe_evidence_id: evidence.legacyEvidenceId,
    });
    expect((await readRollout(client, runId)).state).toBe("inventory_complete");
    await transitionRollout(client, {
      run_id: runId,
      from: "inventory_complete",
      to: "broker_only",
      inventory_evidence_id: evidence.inventoryEvidenceId,
      legacy_probe_evidence_id: evidence.legacyEvidenceId,
    });
    const final = await readRollout(client, runId);
    expect(final).toMatchObject({
      state: "broker_only",
      inventory_evidence_id: evidence.inventoryEvidenceId,
      legacy_probe_evidence_id: evidence.legacyEvidenceId,
    });
  });

  it("rollout 有 blocking lease 时拒绝 inventory_complete 并保持 frozen", async () => {
    const { transitionRollout, readRollout } =
      await import("../../../packages/brain/src/codex-slot/rollout.js");
    const runId = `${RUN}-blocking`;
    const evidence = await captureValidRolloutEvidence(runId);
    await client.query(
      `INSERT INTO codex_company_accounts(account_key, enabled, run_id)
       VALUES ($1, true, $2)`,
      [`${runId}-account`, runId],
    );
    await client.query(
      `INSERT INTO codex_account_leases
         (account_key, actor_id, session_handle, request_id, state, run_id)
       VALUES ($1, $2, $3, $4, 'blocking', $5)`,
      [
        `${runId}-account`,
        `${runId}-actor`,
        `${runId}-handle`,
        `${runId}-request`,
        runId,
      ],
    );
    await expect(
      transitionRollout(client, {
        run_id: runId,
        from: "frozen",
        to: "inventory_complete",
        inventory_evidence_id: evidence.inventoryEvidenceId,
        legacy_probe_evidence_id: evidence.legacyEvidenceId,
      }),
    ).rejects.toThrow(/blocking|lease/i);
    expect((await readRollout(client, runId)).state).toBe("frozen");
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

  it("rollout 垃圾、跨 run、过期或未通过 evidence id 均不得推进", async () => {
    const { transitionRollout } =
      await import("../../../packages/brain/src/codex-slot/rollout.js");
    const crossRun = `${RUN}-validation-cross`;
    const staleRun = `${RUN}-validation-stale`;
    const failedRun = `${RUN}-validation-failed`;
    await client.query(
      `INSERT INTO codex_slot_audit
         (evidence_id, evidence_kind, result, run_id, event, created_at)
       VALUES
         ($1, 'inventory', 'passed', $2, 'rollout_evidence', NOW()),
         ($3, 'legacy_probe', 'passed', $2, 'rollout_evidence', NOW()),
         ($4, 'inventory', 'passed', $5, 'rollout_evidence', NOW() - interval '10 minutes'),
         ($6, 'legacy_probe', 'passed', $5, 'rollout_evidence', NOW()),
         ($7, 'inventory', 'passed', $8, 'rollout_evidence', NOW()),
         ($9, 'legacy_probe', 'failed', $8, 'rollout_evidence', NOW())`,
      [
        `${RUN}-other-run-inventory`,
        `${RUN}-different-run`,
        `${RUN}-other-run-legacy`,
        `${RUN}-stale-inventory`,
        staleRun,
        `${RUN}-stale-legacy`,
        `${RUN}-passed-inventory`,
        failedRun,
        `${RUN}-failed-legacy`,
      ],
    );
    for (const invalid of [
      {
        runId: `${RUN}-validation-garbage`,
        inventoryId: "garbage-inventory",
        legacyId: "garbage-legacy",
      },
      {
        runId: crossRun,
        inventoryId: `${RUN}-other-run-inventory`,
        legacyId: `${RUN}-other-run-legacy`,
      },
      {
        runId: staleRun,
        inventoryId: `${RUN}-stale-inventory`,
        legacyId: `${RUN}-stale-legacy`,
      },
      {
        runId: failedRun,
        inventoryId: `${RUN}-passed-inventory`,
        legacyId: `${RUN}-failed-legacy`,
      },
    ]) {
      await expect(
        transitionRollout(client, {
          run_id: invalid.runId,
          from: "frozen",
          to: "inventory_complete",
          inventory_evidence_id: invalid.inventoryId,
          legacy_probe_evidence_id: invalid.legacyId,
        }),
      ).rejects.toThrow(/evidence|run|fresh|passed|inventory|legacy/i);
    }
  });

  it("reaper 从独立事实计算 alive，client status readback 为 active 且第二轮 heartbeat", async () => {
    await assertReaperClassification("alive", {}, "heartbeat", "heartbeat");
  });

  it("reaper 从独立事实计算 stopped，client status readback 为 released 且第二轮 no-op", async () => {
    await assertReaperClassification(
      "stopped",
      { tmux_alive: false, process_alive: false, agent_state: "stopped" },
      "released",
      "noop",
    );
  });

  it("reaper 从独立事实计算 unreachable，client status readback 为 quarantined 且第二轮 no-op", async () => {
    await assertReaperClassification(
      "unreachable",
      {
        reachable: false,
        response_complete: false,
        tmux_alive: null,
        process_alive: null,
        agent_state: null,
      },
      "quarantined",
      "noop",
    );
  });

  it("reaper 从独立事实计算 mismatch，client status readback 为 quarantined 且第二轮 no-op", async () => {
    await assertReaperClassification(
      "mismatch",
      { reported_agent_id: "xian-m4" },
      "quarantined",
      "noop",
    );
  });

  it("reaper 从独立事实计算 unknown，client status readback 为 quarantined 且第二轮 no-op", async () => {
    await assertReaperClassification(
      "unknown",
      {
        response_complete: false,
        tmux_alive: null,
        process_alive: null,
        agent_state: null,
      },
      "quarantined",
      "noop",
    );
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
