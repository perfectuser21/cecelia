/**
 * A 方案 改动3（自杀 bug）：defaultPromoteExec 跑 promote-dashboard.sh 时必须注入
 * CECELIA_SKIP_BRAIN_PROMOTE=1——否则 promote-dashboard.sh 会跑 brain-deploy 重启
 * 执行它自己的 Brain（harness promote 在 Brain 容器内执行），pipeline 自杀。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileSyncMock = vi.fn(() => 'promoted');
vi.mock('child_process', () => ({ execFileSync: (...args) => execFileSyncMock(...args) }));

import { defaultPromoteExec } from '../staging-promote.js';

describe('defaultPromoteExec — 注入 CECELIA_SKIP_BRAIN_PROMOTE 防自杀', () => {
  beforeEach(() => execFileSyncMock.mockClear());

  it('execFileSync 的 env 必须含 CECELIA_SKIP_BRAIN_PROMOTE=1', () => {
    const promoteExec = defaultPromoteExec('/repo/root');
    const r = promoteExec();
    expect(r.ok).toBe(true);
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const optsArg = execFileSyncMock.mock.calls[0][2];
    expect(optsArg.env).toBeTruthy();
    expect(optsArg.env.CECELIA_SKIP_BRAIN_PROMOTE).toBe('1');
  });

  it('用传入的 repoRoot 拼绝对脚本路径 + cwd（不裸 getRepoRoot）', () => {
    const promoteExec = defaultPromoteExec('/repo/root');
    promoteExec();
    const [executable, args, optsArg] = execFileSyncMock.mock.calls[0];
    expect(executable).toBe('bash');
    expect(args).toEqual(['/repo/root/scripts/promote-dashboard.sh']);
    expect(optsArg.cwd).toBe('/repo/root');
  });

  it('env 保留原 process.env（只增不删）', () => {
    process.env.__SEAM_TEST_KEEP__ = 'keep-me';
    const promoteExec = defaultPromoteExec('/repo/root');
    promoteExec();
    const optsArg = execFileSyncMock.mock.calls[0][2];
    expect(optsArg.env.__SEAM_TEST_KEEP__).toBe('keep-me');
    delete process.env.__SEAM_TEST_KEEP__;
  });
});
