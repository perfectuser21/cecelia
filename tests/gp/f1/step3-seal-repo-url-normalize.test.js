/**
 * GP-Anchor: factory/F1 造完真验 #step3
 *
 * 第 30 批（r61 run d117a28a 冤案，r59 同因翻案）：
 *
 * seal 的 readRepoFile 把 task payload.base_repo **完整 GitHub URL**
 * （https://github.com/perfectuser21/cecelia.git）原样传给 readGitArtifact，
 * normalizeArtifactRepo/assertSupportedRepo 白名单只认 owner/repo 全名与短名
 * → throw "supported authoritative repository" → contract-test-paths-seal 的
 * catch 吞掉真实原因 → 误报 FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE →
 * r59/r61 四次封印拒绝全是冤案（r61 propose 分支 tree 实证文件真实存在，
 * proposer 照 28 批对症文案建了文件仍被拒杀）。
 *
 * 修复：
 * ① normalizeArtifactRepo 支持完整 GitHub URL（https/git@/ssh）归一到
 *    owner/repo 再走白名单——manual-task-post-anchor-trap 死规矩要求
 *    base_repo 必须完整 URL，权威读取层必须认它。
 * ② seal 的 readRepoFile catch 不吞原因：unresolved 条目附 error 片段
 *    （失败必须留真实原因铁律——r59 误诊为 proposer 不建文件正是被吞因坑的）。
 */
import { describe, expect, it } from 'vitest';
import { normalizeArtifactRepo } from '../../../packages/brain/src/orchestrator/git-artifact-reader.js';
import { assertTestContractResolvable } from '../../../packages/brain/src/orchestrator/contract-test-paths-seal.js';

describe('① normalizeArtifactRepo 支持完整 GitHub URL（r61 冤案）', () => {
  it('https URL（带 .git）归一到 owner/repo', () => {
    expect(normalizeArtifactRepo('https://github.com/perfectuser21/cecelia.git'))
      .toBe('perfectuser21/cecelia');
  });

  it('https URL（不带 .git）归一', () => {
    expect(normalizeArtifactRepo('https://github.com/perfectuser21/zenithjoy-workspace'))
      .toBe('perfectuser21/zenithjoy-workspace');
  });

  it('负向：白名单外的 URL 仍 fail-closed throw', () => {
    expect(() => normalizeArtifactRepo('https://github.com/evil/attacker.git'))
      .toThrow(/supported authoritative repository/);
  });

  it('负向：既有形态不回归——全名/短名/null 语义不变', () => {
    expect(normalizeArtifactRepo('perfectuser21/cecelia')).toBe('perfectuser21/cecelia');
    expect(normalizeArtifactRepo('cecelia')).toBe('perfectuser21/cecelia');
    expect(normalizeArtifactRepo(null)).toBe(null);
  });
});

describe('② seal readRepoFile 失败留真实原因（不再吞成裸 UNRESOLVABLE）', () => {
  const contract = [
    '# 合同',
    '## Test Contract',
    '',
    '| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |',
    '|---|---|---|---|',
    '| 回归 | `tests/gp/f1/some-repo-test.test.js` | `does the thing` | 红 |',
    '',
  ].join('\n');
  const artifacts = [
    { path: 'sprints/x/contract-draft.md', content: contract },
  ];

  it('readRepoFile throw 时，拒绝信息携带底层错误片段', () => {
    let error = null;
    try {
      assertTestContractResolvable(contract, artifacts, {
        readRepoFile: () => { throw new Error('git artifact repo must be a supported authoritative repository: https://github.com/x/y.git'); },
      });
    } catch (e) { error = e; }
    expect(error).not.toBeNull();
    expect(error.message).toMatch(/UNRESOLVABLE/);
    expect(error.message).toMatch(/supported authoritative repository|read_error/);
  });
});
