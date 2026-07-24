import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MAX_AUTH_SNAPSHOT_BYTES = 262_144;
const execFileAsync = promisify(execFile);
let fixtureRoot: string | null = null;

afterEach(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = null;
});

async function readLocalAgentFacts(sessionHandle: string, authPath: string) {
  const { stdout } = await execFileAsync(
    "/bin/bash",
    [
      "scripts/codex-slot-audit.sh",
      "local-session",
      "--session-handle",
      sessionHandle,
      "--auth-path",
      authPath,
    ],
    {
      env: {
        HOME: fixtureRoot ?? tmpdir(),
        PATH: "/usr/bin:/bin",
        LC_ALL: "C",
        LANG: "C",
      },
    },
  );
  return JSON.parse(stdout);
}

describe("Codex Slot CLI schema 与 auth snapshot 安全边界 [BEHAVIOR]", () => {
  it("acquire/status/stop/release/error JSON 与 request shape 精确 keys、类型、枚举和额外字段拒绝", async () => {
    const { assertClientRequest, assertClientResponse } =
      await import("../../../packages/brain/src/codex-slot/protocol.js");
    const acquireRequest = {
      operation: "acquire",
      repo: "/tmp/repo",
      request_id: "req-acquire",
    };
    const handleRequest = {
      operation: "status",
      request_id: "req-handle",
      session_handle: "opaque-handle",
    };
    expect(assertClientRequest("acquire", acquireRequest)).toEqual([
      "operation",
      "repo",
      "request_id",
    ]);
    for (const operation of ["status", "stop", "release"]) {
      expect(
        assertClientRequest(operation, { ...handleRequest, operation }),
      ).toEqual(["operation", "request_id", "session_handle"]);
    }
    for (const forbidden of [
      "actor",
      "actor_id",
      "agent_id",
      "host",
      "slot",
      "account",
      "account_key",
      "token",
      "auth_json",
    ]) {
      expect(() =>
        assertClientRequest("acquire", {
          ...acquireRequest,
          [forbidden]: "client-claim",
        }),
      ).toThrow(/schema|field|forbidden|unexpected|禁用/i);
    }
    expect(() =>
      assertClientRequest("acquire", { ...acquireRequest, repo: 42 }),
    ).toThrow(/schema|repo|type/i);
    expect(() =>
      assertClientRequest("status", {
        ...handleRequest,
        session_handle: null,
      }),
    ).toThrow(/schema|handle|type/i);

    const acquire = {
      ok: true,
      operation: "acquire",
      request_id: "req-1",
      session_handle: "opaque-handle",
      agent_id: "xian-m1",
      slot: 1,
      state: "running",
      lease_state: "active",
    };
    expect(assertClientResponse("acquire", acquire)).toEqual([
      "agent_id",
      "lease_state",
      "ok",
      "operation",
      "request_id",
      "session_handle",
      "slot",
      "state",
    ]);
    for (const forbidden of [
      "actor",
      "actor_id",
      "account_key",
      "token",
      "access_token",
      "refresh_token",
      "auth",
      "auth_json",
      "environment",
      "claimed_host",
    ]) {
      expect(() =>
        assertClientResponse("acquire", { ...acquire, [forbidden]: "leak" }),
      ).toThrow(/schema|field|forbidden|禁用/i);
    }
    expect(() =>
      assertClientResponse("acquire", { ...acquire, slot: "1" }),
    ).toThrow(/schema|slot|type/i);
    expect(() =>
      assertClientResponse("acquire", { ...acquire, agent_id: "claimed-host" }),
    ).toThrow(/schema|agent|enum/i);
    for (const [operation, state, leaseState] of [
      ["status", "running", "active"],
      ["stop", "stopped", "active"],
      ["release", "released", "released"],
    ]) {
      const response = {
        ok: true,
        operation,
        request_id: `req-${operation}`,
        session_handle: "opaque-handle",
        agent_id: "xian-m1",
        slot: 1,
        state,
        lease_state: leaseState,
        sanitized_reason: null,
      };
      expect(assertClientResponse(operation, response)).toEqual([
        "agent_id",
        "lease_state",
        "ok",
        "operation",
        "request_id",
        "sanitized_reason",
        "session_handle",
        "slot",
        "state",
      ]);
      expect(() =>
        assertClientResponse(operation, { ...response, debug: "leak" }),
      ).toThrow(/schema|field|forbidden|unexpected|禁用/i);
    }
    for (const operation of ["status", "stop", "release"]) {
      const error = {
        ok: false,
        operation,
        request_id: `req-error-${operation}`,
        error_code: "handle_forbidden",
        sanitized_reason: "handle_not_owned",
      };
      expect(assertClientResponse("error", error)).toEqual([
        "error_code",
        "ok",
        "operation",
        "request_id",
        "sanitized_reason",
      ]);
      expect(() =>
        assertClientResponse("error", { ...error, actor_id: "leak" }),
      ).toThrow(/schema|field|forbidden|unexpected|禁用/i);
    }
  });

  it("受控 credential store 验证 0710 受控父目录、0600 固定 owner、symlink/non-regular/read-side oversize", async () => {
    const { readAuthSnapshot } =
      await import("../../../packages/brain/src/codex-slot/credential-store.js");
    fixtureRoot = await mkdtemp(join(tmpdir(), "codex-slot-store-"));
    await chmod(fixtureRoot, 0o710);
    const trustedUid = process.getuid?.() ?? 0;
    const trustedGid = process.getgid?.() ?? 0;
    const accountDir = join(fixtureRoot, "fixture-account");
    await mkdir(accountDir, { mode: 0o710 });
    const authPath = join(accountDir, "auth.json");
    const fixture = Buffer.from('{"fixture":"codex-slot-non-secret"}');
    await writeFile(authPath, fixture, { mode: 0o600 });
    await chmod(authPath, 0o600);

    const snapshot = await readAuthSnapshot({
      credentialRoot: fixtureRoot,
      accountKey: "fixture-account",
      maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
      expectedUid: trustedUid,
      expectedGid: trustedGid,
      expectedRootMode: 0o710,
    });
    expect(snapshot.bytes).toEqual(fixture);
    expect(snapshot.bytes).not.toBe(fixture);
    expect(snapshot.sha256).toBe(
      createHash("sha256").update(fixture).digest("hex"),
    );
    expect((await stat(authPath)).mode & 0o777).toBe(0o600);
    await chmod(authPath, 0o644);
    await expect(
      readAuthSnapshot({
        credentialRoot: fixtureRoot,
        accountKey: "fixture-account",
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
        expectedUid: trustedUid,
        expectedGid: trustedGid,
        expectedRootMode: 0o710,
      }),
    ).rejects.toMatchObject({ code: "credential_permissions_invalid" });
    await chmod(authPath, 0o600);
    await expect(
      readAuthSnapshot({
        credentialRoot: fixtureRoot,
        accountKey: "fixture-account",
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
        expectedUid: trustedUid + 1,
        expectedGid: trustedGid,
        expectedRootMode: 0o710,
      }),
    ).rejects.toMatchObject({ code: "credential_owner_invalid" });

    const target = join(fixtureRoot, "target.json");
    await writeFile(target, fixture, { mode: 0o600 });
    await rm(authPath);
    await symlink(target, authPath);
    await expect(
      readAuthSnapshot({
        credentialRoot: fixtureRoot,
        accountKey: "fixture-account",
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
        expectedUid: trustedUid,
        expectedGid: trustedGid,
        expectedRootMode: 0o710,
      }),
    ).rejects.toMatchObject({ code: "credential_symlink_forbidden" });

    await rm(authPath);
    await mkdir(authPath);
    await expect(
      readAuthSnapshot({
        credentialRoot: fixtureRoot,
        accountKey: "fixture-account",
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
        expectedUid: trustedUid,
        expectedGid: trustedGid,
        expectedRootMode: 0o710,
      }),
    ).rejects.toMatchObject({ code: "credential_not_regular" });

    await rm(authPath, { recursive: true });
    await writeFile(authPath, Buffer.alloc(MAX_AUTH_SNAPSHOT_BYTES + 1), {
      mode: 0o600,
    });
    await expect(
      readAuthSnapshot({
        credentialRoot: fixtureRoot,
        accountKey: "fixture-account",
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
        expectedUid: trustedUid,
        expectedGid: trustedGid,
        expectedRootMode: 0o710,
      }),
    ).rejects.toMatchObject({ code: "snapshot_too_large" });
  });

  it("snapshot Buffer 在成功与失败 finally 后都被清零", async () => {
    const { withAuthSnapshot } =
      await import("../../../packages/brain/src/codex-slot/credential-store.js");
    fixtureRoot = await mkdtemp(join(tmpdir(), "codex-slot-zeroize-"));
    await chmod(fixtureRoot, 0o710);
    const trustedUid = process.getuid?.() ?? 0;
    const trustedGid = process.getgid?.() ?? 0;
    const accountDir = join(fixtureRoot, "fixture-account");
    await mkdir(accountDir, { mode: 0o710 });
    const authPath = join(accountDir, "auth.json");
    await writeFile(authPath, '{"fixture":"zeroize"}', { mode: 0o600 });
    let successBuffer: Buffer | null = null;
    await withAuthSnapshot(
      {
        credentialRoot: fixtureRoot,
        accountKey: "fixture-account",
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
        expectedUid: trustedUid,
        expectedGid: trustedGid,
        expectedRootMode: 0o710,
      },
      async (snapshot: { bytes: Buffer }) => {
        successBuffer = snapshot.bytes;
      },
    );
    expect(successBuffer).toEqual(Buffer.alloc(successBuffer?.length ?? 0));

    let failureBuffer: Buffer | null = null;
    await expect(
      withAuthSnapshot(
        {
          credentialRoot: fixtureRoot,
          accountKey: "fixture-account",
          maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
          expectedUid: trustedUid,
          expectedGid: trustedGid,
          expectedRootMode: 0o710,
        },
        async (snapshot: { bytes: Buffer }) => {
          failureBuffer = snapshot.bytes;
          throw new Error("transport_failed");
        },
      ),
    ).rejects.toThrow("transport_failed");
    expect(failureBuffer).toEqual(Buffer.alloc(failureBuffer?.length ?? 0));
  });

  it("snapshot oversize/hash mismatch 每次立即零 auth/tmux，成功目标 owner/mode=0600", async () => {
    const { acceptAuthSnapshot } =
      await import("../../../packages/brain/src/codex-slot/agent.js");
    fixtureRoot = await mkdtemp(join(tmpdir(), "codex-slot-agent-auth-"));
    const bytes = Buffer.from('{"fixture":"codex-slot-non-secret"}');
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const oversizeAuth = join(fixtureRoot, "oversize-auth.json");
    await expect(
      acceptAuthSnapshot({
        sessionHandle: "session-oversize",
        nonce: "nonce-oversize",
        bytes: Buffer.alloc(MAX_AUTH_SNAPSHOT_BYTES + 1),
        sha256: "unused",
        authPath: oversizeAuth,
        nonceStorePath: join(fixtureRoot, "nonces.json"),
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
      }),
    ).rejects.toMatchObject({ code: "snapshot_too_large" });
    expect(
      await readLocalAgentFacts("session-oversize", oversizeAuth),
    ).toMatchObject({ auth_exists: false, tmux_alive: false });

    const hashAuth = join(fixtureRoot, "hash-auth.json");
    await expect(
      acceptAuthSnapshot({
        sessionHandle: "session-hash",
        nonce: "nonce-hash",
        bytes,
        sha256: "0".repeat(64),
        authPath: hashAuth,
        nonceStorePath: join(fixtureRoot, "nonces.json"),
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
      }),
    ).rejects.toMatchObject({ code: "snapshot_hash_mismatch" });
    expect(await readLocalAgentFacts("session-hash", hashAuth)).toMatchObject({
      auth_exists: false,
      tmux_alive: false,
    });

    const authPath = join(fixtureRoot, "valid-auth.json");
    await acceptAuthSnapshot({
      sessionHandle: "session-valid",
      nonce: "nonce-valid",
      bytes,
      sha256,
      authPath,
      nonceStorePath: join(fixtureRoot, "nonces.json"),
      maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
    });
    const written = await stat(authPath);
    expect(written.mode & 0o777).toBe(0o600);
    expect(written.uid).toBe(process.getuid?.() ?? written.uid);
    expect(JSON.parse(await readFile(authPath, "utf8"))).toEqual({
      fixture: "codex-slot-non-secret",
    });
  });

  it("nonce durable 消费在模块重载后仍拒绝 replay", async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "codex-slot-agent-nonce-"));
    const nonceStorePath = join(fixtureRoot, "consumed-nonces.json");
    const authPath = join(fixtureRoot, "auth.json");
    const bytes = Buffer.from('{"fixture":"codex-slot-non-secret"}');
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const firstAgent =
      await import("../../../packages/brain/src/codex-slot/agent.js");
    await firstAgent.acceptAuthSnapshot({
      sessionHandle: "session-replay",
      nonce: "nonce-replay",
      bytes,
      sha256,
      authPath,
      nonceStorePath,
      maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
    });
    vi.resetModules();
    const reloadedAgent =
      await import("../../../packages/brain/src/codex-slot/agent.js");
    await expect(
      reloadedAgent.acceptAuthSnapshot({
        sessionHandle: "session-replay",
        nonce: "nonce-replay",
        bytes,
        sha256,
        authPath,
        nonceStorePath,
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
      }),
    ).rejects.toMatchObject({ code: "nonce_replayed" });
  });
});
