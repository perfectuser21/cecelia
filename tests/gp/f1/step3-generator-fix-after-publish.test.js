// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：publisher 发布成功 → CI 红 → generator-fix 续改
//
// 2026-08-19 生产实证（run 2a813900 / 0bccc85d，两次死法一模一样）：
//   generator 产出候选 → publisher push + 开 PR 成功 → CI 红 → kernel 派 spawn:generator-fix
//   → worker /prepare 500：workspace_source_attempt_unavailable → run 死。
//   根因：publisher exit=0 时 releaseSourceCandidate 删掉了 generator 的候选工作区，
//   而 generator-fix 的 source_attempt_id 正指向它。
//   两边各自的单测都 mock 了 workspaceManager、各自全绿；矛盾只在这条边上。
//
// 本文件按决策 109dd8eb（产物闸）写在边上：真 attempt-runner + 真 workspace-manager + 真 git，
// 只 mock docker（CI 里起不了容器）。不得 vi.mock attempt-runner / workspace-manager。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import attemptRunnerModule from '../../../packages/brain/scripts/fleet-worker/attempt-runner.cjs';
import workspaceManagerModule from '../../../packages/brain/scripts/fleet-worker/workspace-manager.cjs';

const { createAttemptRunner } = attemptRunnerModule;
const { createWorkspaceManager } = workspaceManagerModule;
const execFileAsync = promisify(execFile);

const REPO = 'perfectuser21/cecelia';
const WORKER_ID = 'us-mac-m4';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const GEN_A = '22222222-2222-4222-8222-222222222222';
const PUB_B = '33333333-3333-4333-8333-333333333333';
const FIX_C = '44444444-4444-4444-8444-444444444444';
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IMAGE_DIGEST = `cecelia/runner@sha256:${'a'.repeat(64)}`;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
async function runCommand(command, args, options = {}) {
  const { stdout = '' } = await execFileAsync(command, args, { cwd: options.cwd, encoding: 'utf8' });
  return { stdout: stdout.trim() };
}

function createGitFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-f1-step3-'));
  const source = path.join(root, 'source');
  const remote = path.join(root, 'remote.git');
  fs.mkdirSync(source);
  git(['init', '--initial-branch=main'], source);
  git(['config', 'user.name', 'GP Test'], source);
  git(['config', 'user.email', 'gp-test@example.invalid'], source);
  fs.writeFileSync(path.join(source, 'README.md'), 'gp f1 step3\n');
  git(['add', 'README.md'], source);
  git(['commit', '-m', 'fixture'], source);
  const sha = git(['rev-parse', 'HEAD'], source);
  git(['clone', '--bare', source, remote], root);
  return {
    root, remote, sha,
    mirrorRoot: path.join(root, 'mirrors'),
    worktreeRoot: path.join(root, 'worktrees'),
    quarantineRoot: path.join(root, 'quarantine'),
  };
}

// docker 是唯一 mock 的邻居：CI 起不了容器。wait 用可控 Promise 模拟容器退出。
function fakeDocker() {
  const waits = new Map();
  return {
    prepare: vi.fn(async ({ attemptId }) => ({
      containerId: `container-${attemptId}`,
      credentialFifo: `/controlled/runtime/${attemptId}/credential.fifo`,
      githubCredentialFifo: `/controlled/runtime/${attemptId}/github-credential.fifo`,
    })),
    start: vi.fn(async ({ containerId }) => ({ containerId })),
    inspect: vi.fn(async () => ({ status: 'running' })),
    remove: vi.fn(async () => ({ removed: true })),
    wait: vi.fn(async ({ containerId } = {}) => {
      let resolve;
      const p = new Promise((r) => { resolve = r; });
      waits.set(containerId, resolve);
      return p;
    }),
    listOwned: vi.fn(async () => []),
    exit(attemptId, statusCode) {
      const resolve = waits.get(`container-${attemptId}`);
      if (!resolve) throw new Error(`no wait registered for ${attemptId}`);
      resolve({ statusCode });
    },
  };
}

function inMemoryStateStore() {
  const states = new Map();
  return {
    states,
    save: async (entry) => { states.set(entry.attempt_id, { ...entry }); return entry; },
    get: async (id) => states.get(id) ?? null,
    delete: async (id) => states.delete(id),
    list: async () => [...states.values()].map((e) => ({ ...e })),
  };
}

const credential = Object.freeze({
  credentialRef: '55555555-5555-4555-8555-555555555555',
  accountId: 'team1',
  authJson: '{"tokens":{"access_token":"x"}}',
  metadata: {},
});
const githubCredential = Object.freeze({
  credentialRef: '66666666-6666-4666-8666-666666666666',
  token: 'github_pat_test',
  metadata: {},
});
const envelope = (attemptId, ref) => ({
  contract_version: 'credential-envelope/v1', credential_ref: ref, attempt_id: attemptId,
  account_id: 'team1', machine_id: WORKER_ID, issued_at: '2026-08-19T00:00:00.000Z',
  expires_at: '2026-08-19T02:00:00.000Z', payload_hash: `sha256:${'b'.repeat(64)}`, payload: 'p',
});

