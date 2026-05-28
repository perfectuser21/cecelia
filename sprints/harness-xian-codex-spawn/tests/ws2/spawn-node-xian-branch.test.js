import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnNode } from '../../../../packages/brain/src/workflows/harness-task.graph.js';

function makeState(overrides = {}) {
  return {
    task: { id: 'ws2', title: 'Test task', payload: {} },
    initiativeId: 'init-test-001',
    githubToken: 'gh-mock-token',
    worktreePath: '/mock-wt',
    fix_round: 0,
    contractBranch: null,
    contractImported: false,
    ...overrides,
  };
}

function makeOpts(overrides = {}) {
  return {
    ensureWorktree: vi.fn(async () => '/mock-wt'),
    spawnDetached: vi.fn(async () => ({ exit_code: 0 })),
    resolveToken: vi.fn(async () => 'gh-mock-token'),
    poolOverride: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    execFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
    ...overrides,
  };
}

describe('spawnNode HARNESS_XIAN_ENABLED 分支 [BEHAVIOR]', () => {
  beforeEach(() => {
    delete process.env.HARNESS_XIAN_ENABLED;
    delete process.env.HARNESS_XIAN_BRIDGE_URL;
  });

  afterEach(() => {
    delete process.env.HARNESS_XIAN_ENABLED;
    delete process.env.HARNESS_XIAN_BRIDGE_URL;
  });

  it('HARNESS_XIAN_ENABLED 未设置（默认）→ spawnDetached 被调用，spawnBridge 未调用', async () => {
    const spawnBridgeMock = vi.fn(async () => ({ status: 'accepted', job_id: 'job-001' }));
    const opts = makeOpts({ spawnBridge: spawnBridgeMock });

    await spawnNode(makeState(), opts);

    expect(opts.spawnDetached).toHaveBeenCalledOnce();
    expect(spawnBridgeMock).not.toHaveBeenCalled();
  });

  it("HARNESS_XIAN_ENABLED='false' → spawnDetached 被调用（严格 === 'true' 检查）", async () => {
    process.env.HARNESS_XIAN_ENABLED = 'false';
    const spawnBridgeMock = vi.fn(async () => ({ status: 'accepted', job_id: 'job-002' }));
    const opts = makeOpts({ spawnBridge: spawnBridgeMock });

    await spawnNode(makeState(), opts);

    expect(opts.spawnDetached).toHaveBeenCalledOnce();
    expect(spawnBridgeMock).not.toHaveBeenCalled();
  });

  it("HARNESS_XIAN_ENABLED='1' → spawnDetached 被调用（非严格值不触发 Bridge）", async () => {
    process.env.HARNESS_XIAN_ENABLED = '1';
    const spawnBridgeMock = vi.fn(async () => ({ status: 'accepted', job_id: 'job-003' }));
    const opts = makeOpts({ spawnBridge: spawnBridgeMock });

    await spawnNode(makeState(), opts);

    expect(opts.spawnDetached).toHaveBeenCalledOnce();
    expect(spawnBridgeMock).not.toHaveBeenCalled();
  });

  it("HARNESS_XIAN_ENABLED='true' → opts.spawnBridge 被调用，spawnDetached 未调用", async () => {
    process.env.HARNESS_XIAN_ENABLED = 'true';
    process.env.HARNESS_XIAN_BRIDGE_URL = 'http://100.86.57.69:3458/run';
    const spawnBridgeMock = vi.fn(async () => ({ status: 'accepted', job_id: 'job-004' }));
    const opts = makeOpts({ spawnBridge: spawnBridgeMock });

    await spawnNode(makeState(), opts);

    expect(spawnBridgeMock).toHaveBeenCalledOnce();
    expect(opts.spawnDetached).not.toHaveBeenCalled();
  });

  it("HARNESS_XIAN_ENABLED='true' → opts.spawnBridge 第一参数为 HARNESS_XIAN_BRIDGE_URL", async () => {
    const bridgeUrl = 'http://100.86.57.69:3458/run';
    process.env.HARNESS_XIAN_ENABLED = 'true';
    process.env.HARNESS_XIAN_BRIDGE_URL = bridgeUrl;
    const spawnBridgeMock = vi.fn(async () => ({ status: 'accepted', job_id: 'job-005' }));
    const opts = makeOpts({ spawnBridge: spawnBridgeMock });

    await spawnNode(makeState(), opts);

    const [firstArg] = spawnBridgeMock.mock.calls[0];
    expect(firstArg).toBe(bridgeUrl);
  });

  it("HARNESS_XIAN_ENABLED='true' → Bridge payload 的 callback_url 含 finalContainerId", async () => {
    process.env.HARNESS_XIAN_ENABLED = 'true';
    process.env.HARNESS_XIAN_BRIDGE_URL = 'http://bridge:3458/run';
    const spawnBridgeMock = vi.fn(async () => ({ status: 'accepted', job_id: 'job-006' }));
    const opts = makeOpts({ spawnBridge: spawnBridgeMock });

    const result = await spawnNode(makeState(), opts);

    const [, payload] = spawnBridgeMock.mock.calls[0];
    expect(typeof payload.callback_url).toBe('string');
    expect(payload.callback_url).toContain(result.containerId);
  });

  it("HARNESS_XIAN_ENABLED='true'，Bridge 抛错 → fallback 到 spawnDetached，run 不中断", async () => {
    process.env.HARNESS_XIAN_ENABLED = 'true';
    process.env.HARNESS_XIAN_BRIDGE_URL = 'http://bridge:3458/run';
    const spawnBridgeMock = vi.fn(async () => { throw new Error('Connection refused'); });
    const opts = makeOpts({ spawnBridge: spawnBridgeMock });

    const result = await spawnNode(makeState(), opts);

    expect(spawnBridgeMock).toHaveBeenCalledOnce();
    expect(opts.spawnDetached).toHaveBeenCalledOnce();
    expect(result.containerId).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('HARNESS_XIAN_ENABLED 字面量存在于 harness-task.graph.js [ARTIFACT]', async () => {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const filePath = fileURLToPath(
      new URL('../../../../packages/brain/src/workflows/harness-task.graph.js', import.meta.url)
    );
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('HARNESS_XIAN_ENABLED');
  });
});
