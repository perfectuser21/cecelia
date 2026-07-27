import { describe, expect, it } from 'vitest';

import {
  buildApprovedContractDispatchContext,
  verifyApprovedContractReference,
} from '../approved-contract-provenance.js';

describe('approved-contract-provenance pairing coverage', () => {
  it('exports dispatch and reference helpers for approved contract provenance', () => {
    const manifestDigest = 'a'.repeat(64);
    const sourceCommitSha = 'b'.repeat(40);
    const sourceCommitShaAlt = 'c'.repeat(40);
    const manifest = {
      manifest_digest: manifestDigest,
      source_commit_sha: sourceCommitSha,
    };

    expect(
      verifyApprovedContractReference({
        manifest,
        expectedManifestDigest: manifestDigest,
        currentPrSha: sourceCommitSha,
      }).ok,
    ).toBe(true);

    const context = buildApprovedContractDispatchContext({
      contract: {
        manifest_digest: manifestDigest,
        source_commit_sha: sourceCommitSha,
        approved_manifest: manifest,
      },
      role: 'evaluator',
      currentPrSha: sourceCommitShaAlt,
    });

    expect(context.env.APPROVED_CONTRACT_MANIFEST_DIGEST).toBe(manifestDigest);
    expect(context.env.APPROVED_CONTRACT_SOURCE_SHA).toBe(sourceCommitSha);
    expect(context.env.PR_HEAD_SHA).toBe(sourceCommitShaAlt);
    expect(context.inputs.contract.approved_manifest.manifest_digest).toBe(manifestDigest);
  });
});
