import { describe, it, expect } from 'vitest';
import {
  ensureHarnessWorktree,
  harnessTaskWorktreePath,
  harnessSubTaskWorktreePath,
  DEFAULT_BASE_REPO,
} from '../harness-worktree.js';

const ZENITHJOY = '/Users/administrator/perfect21/zenithjoy';

describe('harness-worktree cross-repo', () => {
  it('ensureHarnessWorktree: wtPath 在 DEFAULT_BASE_REPO 下，clone source 是 baseRepo', async () => {
    const calls = [];
    const execFn = async (_cmd, args) => {
      calls.push(args.join(' '));
      return { stdout: '' };
    };
    const statFn = async () => false; // 目录不存在，走 clone 路径

    const wtPath = await ensureHarnessWorktree({
      taskId: 'beefcafe11111111',
      baseRepo: ZENITHJOY,
      execFn,
      statFn,
      logFn: () => {},
    });

    // wtPath 必须在 cecelia 下，不在 zenithjoy 下
    expect(wtPath).toContain(DEFAULT_BASE_REPO);
    expect(wtPath).not.toContain(ZENITHJOY);

    // clone 命令：source = zenithjoy，dest = cecelia 下路径
    const cloneCall = calls.find(c => c.includes('clone'));
    expect(cloneCall).toContain(ZENITHJOY);       // source 是 zenithjoy
    expect(cloneCall).toContain(DEFAULT_BASE_REPO); // dest 在 cecelia 下
    // 关键：不能把 zenithjoy 克隆进自己
    expect(cloneCall).not.toMatch(new RegExp(`${ZENITHJOY}.*${ZENITHJOY}`));
  });

  it('harnessTaskWorktreePath: opts.baseRepo 不影响 wtPath', () => {
    const p = harnessTaskWorktreePath('beefcafe11111111', { baseRepo: ZENITHJOY });
    expect(p).toContain(DEFAULT_BASE_REPO);
    expect(p).not.toContain('zenithjoy');
  });

  it('harnessSubTaskWorktreePath: opts.baseRepo 不影响 wtPath', () => {
    const p = harnessSubTaskWorktreePath('init-id-1234', 'ws1', { baseRepo: ZENITHJOY });
    expect(p).toContain(DEFAULT_BASE_REPO);
    expect(p).not.toContain('zenithjoy');
  });
});
