import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVerifiedRemotePlannerPrdArtifact } from '../planner-artifact-receipt.js';

const HEAD_SHA = 'b'.repeat(40);
const BASE_SHA = 'a'.repeat(40);
const CONTENT = '# Sprint PRD\n\nTrusted server blob.\n';
const TARGET_PATH = 'sprints/08150001-recovery/sprint-prd.md';
const ENTRY_SHA = 'c'.repeat(40);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('remote exact commit blob resolver', () => {
  function authoritativeAttempt(overrides = {}) {
    return {
      id: '22222222-2222-4222-8222-222222222222',
      run_id: '11111111-1111-4111-8111-111111111111',
      hop: 4,
      role: 'planner',
      status: 'running',
      lease_generation: 3,
      execution_transport: 'fleet-worker',
      requested_machine_id: 'xian-mac-m4',
      actual_machine_id: 'xian-mac-m4',
      machine_attestation_status: 'verified',
      task_bundle: {
        inputs: {
          task_id: '33333333-3333-4333-8333-333333333333',
          sprint_dir: 'sprints/08150001-recovery',
          planner_branch: 'cp-harness-prd-22222222-a4',
          workspace_spec: {
            repo: 'perfectuser21/cecelia',
            base_sha: BASE_SHA,
          },
        },
      },
      ...overrides,
    };
  }

  function dependencies(overrides = {}) {
    const readBlob = vi.fn(async () => Buffer.from(CONTENT));
    return {
      resolveBranchHead: vi.fn(async () => HEAD_SHA),
      resolveCommitDiff: vi.fn(async () => ({
        isAncestor: true,
        changedFiles: [{ path: TARGET_PATH, status: 'modified' }],
      })),
      resolveCommitPathEntry: vi.fn(async () => ({
        sha: ENTRY_SHA,
        type: 'blob',
        mode: '100644',
      })),
      readBlobBySha: readBlob,
      ...overrides,
    };
  }

  it('ignores caller branch, SHA, path, and content claims and seals the exact server blob', async () => {
    const { resolveRemoteExactCommitBlob } = await import(
      '../remote-exact-commit-blob-resolver.js'
    );
    const resolveBranchHead = vi.fn(async () => HEAD_SHA);
    const resolveCommitDiff = vi.fn(async () => ({
      isAncestor: true,
      changedFiles: [{ path: TARGET_PATH, status: 'modified' }],
    }));
    const resolveCommitPathEntry = vi.fn(async () => ({
      sha: ENTRY_SHA,
      type: 'blob',
      mode: '100644',
    }));
    const readBlobBySha = vi.fn(async () => Buffer.from(CONTENT));
    const attempt = authoritativeAttempt();
    const callerResult = {
      status: 'completed',
      artifacts: [
        {
          type: 'git_artifact',
          branch: 'cp-attacker',
          head_sha: 'c'.repeat(40),
          path: 'stolen.md',
          content: 'forged git artifact',
        },
        {
          type: 'file',
          kind: 'planner_prd',
          verification_status: 'verified',
          content: 'forged planner PRD',
        },
      ],
    };

    const resolved = await resolveRemoteExactCommitBlob(
      { attempt, result: callerResult },
      { resolveBranchHead, resolveCommitDiff, resolveCommitPathEntry, readBlobBySha },
    );

    const contentSha256 = createHash('sha256').update(Buffer.from(CONTENT)).digest('hex');
    const changedFilesDigest = createHash('sha256')
      .update(JSON.stringify([TARGET_PATH]))
      .digest('hex');
    expect(resolveBranchHead).toHaveBeenCalledOnce();
    expect(resolveBranchHead).toHaveBeenCalledWith({
      repo: 'perfectuser21/cecelia',
      branch: 'cp-harness-prd-22222222-a4',
    });
    expect(resolveCommitDiff).toHaveBeenCalledWith({
      repo: 'perfectuser21/cecelia',
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
    });
    expect(resolveCommitPathEntry).toHaveBeenCalledWith({
      repo: 'perfectuser21/cecelia',
      headSha: HEAD_SHA,
      path: TARGET_PATH,
    });
    expect(readBlobBySha).toHaveBeenCalledWith({
      repo: 'perfectuser21/cecelia',
      blobSha: ENTRY_SHA,
    });
    expect(resolved.sanitizedResult).toEqual({
      ...callerResult,
      artifacts: [{
        type: 'git_artifact',
        kind: 'planner_prd',
        repo: 'perfectuser21/cecelia',
        path: TARGET_PATH,
        branch: 'cp-harness-prd-22222222-a4',
        head_sha: HEAD_SHA,
        verification_status: 'verified',
      }],
      server_verification: {
        planner_git_artifact: {
          method: 'git_branch_head',
          artifact: {
            repo: 'perfectuser21/cecelia',
            path: TARGET_PATH,
            branch: 'cp-harness-prd-22222222-a4',
            head_sha: HEAD_SHA,
          },
        },
        planner_recovery_receipt: {
          head_sha: HEAD_SHA,
          content_sha256: contentSha256,
          byte_length: Buffer.byteLength(CONTENT),
          changed_files_digest: changedFilesDigest,
          verification_method: 'remote_exact_commit_blob',
        },
      },
    });
    expect(resolved.exactEvidence).toMatchObject({
      repo: 'perfectuser21/cecelia',
      base_sha: BASE_SHA,
      head_sha: HEAD_SHA,
      prd_path: TARGET_PATH,
      resolved_branch: 'cp-harness-prd-22222222-a4',
      content: CONTENT,
      content_sha256: contentSha256,
      byte_length: Buffer.byteLength(CONTENT),
      changed_files: [TARGET_PATH],
      changed_files_digest: changedFilesDigest,
      verification_method: 'remote_exact_commit_blob',
    });

    const terminalAttempt = {
      ...attempt,
      status: 'completed',
      result: resolved.sanitizedResult,
    };
    const observed = getVerifiedRemotePlannerPrdArtifact({
      runId: attempt.run_id,
      task: { payload: { sprint_dir: 'sprints/08150001-recovery' } },
      attemptRows: [terminalAttempt],
      logRows: [{
        action: 'verdict:attempt_callback',
        detail: {
          run_id: attempt.run_id,
          attempt_id: attempt.id,
          role: 'planner',
          status: 'completed',
          lease_generation: 3,
          artifacts: resolved.sanitizedResult.artifacts,
          server_verification: {
            planner_git_artifact: resolved.sanitizedResult
              .server_verification.planner_git_artifact,
          },
        },
      }],
    });
    expect(observed).toEqual(resolved.sanitizedResult.artifacts[0]);
  });

  it('rejects non-ancestor lineage', async () => {
    const { resolveRemoteExactCommitBlob } = await import(
      '../remote-exact-commit-blob-resolver.js'
    );
    await expect(resolveRemoteExactCommitBlob(
      { attempt: authoritativeAttempt(), result: { status: 'completed', artifacts: [] } },
      dependencies({
        resolveCommitDiff: vi.fn(async () => ({ isAncestor: false, changedFiles: [] })),
      }),
    )).rejects.toMatchObject({ message: 'planner_recovery_base_not_ancestor', status: 409 });
  });

  it.each([
    ['zero files', []],
    ['multiple files', [
      { path: TARGET_PATH, status: 'modified' },
      { path: 'README.md', status: 'modified' },
    ]],
    ['renamed file', [{
      path: TARGET_PATH,
      previousPath: 'sprints/old/sprint-prd.md',
      status: 'renamed',
    }]],
  ])('rejects a diff that is not exactly the target PRD: %s', async (_label, changedFiles) => {
    const { resolveRemoteExactCommitBlob } = await import(
      '../remote-exact-commit-blob-resolver.js'
    );
    await expect(resolveRemoteExactCommitBlob(
      { attempt: authoritativeAttempt(), result: { status: 'completed', artifacts: [] } },
      dependencies({ resolveCommitDiff: vi.fn(async () => ({ isAncestor: true, changedFiles })) }),
    )).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ['missing', null, 'planner_recovery_blob_invalid'],
    ['empty', Buffer.from(' \n\t'), 'planner_recovery_blob_empty'],
    ['fatal UTF-8', Buffer.from([0xc3, 0x28]), 'planner_recovery_blob_utf8_invalid'],
    ['over 512 KiB', Buffer.alloc((512 * 1024) + 1, 0x61), 'planner_recovery_blob_too_large'],
  ])('rejects %s exact blob bytes', async (_label, blob, message) => {
    const { resolveRemoteExactCommitBlob } = await import(
      '../remote-exact-commit-blob-resolver.js'
    );
    await expect(resolveRemoteExactCommitBlob(
      { attempt: authoritativeAttempt(), result: { status: 'completed', artifacts: [] } },
      dependencies({ readBlobBySha: vi.fn(async () => blob) }),
    )).rejects.toMatchObject({ message, status: 409 });
  });

  it.each([
    ['a symlink', { type: 'blob', mode: '120000' }],
    ['a submodule', { type: 'commit', mode: '160000' }],
    ['a non-blob object', { type: 'tree', mode: '040000' }],
  ])('rejects %s at the exact PRD path without reading its bytes', async (_label, entry) => {
    const { resolveRemoteExactCommitBlob } = await import(
      '../remote-exact-commit-blob-resolver.js'
    );
    const readBlob = vi.fn(async () => Buffer.from(CONTENT));
    const deps = dependencies({
      resolveCommitPathEntry: vi.fn(async () => ({ sha: ENTRY_SHA, ...entry })),
      readBlobBySha: readBlob,
    });

    await expect(resolveRemoteExactCommitBlob(
      { attempt: authoritativeAttempt(), result: { status: 'completed', artifacts: [] } },
      deps,
    )).rejects.toMatchObject({
      message: 'planner_recovery_blob_entry_invalid',
      status: 409,
    });
    expect(readBlob).not.toHaveBeenCalled();
  });

  it('rejects unverified remote machine identity before any Git lookup', async () => {
    const { resolveRemoteExactCommitBlob } = await import(
      '../remote-exact-commit-blob-resolver.js'
    );
    const deps = dependencies();
    await expect(resolveRemoteExactCommitBlob({
      attempt: authoritativeAttempt({ machine_attestation_status: 'pending' }),
      result: { status: 'completed', artifacts: [] },
    }, deps)).rejects.toMatchObject({
      message: 'planner_recovery_remote_attestation_invalid',
      status: 409,
    });
    expect(deps.resolveBranchHead).not.toHaveBeenCalled();
  });

  it('rejects a planner branch containing a slash before Git lookup', async () => {
    const { resolveRemoteExactCommitBlob } = await import(
      '../remote-exact-commit-blob-resolver.js'
    );
    const deps = dependencies();
    const attempt = authoritativeAttempt({
      task_bundle: {
        inputs: {
          ...authoritativeAttempt().task_bundle.inputs,
          planner_branch: 'cp-harness/prd',
        },
      },
    });

    await expect(resolveRemoteExactCommitBlob({
      attempt,
      result: { status: 'completed', artifacts: [] },
    }, deps)).rejects.toMatchObject({
      message: 'planner_recovery_authority_invalid',
      status: 409,
    });
    expect(deps.resolveBranchHead).not.toHaveBeenCalled();
  });

  it.each([
    ['branch', {}, '/git/ref/heads/'],
    ['path', {
      resolveBranchHead: vi.fn(async () => HEAD_SHA),
      resolveCommitDiff: vi.fn(async () => ({
        isAncestor: true,
        changedFiles: [{ path: TARGET_PATH, status: 'modified' }],
      })),
    }, `/git/commits/${HEAD_SHA}`],
    ['blob', {
      resolveBranchHead: vi.fn(async () => HEAD_SHA),
      resolveCommitDiff: vi.fn(async () => ({
        isAncestor: true,
        changedFiles: [{ path: TARGET_PATH, status: 'modified' }],
      })),
      resolveCommitPathEntry: vi.fn(async () => ({
        sha: ENTRY_SHA,
        type: 'blob',
        mode: '100644',
      })),
    }, `/git/blobs/${ENTRY_SHA}`],
  ])('maps a missing exact GitHub %s object to deterministic 409', async (
    _stage,
    deps,
    expectedEndpoint,
  ) => {
    const { resolveRemoteExactCommitBlob } = await import(
      '../remote-exact-commit-blob-resolver.js'
    );
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    const fetchFn = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchFn);

    await expect(resolveRemoteExactCommitBlob(
      { attempt: authoritativeAttempt(), result: { status: 'completed', artifacts: [] } },
      deps,
    )).rejects.toMatchObject({ status: 409 });
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining(expectedEndpoint),
      expect.any(Object),
    );
  });

  it.each([
    ['GitHub 401', vi.fn(async () => new Response('', { status: 401 }))],
    ['GitHub 403', vi.fn(async () => new Response('', { status: 403 }))],
    ['GitHub 429', vi.fn(async () => new Response('', { status: 429 }))],
    ['GitHub 500', vi.fn(async () => new Response('', { status: 500 }))],
    ['network timeout', vi.fn(async () => {
      throw new DOMException('timed out', 'AbortError');
    })],
  ])('maps %s to retryable 503', async (_label, fetchFn) => {
    const { resolveRemoteExactCommitBlob } = await import(
      '../remote-exact-commit-blob-resolver.js'
    );
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    vi.stubGlobal('fetch', fetchFn);

    await expect(resolveRemoteExactCommitBlob(
      { attempt: authoritativeAttempt(), result: { status: 'completed', artifacts: [] } },
    )).rejects.toMatchObject({ status: 503 });
  });

  it('maps other deterministic GitHub 4xx responses to 409', async () => {
    const { resolveRemoteExactCommitBlob } = await import(
      '../remote-exact-commit-blob-resolver.js'
    );
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 422 })));

    await expect(resolveRemoteExactCommitBlob(
      { attempt: authoritativeAttempt(), result: { status: 'completed', artifacts: [] } },
    )).rejects.toMatchObject({ status: 409 });
  });

  it('rejects oversized Content-Length before reading a Git blob response body', async () => {
    const { defaultExactBlobReader } = await import(
      '../remote-exact-commit-blob-resolver.js'
    );
    const cancel = vi.fn(async () => {});
    const getReader = vi.fn();
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => String((512 * 1024) + 1) },
      body: { cancel, getReader },
    })));

    await expect(defaultExactBlobReader({
      repo: 'perfectuser21/cecelia',
      blobSha: ENTRY_SHA,
    })).rejects.toMatchObject({
      message: 'planner_recovery_blob_too_large',
      status: 409,
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(getReader).not.toHaveBeenCalled();
  });

  it('cancels a chunked Git blob response as soon as it crosses 512 KiB', async () => {
    const { defaultExactBlobReader } = await import(
      '../remote-exact-commit-blob-resolver.js'
    );
    const cancel = vi.fn(async () => {});
    const releaseLock = vi.fn();
    const read = vi.fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(300 * 1024) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(300 * 1024) });
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: { getReader: () => ({ read, cancel, releaseLock }) },
    })));

    await expect(defaultExactBlobReader({
      repo: 'perfectuser21/cecelia',
      blobSha: ENTRY_SHA,
    })).rejects.toMatchObject({
      message: 'planner_recovery_blob_too_large',
      status: 409,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
