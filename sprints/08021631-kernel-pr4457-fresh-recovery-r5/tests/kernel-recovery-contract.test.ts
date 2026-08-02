import { describe, it, expect } from 'vitest';
import {
  validateBaseline,
  validateManifest,
  validateExactHead,
  validateHumanReviewGate,
  validateBranchProtection,
  validateArtifactBoundary,
  validatePreflightOrder,
  validateSinglePush,
} from '../../../scripts/harness/kernel-recovery-contract.mjs';

describe('Draft PR #4457 fresh recovery contract [BEHAVIOR]', () => {
  it('拒绝 freeze 前已有 fetch merge 或 write', async () => {
    const rows = [
      { sequence: 1, action: 'fetch', at: '2026-08-02T00:00:00Z' },
      { sequence: 2, action: 'baseline_freeze_started', at: '2026-08-02T00:00:01Z' },
      { sequence: 3, action: 'baseline_freeze_completed', at: '2026-08-02T00:00:02Z' },
    ];
    await expect(validatePreflightOrder(rows)).rejects.toThrow(/freeze|fetch|order|first/);
  });

  it('拒绝目标分支多次 push 或中间 SHA push', async () => {
    const oldOid = 'a'.repeat(40);
    const midOid = 'b'.repeat(40);
    const finalOid = 'c'.repeat(40);
    const updates = [
      { ref: 'refs/heads/cp-kernel-phase5b-a1-review-fixes', old_oid: oldOid, new_oid: midOid },
      { ref: 'refs/heads/cp-kernel-phase5b-a1-review-fixes', old_oid: midOid, new_oid: finalOid },
    ];
    await expect(validateSinglePush(updates, { oldOid, finalOid, count: 1 })).rejects.toThrow(/push|count|intermediate|single/);
  });

  it('拒绝同计数但路径身份漂移的 baseline', async () => {
    const expected = ['a.js', 'b.js'];
    const actual = ['a.js', 'c.js'];
    await expect(validateBaseline({ conflict_file_count: 2, conflict_paths: actual }, { conflict_paths: expected })).rejects.toThrow(/path|identity|baseline/);
  });

  it('拒绝 annotation identity 漂移', async () => {
    const frozen = [{ classification_level: 'failure', path: 'a.js', start_line: 1, end_line: 1, rule_id: 'js/x', message_sha256: 'a'.repeat(64) }];
    const current = [{ ...frozen[0], path: 'b.js' }];
    await expect(validateBaseline({ annotations: current }, { annotations: frozen })).rejects.toThrow(/annotation|identity|baseline/);
  });

  it('拒绝 strict=false 或 contexts 非精确集合', async () => {
    const required = ['ci-passed', 'Harness V5 Gate Passed', 'Smoke Glob Runner Passed'];
    await expect(validateBranchProtection({ strict: false, contexts: required }, required)).rejects.toThrow(/strict|protection/);
    await expect(validateBranchProtection({ strict: true, contexts: [...required, 'extra'] }, required)).rejects.toThrow(/context|exact/);
  });

  it('拒绝 evaluator 在 local phase 预填', async () => {
    const rows = [{ phase: 'local', oracle: 'conflict-resolution' }, { phase: 'evaluator', oracle: 'evaluator' }];
    await expect(validateManifest(rows, { phase: 'local' })).rejects.toThrow(/phase|evaluator|future/);
  });

  it('拒绝 Git 树内或非 root-owned 的证据目录', async () => {
    await expect(validateArtifactBoundary({ repoRealpath: '/workspace/repo', artifactRealpath: '/workspace/repo/.evidence', uid: 0, mode: 0o700 })).rejects.toThrow(/Git|repo|outside/);
    await expect(validateArtifactBoundary({ repoRealpath: '/workspace/repo', artifactRealpath: '/var/lib/cecelia/a1', uid: 1000, mode: 0o700 })).rejects.toThrow(/root|owner|uid/);
  });

  it('拒绝 hash 不匹配的 oracle manifest', async () => {
    await expect(validateManifest([{ child_started: true, exit_code: 0, raw_log_sha256: '0'.repeat(64), entry_sha256: '1'.repeat(64) }])).rejects.toThrow(/hash|manifest/);
  });

  it('拒绝移动的 final head', async () => {
    await expect(validateExactHead({ expected: 'a'.repeat(40), before: 'a'.repeat(40), after: 'b'.repeat(40) })).rejects.toThrow(/head|SHA/);
  });

  it('只接受 OPEN Draft 且 autoMerge=null', async () => {
    await expect(validateHumanReviewGate({ state: 'OPEN', isDraft: false, autoMergeRequest: null })).rejects.toThrow(/Draft|review/);
  });
});
