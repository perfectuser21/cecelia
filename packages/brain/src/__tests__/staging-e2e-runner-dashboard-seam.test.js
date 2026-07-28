/**
 * A 方案 — harness 内部线 staging→promote 接缝对齐 dashboard。
 * 改动1：deployStaging 内部线拒绝 legacy 直接部署，由 ReleaseRun 独占 staging mutation。
 * 改动2：staging E2E scenario 用 deploy 返回的 stagingPort（内部线打 5223）。
 * 改动3：handlePromote 未注入 promoteExec 时，defaultPromoteExec 用 process.env.REPO_ROOT（非裸 getRepoRoot=容器内/）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn().mockResolvedValue(undefined), sendBark: vi.fn().mockResolvedValue(false) }));
vi.mock('../harness-final-e2e.js', () => ({ normalizeAcceptance: (a) => ({ scenarios: a.scenarios || [] }) }));

// 保留 staging-promote 真实实现，仅 spy defaultPromoteExec 以断言它收到的 repoRoot。
vi.mock('../staging-promote.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    defaultPromoteExec: vi.fn(() => () => ({ ok: true, output: 'mock-promote' })),
  };
});

import { deployStaging, runStagingE2E } from '../staging-e2e-runner.js';
import { defaultPromoteExec } from '../staging-promote.js';

describe('deployStaging — 内部线 mutation 归 ReleaseRun（改动1）', () => {
  let origEnv;
  beforeEach(() => { origEnv = process.env.REPO_ROOT; process.env.REPO_ROOT = '/fake/repo'; });
  afterEach(() => {
    if (origEnv === undefined) delete process.env.REPO_ROOT; else process.env.REPO_ROOT = origEnv;
  });

  it('internal → fail closed，不调用 legacy deploy-local.sh，保留 stagingPort 5223', async () => {
    const exec = vi.fn(() => '');
    const r = await deployStaging({ exec, line: 'internal' });
    expect(exec).not.toHaveBeenCalled();
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('release_run_authority_required');
    expect(r.stagingPort).toBe(5223);
  });

  it('非内部线 → staging-deploy.sh + stagingPort 5222（不回归 brain 路径）', async () => {
    const exec = vi.fn(() => '');
    const r = await deployStaging({ exec });
    expect(exec.mock.calls[0][0]).toBe('bash /fake/repo/scripts/staging-deploy.sh');
    expect(r.stagingPort).toBe(5222);
  });
});

describe('runStagingE2E 内部线 — repoRoot 用 REPO_ROOT + 验 5223', () => {
  let origEnv;
  beforeEach(() => {
    vi.clearAllMocks();
    origEnv = process.env.REPO_ROOT; process.env.REPO_ROOT = '/fake/repo';
  });
  afterEach(() => {
    if (origEnv === undefined) delete process.env.REPO_ROOT; else process.env.REPO_ROOT = origEnv;
  });

  it('未注入 promoteExec → defaultPromoteExec 用 process.env.REPO_ROOT（改动3 路径 bug）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const deploy = vi.fn(() => ({ status: 'success', output: 'deployed', stagingPort: 5223 }));
    const loadAcceptance = vi.fn(async () => ({ scenarios: [{ name: 's1', commands: [{ cmd: 'echo ok' }] }] }));
    const exec = vi.fn(() => 'ok');
    const task = { id: 't-int', payload: { initiative_id: 'i1', pr_url: 'https://pr/int', base_repo: 'perfectuser21/cecelia' } };

    const res = await runStagingE2E(task, { pool, deploy, loadAcceptance, exec });
    expect(res.verdict).toBe('PASS');
    expect(defaultPromoteExec).toHaveBeenCalledWith('/fake/repo');
  });

  it('内部线 staging E2E：dashboard 断言(5174) 打 staging 槽位 5223（用 deploy 返回的 stagingPort，改动2）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const deploy = vi.fn(() => ({ status: 'success', output: 'deployed', stagingPort: 5223 }));
    // P1#5：内部线 dashboard 断言引用 localhost:5174（dashboard dev）→ 映射到 staging 槽位 5223。
    // （旧 fixture 误用 localhost:5221(brain) 并断言→5223，编码的正是被修掉的"brain 打到静态站"bug。）
    const loadAcceptance = vi.fn(async () => ({ scenarios: [{ name: 's1', commands: [{ cmd: 'curl -s localhost:5174/' }] }] }));
    const execCmds = [];
    const exec = vi.fn((cmd) => { execCmds.push(cmd); return 'ok'; });
    const task = { id: 't-int2', payload: { initiative_id: 'i1', pr_url: 'https://pr/int', base_repo: 'perfectuser21/cecelia' } };

    await runStagingE2E(task, { pool, deploy, loadAcceptance, exec, promoteExec: vi.fn(() => ({ ok: true, output: 'x' })) });
    expect(execCmds.some((c) => c.includes(':5223'))).toBe(true);
    expect(execCmds.some((c) => c.includes(':5222'))).toBe(false);
  });

  it('internal line 经 runStagingE2E 时给 deploy 传 line=internal', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const deploy = vi.fn(() => ({ status: 'success', output: 'deployed', stagingPort: 5223 }));
    const loadAcceptance = vi.fn(async () => ({ scenarios: [{ name: 's1', commands: [{ cmd: 'echo ok' }] }] }));
    const task = { id: 't-int3', payload: { initiative_id: 'i1', pr_url: 'https://pr/int', base_repo: 'perfectuser21/cecelia' } };

    await runStagingE2E(task, { pool, deploy, loadAcceptance, exec: vi.fn(() => 'ok'), promoteExec: vi.fn(() => ({ ok: true, output: 'x' })) });
    expect(deploy).toHaveBeenCalledWith(expect.objectContaining({ line: 'internal' }));
  });
});
