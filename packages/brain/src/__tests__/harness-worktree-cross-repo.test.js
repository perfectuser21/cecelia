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

  it('ensureHarnessWorktree: 跨仓库目录已存在且合法时复用，不重新 clone', async () => {
    const calls = [];
    const rmCalls = [];
    const execFn = async (_cmd, args) => {
      const cmd = args.join(' ');
      calls.push(cmd);
      // rev-parse 返回 true（是合法 git repo）
      if (cmd.includes('rev-parse --is-inside-work-tree')) return { stdout: 'true\n' };
      // remote get-url origin on worktree → 返回 ZENITHJOY（匹配 cloneSource）
      if (cmd.includes('remote get-url origin') && !cmd.includes('rev-parse')) return { stdout: ZENITHJOY + '\n' };
      // rev-parse --abbrev-ref HEAD → 合法 cp-* 分支
      if (cmd.includes('rev-parse --abbrev-ref HEAD')) return { stdout: 'cp-05210000-ws-beefcafe-ws1\n' };
      return { stdout: '' };
    };
    const statFn = async () => true; // 目录已存在
    const rmFn = async () => { rmCalls.push(1); };

    const wtPath = await ensureHarnessWorktree({
      taskId: 'beefcafe11111111',
      baseRepo: ZENITHJOY,
      execFn,
      statFn,
      rmFn,
      logFn: () => {},
    });

    // wtPath 在 cecelia 下
    expect(wtPath).toContain(DEFAULT_BASE_REPO);
    expect(wtPath).not.toContain(ZENITHJOY);

    // 不应该有 clone 命令（复用已有目录）
    const cloneCall = calls.find(c => c.includes('clone'));
    expect(cloneCall).toBeUndefined();

    // 不应该有 rm（没有孤儿清理）
    expect(rmCalls).toHaveLength(0);

    // remote get-url 应该用 cloneSource（ZENITHJOY）去读 GitHub URL
    const getUrlOnSource = calls.find(c => c.includes('get-url origin') && c.includes(ZENITHJOY));
    // 注意：孤儿校验时读的是 wtPath 的 remote，不是 cloneSource；
    // H16 post-clone 时才读 cloneSource 的 remote——本路径不 clone 所以不走 H16
    // 只需验证 wtPath remote 被读了（孤儿校验）
    const getUrlOnWt = calls.find(c => c.includes('get-url origin'));
    expect(getUrlOnWt).toBeTruthy();
  });
});
