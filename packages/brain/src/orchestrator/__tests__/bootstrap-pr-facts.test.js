import { describe, expect, it } from 'vitest';
import { validateBootstrapPrFacts } from '../../../../../scripts/lib/validate-bootstrap-pr.mjs';

const sourceHeadSha = 'a'.repeat(40);
const squashMergeSha = 'b'.repeat(40);
const expected = {
  repository: 'perfectuser21/cecelia',
  sourceHeadSha,
  mergeSha: squashMergeSha,
};

function squashFixture(overrides = {}) {
  return {
    state: 'closed',
    merged: true,
    head: { sha: sourceHeadSha },
    // A squash commit is a distinct commit and does not need to contain the
    // source head as a Git ancestor. GitHub's merged PR fact is authoritative.
    merge_commit_sha: squashMergeSha,
    base: {
      ref: 'main',
      repo: { full_name: 'perfectuser21/cecelia' },
    },
    ...overrides,
  };
}

describe('bootstrap GitHub PR authority', () => {
  it('accepts an exact GitHub-authoritative squash merge identity', () => {
    expect(validateBootstrapPrFacts(squashFixture(), expected)).toMatchObject({
      sourceHeadSha,
      mergeSha: squashMergeSha,
      merged: true,
      baseRef: 'main',
    });
  });

  it.each([
    [{ head: { sha: 'c'.repeat(40) } }, 'head'],
    [{ merge_commit_sha: 'd'.repeat(40) }, 'merge'],
    [{ merged: false }, 'merged'],
    [{ base: { ref: 'develop', repo: { full_name: expected.repository } } }, 'base'],
  ])('rejects mismatched %s authority', (overrides) => {
    expect(() => validateBootstrapPrFacts(
      squashFixture(overrides),
      expected,
    )).toThrow('github_pr_facts_mismatch');
  });
});
