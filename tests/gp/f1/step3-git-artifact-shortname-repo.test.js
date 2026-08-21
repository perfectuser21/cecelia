// GP 锚：factory/F1 造完真验 — step3（造→验闭环的 merge 权威闸）
// 回归：r40（run 08b3b2b5 hop 182）merge_pr 被 deny:impact:git_diff_unavailable 无限卡死。
// 根因：harness_impact_contracts 存量 239 条 repo=短名（'cecelia'），跨仓库安全加固
// （assertSupportedRepo）要求 owner/repo 全名，短名直接 throw；readChangedFiles 的
// catch 把它折叠成 git_diff_unavailable(retryable=true)，merge 闸每轮重试每轮死。
// 修法：resolveFetchRemote 前对短名做 WORKSPACE_REPOSITORIES 唯一后缀规范化
// （'cecelia' → 'perfectuser21/cecelia'）；歧义/未知短名仍 fail-closed。
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ensureGitCommit,
  normalizeArtifactRepo,
} from '../../../packages/brain/src/orchestrator/git-artifact-reader.js';
import { WORKSPACE_REPOSITORIES } from '../../../packages/brain/src/orchestrator/workspace-spec.js';

function initRepoWithCommit() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gar-shortname-'));
  const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  run('init', '-q');
  run('config', 'user.email', 't@t');
  run('config', 'user.name', 't');
  writeFileSync(path.join(dir, 'a.txt'), 'x');
  run('add', 'a.txt');
  run('commit', '-q', '-m', 'c1');
  const sha = run('rev-parse', 'HEAD').trim();
  return { dir, sha };
}

describe('git-artifact-reader 短名 contract repo 规范化（F1 step3 merge 闸回归）', () => {
  it('normalizeArtifactRepo 把唯一后缀短名规范化为白名单全名', () => {
    expect(normalizeArtifactRepo('cecelia')).toBe('perfectuser21/cecelia');
    expect(normalizeArtifactRepo('zenithjoy-workspace'))
      .toBe('perfectuser21/zenithjoy-workspace');
  });

  it('normalizeArtifactRepo 对全名/null 原样透传', () => {
    expect(normalizeArtifactRepo('perfectuser21/cecelia')).toBe('perfectuser21/cecelia');
    expect(normalizeArtifactRepo(null)).toBe(null);
  });

  it('normalizeArtifactRepo 对未知短名 fail-closed（不静默放行）', () => {
    expect(() => normalizeArtifactRepo('not-a-repo'))
      .toThrow(/supported authoritative repository/);
  });

  it('ensureGitCommit 接受存量短名 repo（r40 死锁复现）：本地已有 commit 时不 throw', () => {
    const { dir, sha } = initRepoWithCommit();
    // 修前：assertSupportedRepo('cecelia') throw
    // "git artifact repo must be a supported authoritative repository: cecelia"
    // → readChangedFiles catch → merge 闸 git_diff_unavailable 无限重试。
    expect(() => ensureGitCommit(sha, { cwd: dir, repo: 'cecelia' })).not.toThrow();
  });

  it('ensureGitCommit 对白名单外 repo 仍 fail-closed（安全边界不放松）', () => {
    const { dir, sha } = initRepoWithCommit();
    expect(() => ensureGitCommit(sha, { cwd: dir, repo: 'evil/other' }))
      .toThrow(/supported authoritative repository/);
  });

  it('白名单不含歧义后缀（规范化的唯一性前提成立）', () => {
    const suffixes = WORKSPACE_REPOSITORIES.map((r) => r.split('/')[1]);
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });
});
