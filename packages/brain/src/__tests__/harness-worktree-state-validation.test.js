/**
 * 测试 ensureHarnessWorktree 的 .git 状态校验：
 *
 * 修补 W7.3 cleanupStaleWorktrees 留下的孤儿 dir 场景。
 * cleanup race 后 dir 可能存在但 .git 是孤儿独立 repo（不是 baseRepo 的 clone），
 * 仅靠 `git rev-parse --is-inside-work-tree` 判断会 false positive，
 * 导致 docker-executor 拿这个 worktree 跑容器后秒崩 exit 125。
 */
import { describe, it, expect } from 'vitest';
import { ensureHarnessWorktree } from '../harness-worktree.js';

const BASE = '/tmp/cec';

function makeExecFn(scenario) {
  // scenario: 'orphan' | 'valid' | 'wrong-remote'
  const calls = [];
  const execFn = async (cmd, args) => {
    const joined = [cmd, ...args].join(' ');
    calls.push(joined);
    if (joined.includes('rev-parse --is-inside-work-tree')) {
      return { stdout: 'true\n' };
    }
    if (joined.includes('rev-parse --abbrev-ref HEAD')) {
      return { stdout: 'cp-04240814-ws-abcdef12\n' };
    }
    if (joined.includes('remote get-url origin')) {
      if (scenario === 'orphan') {
        // 孤儿 repo 没有 origin remote
        const err = new Error("error: No such remote 'origin'");
        err.code = 2;
        throw err;
      }
      if (scenario === 'wrong-remote') {
        // 有 remote 但指向其他地方（残留旧 clone）
        return { stdout: 'https://github.com/some/other-repo.git\n' };
      }
      // valid: 指向 baseRepo
      return { stdout: `${BASE}\n` };
    }
    return { stdout: '' };
  };
  return { execFn, calls };
}

describe('ensureHarnessWorktree .git 状态校验', () => {
  it('孤儿 dir（rev-parse=true 但无 origin remote）→ rm + 重建', async () => {
    const { execFn, calls } = makeExecFn('orphan');
    let rmCalled = false;
    let rmPath = null;
    const rmFn = async (p) => { rmCalled = true; rmPath = p; };
    const statFn = async () => true; // dir 存在

    await ensureHarnessWorktree({
      taskId: '39d535f3deadbeef',
      baseRepo: BASE,
      execFn, statFn, rmFn,
      logFn: () => {},
    });

    // 期望：探测到 origin remote 缺失 → rm 整个 dir
    expect(rmCalled).toBe(true);
    expect(rmPath).toBe('/tmp/cec/.claude/worktrees/harness-v2/task-39d535f3');
    // 期望：rm 之后重新 clone
    const cloneCall = calls.find(c => c.startsWith('git clone'));
    expect(cloneCall).toBeTruthy();
    expect(cloneCall).toContain(BASE);
  });

  it('合法 worktree（origin remote 指向 baseRepo）→ 复用，不 rm 不 clone', async () => {
    const { execFn, calls } = makeExecFn('valid');
    let rmCalled = false;
    const rmFn = async () => { rmCalled = true; };
    const statFn = async () => true;

    const p = await ensureHarnessWorktree({
      taskId: 'beefcafe11111111',
      baseRepo: BASE,
      execFn, statFn, rmFn,
      logFn: () => {},
    });

    expect(p).toBe('/tmp/cec/.claude/worktrees/harness-v2/task-beefcafe');
    expect(rmCalled).toBe(false);
    expect(calls.some(c => c.startsWith('git clone'))).toBe(false);
  });

  it('origin 指向其他仓库（残留旧 clone）→ rm + 重建', async () => {
    const { execFn, calls } = makeExecFn('wrong-remote');
    let rmCalled = false;
    const rmFn = async () => { rmCalled = true; };
    const statFn = async () => true;

    await ensureHarnessWorktree({
      taskId: 'cafef00d22222222',
      baseRepo: BASE,
      execFn, statFn, rmFn,
      logFn: () => {},
    });

    expect(rmCalled).toBe(true);
    expect(calls.some(c => c.startsWith('git clone'))).toBe(true);
  });

  it('dir 不存在 → 走原 clone 路径，校验不触发', async () => {
    const { execFn, calls } = makeExecFn('valid');
    const statFn = async () => false;
    let rmCalled = false;
    const rmFn = async () => { rmCalled = true; };

    await ensureHarnessWorktree({
      taskId: 'aaaabbbb11112222',
      baseRepo: BASE,
      execFn, statFn, rmFn,
      logFn: () => {},
    });

    expect(rmCalled).toBe(false);
    // 没触发 orphan 校验（orphan 校验是 git -C <wtPath> remote get-url，跑在已存在 dir 路径上）
    // H16 后 clone 路径也调 git -C <baseRepo> remote get-url —— 区别在 -C 后面是 baseRepo 不是 wtPath
    const wtPath = '/tmp/cec/.claude/worktrees/harness-v2/task-aaaabbbb';
    expect(calls.some(c => c.includes('remote get-url') && c.includes(wtPath))).toBe(false);
    // 走 clone
    expect(calls.some(c => c.startsWith('git clone'))).toBe(true);
  });
});
