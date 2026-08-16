/**
 * TDD Red — ground-truth 提案 remote 解析（base_repo→repo 兜底 + 禁退 origin）。
 * 复现 run 7a8e5319 假失败根因：payload.base_repo 为空、payload.repo='cecelia' 未被兜底
 * → 旧代码退 'origin'（本地 remote 看不到 GitHub 提案分支）→ proposeBranchRn 恒 0。
 *
 * 被测边（禁 mock）：ground-truth.js 纯解析函数 resolveProposalRemote —— 真调，无替身。
 */
import { describe, it, expect } from 'vitest';
import { resolveProposalRemote } from '../../../packages/brain/src/orchestrator/ground-truth.js';

describe('resolveProposalRemote：提案分支观测 remote 解析 [BEHAVIOR]', () => {
  it('base_repo 空 + repo=cecelia 短名 → 解析出 GitHub URL，remote 串含 https://github.com/perfectuser21/cecelia.git', () => {
    const { remote, unresolved } = resolveProposalRemote({ base_repo: null, repo: 'cecelia' });
    expect(unresolved).toBe(false);
    // remote 串直接进 `git ls-remote --heads <remote>`，必须是带引号的完整 GitHub clone URL
    expect(remote).toContain('https://github.com/perfectuser21/cecelia.git');
    // 绝不退回本地 'origin'
    expect(remote).not.toBe('origin');
    expect(String(remote).toLowerCase()).not.toContain('origin');
  });

  it('base_repo 已是完整 URL → 直接采用（不改语义）', () => {
    const { remote, unresolved } = resolveProposalRemote({
      base_repo: 'https://github.com/perfectuser21/cecelia.git',
    });
    expect(unresolved).toBe(false);
    expect(remote).toContain('https://github.com/perfectuser21/cecelia.git');
  });

  it('base_repo 与 repo 皆空 → 不解析出 remote，unresolved=true（禁退 origin）', () => {
    const { remote, unresolved } = resolveProposalRemote({ base_repo: null, repo: null });
    expect(unresolved).toBe(true);
    // 未解析到 → 不得给出可对 origin 执行 ls-remote 的 remote 值
    expect(remote == null || remote === '').toBe(true);
    expect(remote).not.toBe('origin');
  });
});
