import { describe, it, expect } from 'vitest';
import {
  validateBaseline,
  validateManifest,
  validateExactHead,
  validateHumanReviewGate,
} from '../../../scripts/harness/kernel-recovery-contract.mjs';

describe('Draft PR #4457 fresh recovery contract [BEHAVIOR]', () => {
  it('拒绝缺失的 baseline', async () => {
    await expect(validateBaseline({})).rejects.toThrow(/baseline|source_head_sha/);
  });

  it('拒绝 hash 不匹配的 oracle manifest', async () => {
    await expect(validateManifest([{ child_started: true, exit_code: 0, raw_log_sha256: '0'.repeat(64) }])).rejects.toThrow(/hash|manifest/);
  });

  it('拒绝移动的 final head', async () => {
    await expect(validateExactHead({ expected: 'a'.repeat(40), before: 'a'.repeat(40), after: 'b'.repeat(40) })).rejects.toThrow(/head|SHA/);
  });

  it('只接受 OPEN Draft 且 autoMerge=null', async () => {
    await expect(validateHumanReviewGate({ state: 'OPEN', isDraft: false, autoMergeRequest: null })).rejects.toThrow(/Draft|review/);
  });
});

