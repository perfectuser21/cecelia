import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MAX_AUTH_SNAPSHOT_BYTES = 262_144;
let fixtureRoot: string | null = null;

afterEach(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = null;
});

describe("Codex Slot CLI schema 与 auth snapshot 安全边界 [BEHAVIOR]", () => {
  it("acquire/status/error JSON 精确 keys、类型、枚举与禁用字段", async () => {
    const { assertClientResponse } =
      await import("../../../packages/brain/src/codex-slot/protocol.js");
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
    expect(
      assertClientResponse("status", {
        ok: true,
        operation: "status",
        request_id: "req-2",
        session_handle: "opaque-handle",
        agent_id: "xian-m1",
        slot: 1,
        state: "running",
        lease_state: "active",
        sanitized_reason: null,
      }),
    ).toEqual([
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
    expect(
      assertClientResponse("error", {
        ok: false,
        operation: "status",
        request_id: "req-3",
        error_code: "handle_forbidden",
        sanitized_reason: "handle_not_owned",
      }),
    ).toEqual([
      "error_code",
      "ok",
      "operation",
      "request_id",
      "sanitized_reason",
    ]);
  });

  it("受控 credential store 只读取 0600 fixture 并在上限内返回独立 buffer", async () => {
    const { readAuthSnapshot } =
      await import("../../../packages/brain/src/codex-slot/credential-store.js");
    fixtureRoot = await mkdtemp(join(tmpdir(), "codex-slot-store-"));
    const accountDir = join(fixtureRoot, "fixture-account");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(accountDir, { mode: 0o700 }),
    );
    const authPath = join(accountDir, "auth.json");
    const fixture = Buffer.from('{"fixture":"codex-slot-non-secret"}');
    await writeFile(authPath, fixture, { mode: 0o600 });
    await chmod(authPath, 0o600);
    const expectedUid = (await stat(authPath)).uid;

    const snapshot = await readAuthSnapshot({
      credentialRoot: fixtureRoot,
      accountKey: "fixture-account",
      maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
      expectedUid,
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
        expectedUid,
      }),
    ).rejects.toMatchObject({ code: "credential_permissions_invalid" });
    await chmod(authPath, 0o600);
    await expect(
      readAuthSnapshot({
        credentialRoot: fixtureRoot,
        accountKey: "fixture-account",
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
        expectedUid: expectedUid + 1,
      }),
    ).rejects.toMatchObject({ code: "credential_owner_invalid" });
  });

  it("snapshot Buffer 在成功与失败 finally 后都被清零", async () => {
    const { withAuthSnapshot } =
      await import("../../../packages/brain/src/codex-slot/credential-store.js");
    fixtureRoot = await mkdtemp(join(tmpdir(), "codex-slot-zeroize-"));
    const accountDir = join(fixtureRoot, "fixture-account");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(accountDir, { mode: 0o700 }),
    );
    const authPath = join(accountDir, "auth.json");
    await writeFile(authPath, '{"fixture":"zeroize"}', { mode: 0o600 });
    const expectedUid = (await stat(authPath)).uid;
    let successBuffer: Buffer | null = null;
    await withAuthSnapshot(
      {
        credentialRoot: fixtureRoot,
        accountKey: "fixture-account",
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
        expectedUid,
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
          expectedUid,
        },
        async (snapshot: { bytes: Buffer }) => {
          failureBuffer = snapshot.bytes;
          throw new Error("transport_failed");
        },
      ),
    ).rejects.toThrow("transport_failed");
    expect(failureBuffer).toEqual(Buffer.alloc(failureBuffer?.length ?? 0));
  });

  it("oversize、nonce replay 与 hash mismatch 都稳定拒绝且不留 auth", async () => {
    const { acceptAuthSnapshot } =
      await import("../../../packages/brain/src/codex-slot/agent.js");
    fixtureRoot = await mkdtemp(join(tmpdir(), "codex-slot-agent-auth-"));
    const authPath = join(fixtureRoot, "auth.json");
    const bytes = Buffer.from('{"fixture":"codex-slot-non-secret"}');
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    await expect(
      acceptAuthSnapshot({
        sessionHandle: "session-oversize",
        nonce: "nonce-oversize",
        bytes: Buffer.alloc(MAX_AUTH_SNAPSHOT_BYTES + 1),
        sha256: "unused",
        authPath,
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
      }),
    ).rejects.toMatchObject({ code: "snapshot_too_large" });

    await expect(
      acceptAuthSnapshot({
        sessionHandle: "session-hash",
        nonce: "nonce-hash",
        bytes,
        sha256: "0".repeat(64),
        authPath,
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
      }),
    ).rejects.toMatchObject({ code: "snapshot_hash_mismatch" });

    await acceptAuthSnapshot({
      sessionHandle: "session-replay",
      nonce: "nonce-replay",
      bytes,
      sha256,
      authPath,
      maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
    });
    await expect(
      acceptAuthSnapshot({
        sessionHandle: "session-replay",
        nonce: "nonce-replay",
        bytes,
        sha256,
        authPath,
        maxBytes: MAX_AUTH_SNAPSHOT_BYTES,
      }),
    ).rejects.toMatchObject({ code: "nonce_replayed" });
    expect(JSON.parse(await readFile(authPath, "utf8"))).toEqual({
      fixture: "codex-slot-non-secret",
    });
  });
});