function prompt(role, attemptId, inputs = {}) {
  return JSON.stringify({
    instruction: 'Execute exactly one Harness role.',
    task_bundle: {
      contract_version: '1.0', run_id: RUN_ID, attempt_id: attemptId, hop: 1,
      phase: role === 'publisher' ? 'publish' : 'generate', role,
      objective: 'bounded',
      inputs: {
        task_id: TASK_ID, sprint_dir: 'sprints/gp-f1-step3', artifacts: [],
        pipeline_started_at: '2026-08-19T00:00:00.000Z', deadline_at: '2026-08-19T00:05:00.000Z',
        ...inputs,
      },
      constraints: { read_only: false, fresh_session: true, timeout_seconds: 300 },
      expected_output: `harness-result/${role}-v1`,
    },
    continuation: null,
  });
}

function request(fixture, { attemptId, role, sourceAttemptId = null, provider = 'codex', inputs = {} }) {
  return {
    attempt_id: attemptId,
    run_id: RUN_ID,
    lease_owner: 'dispatcher-1',
    lease_generation: 0,
    timeout_seconds: 300,
    workspace_spec: {
      repo: REPO, base_sha: fixture.sha, branch: 'cp-08191200-gp-f1-step3',
      expected_head_sha: null, mode: 'read-write', run_id: RUN_ID, attempt_id: attemptId,
      ...(sourceAttemptId ? { source_attempt_id: sourceAttemptId } : {}),
    },
    provider_spec: {
      provider, command: provider, args: ['exec', '--json'],
      stdin: prompt(role, attemptId, inputs), output: { format: 'jsonl' },
    },
    target: { machine: WORKER_ID, provider, account: 'team1', model: 'gpt-5', role },
    credential_envelope: envelope(attemptId, credential.credentialRef),
    github_credential_envelope: envelope(attemptId, githubCredential.credentialRef),
    callback_url: 'http://brain.internal:5221/api/brain/harness/callback',
    callback_token: 'callback-secret',
  };
}

describe('F1 step3 造完真验 — publisher 发布后 generator-fix 仍能基于原候选续改', () => {
  let fixture; let docker; let stateStore; let runner; let workspaceManager;

  beforeEach(() => {
    fixture = createGitFixture();
    workspaceManager = createWorkspaceManager({
      mirrorRoot: fixture.mirrorRoot,
      worktreeRoot: fixture.worktreeRoot,
      quarantineRoot: fixture.quarantineRoot,
      repoAllowlist: { [REPO]: fixture.remote },
      runCommand,
    });
    docker = fakeDocker();
    stateStore = inMemoryStateStore();
    runner = createAttemptRunner({
      workspaceManager,
      docker,
      stateStore,
      workerId: WORKER_ID,
      runnerImageDigest: IMAGE_DIGEST,
      credentialConsumer: { consume: () => credential },
      githubCredentialConsumer: { consume: () => githubCredential },
      resourceManager: {
        provision: async () => ({ runtime: {}, environment: {}, networkName: null }),
        release: async () => ({ status: 'released' }),
        releaseService: async () => ({ status: 'released' }),
        reconcile: async () => ({ removed_attempts: [] }),
      },
    });
  });

  afterEach(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  async function runToExit(req, statusCode) {
    await runner.prepare(req);
    await runner.start(req.attempt_id, { owner: req.lease_owner, generation: req.lease_generation });
    docker.exit(req.attempt_id, statusCode);
  }

  it('generator 候选 → publisher exit=0 → 候选仍在，generator-fix 可 prepare', async () => {
    // 1) generator A 产出候选（真 workspace，exit 0 → retained candidate）
    await runToExit(request(fixture, { attemptId: GEN_A, role: 'generator' }), 0);
    await vi.waitFor(async () => {
      expect((await stateStore.get(GEN_A))?.status).toBe('candidate');
    });
    const candidate = await stateStore.get(GEN_A);
    expect(fs.existsSync(candidate.workspace.path)).toBe(true);

    // 2) publisher B 基于 A 发布成功（exit 0）
    await runToExit(request(fixture, {
      attemptId: PUB_B, role: 'publisher', sourceAttemptId: GEN_A,
      inputs: { candidate: { source_attempt_id: GEN_A } },
    }), 0);
    await vi.waitFor(async () => {
      expect((await stateStore.get(PUB_B))?.status).toBe('terminal');
    });

    // 3) 边上的断言：publisher 成功后，generator 的候选必须还在——
    //    CI 红了 kernel 会派 generator-fix 基于它续改。
    expect((await stateStore.get(GEN_A))?.status, 'publisher 成功不得释放 generator 候选').toBe('candidate');
    expect(fs.existsSync(candidate.workspace.path), '候选工作区目录不得被删').toBe(true);

    // 4) generator-fix C 以 A 为 source 必须能 prepare（生产里这里 500）
    const fixReq = request(fixture, { attemptId: FIX_C, role: 'generator', sourceAttemptId: GEN_A });
    await expect(runner.prepare(fixReq)).resolves.toBeTruthy();
  });

  it('generator-fix 产出新候选后才释放被替代的旧候选（卫生不丢，只是挪到正确的时刻）', async () => {
    await runToExit(request(fixture, { attemptId: GEN_A, role: 'generator' }), 0);
    await vi.waitFor(async () => {
      expect((await stateStore.get(GEN_A))?.status).toBe('candidate');
    });
    const oldWorkspacePath = (await stateStore.get(GEN_A)).workspace.path;

    await runToExit(request(fixture, { attemptId: FIX_C, role: 'generator', sourceAttemptId: GEN_A }), 0);
    await vi.waitFor(async () => {
      expect((await stateStore.get(FIX_C))?.status).toBe('candidate');
    });
    // 旧候选被新候选替代 → 释放
    expect(await stateStore.get(GEN_A)).toBeNull();
    expect(fs.existsSync(oldWorkspacePath)).toBe(false);
  });
});
