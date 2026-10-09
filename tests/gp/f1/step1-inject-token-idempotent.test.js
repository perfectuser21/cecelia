// F1「工厂 · 开发闭环」步骤 1「接单进车间即分档」—— 边：harness-worktree clone URL 凭据注入
//
// Regression: injectTokenIntoUrl 双 token race（Brain issue 946a5fcb）
//
// 接单进车间的第一动作就是 ensureHarnessWorktree 把 base_repo clone 成独立 worktree。
// 根因：harness-worktree.js 的 injectTokenIntoUrl 用 url.replace(/^https:\/\//, ...) 注入
// x-access-token 凭据，但**不检查 url 是否已含凭据**。当 cloneSource 已经带 token 时
// （golden_path_proposal 的 base_repo 空 → 回落 DEFAULT_BASE_REPO 这个 promisor 部分克隆 →
// promisor 分支读 git remote get-url origin 当 cloneSource，而并发 harness 活动使 origin
// 瞬时带 token），会二次注入产生 https://x-access-token:T@x-access-token:T@host/... 畸形 URL，
// git clone 无法解析 host 直接失败，整条 spawn 秒挂 → 车间根本进不去。
//
// 本文件按决策 109dd8eb 写在这条边上：真 ensureHarnessWorktree（不 mock harness-worktree），
// 只注入 execFn/statFn/tokenFn 假边（容器/文件系统在 CI 里起不了）。锁死「注入必须幂等：
// 无论 cloneSource 是否已带 token，clone URL 里 x-access-token 只能出现一次」。
import { describe, it, expect } from 'vitest';
import { ensureHarnessWorktree } from '../../../packages/brain/src/harness-worktree.js';

describe('F1 step1 · harness-worktree injectTokenIntoUrl 幂等（防双 token race）', () => {
  const NEW_TOKEN = 'github_pat_NEWTOKEN';

  function countToken(url) {
    return (url.match(/x-access-token:/g) || []).length;
  }

  it('cloneSource 已含 x-access-token 时，clone URL 只注入一次（不双 token）', async () => {
    const alreadyTokenized =
      'https://x-access-token:github_pat_OLDTOKEN@github.com/perfectuser21/cecelia.git';
    const calls = [];
    const execFn = async (_cmd, args) => {
      calls.push(args.join(' '));
      return { stdout: '' };
    };
    // requestedCloneSource(带 token 的 URL) 与 wtPath 都当作不存在 → 走远端 clone 分支
    const statFn = async () => false;
    const tokenFn = async () => NEW_TOKEN;

    await ensureHarnessWorktree({
      taskId: 'inject01',
      baseRepo: alreadyTokenized,
      execFn,
      statFn,
      tokenFn,
      logFn: () => {},
    });

    const cloneCall = calls.find((c) => c.startsWith('clone'));
    expect(cloneCall).toBeDefined();
    // 核心断言：clone URL 里 x-access-token 只能出现一次
    expect(countToken(cloneCall)).toBe(1);
    // 且不得出现双 token 畸形串
    expect(cloneCall).not.toMatch(/x-access-token:[^@]+@x-access-token:/);
  });

  it('promisor 本地源、origin 已带 token（真实生产触发路径）时，clone URL 只注入一次', async () => {
    const LOCAL = '/Users/administrator/perfect21/cecelia';
    const tokenizedOrigin =
      'https://x-access-token:github_pat_OLDTOKEN@github.com/perfectuser21/cecelia.git';
    const calls = [];
    const execFn = async (_cmd, args) => {
      const cmd = args.join(' ');
      calls.push(cmd);
      // 本地源是 promisor 部分克隆
      if (cmd.includes('config --bool remote.origin.promisor')) return { stdout: 'true\n' };
      // promisor 分支读 origin URL 当 cloneSource —— 此处 origin 瞬时带了 token
      if (cmd.includes('remote get-url origin')) return { stdout: tokenizedOrigin + '\n' };
      return { stdout: '' };
    };
    // requestedCloneSource(本地路径)存在 → cloneSourceIsLocal=true；wtPath 不存在 → 走 clone
    const statFn = async (p) => p === LOCAL;
    const tokenFn = async () => NEW_TOKEN;

    await ensureHarnessWorktree({
      taskId: 'inject02',
      baseRepo: LOCAL,
      execFn,
      statFn,
      tokenFn,
      logFn: () => {},
    });

    const cloneCall = calls.find((c) => c.startsWith('clone'));
    expect(cloneCall).toBeDefined();
    expect(countToken(cloneCall)).toBe(1);
    expect(cloneCall).not.toMatch(/x-access-token:[^@]+@x-access-token:/);
  });
});
