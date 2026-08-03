import { describe, expect, it } from 'vitest';
import {
  evaluateValidationIdentityPolicy,
} from '../validation-identity-policy.js';

const ATTEMPT_ID = '1884647e-b67a-4bfd-a44c-3d2e84509526';
const SNAPSHOT_ID = '13eb5828-b09a-4e76-ba5e-14309f842263';

describe('GAN validation identity policy', () => {
  it.each([
    `attempt_id=${ATTEMPT_ID}`,
    `ATTEMPT_ID="${ATTEMPT_ID}"`,
    `d.attempt_id !== '${ATTEMPT_ID}'`,
    `capability_snapshot_id=${SNAPSHOT_ID}`,
    `CAPABILITY_SNAPSHOT_ID="${SNAPSHOT_ID}"`,
    `snapshotId: '${SNAPSHOT_ID}'`,
  ])('rejects a mutable GAN identity literal: %s', (contractContent) => {
    const result = evaluateValidationIdentityPolicy(contractContent);

    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      code: 'premature_validation_identity_binding',
    });
  });

  it('accepts late-bound runtime identity and immutable run/candidate bindings', () => {
    const result = evaluateValidationIdentityPolicy(`
RUN_ID="a6e3ba3f-9856-4353-b05f-29f1049f7ca0"
ATTEMPT_ID="$HARNESS_ATTEMPT_ID"
SNAPSHOT_ID="$CAPABILITY_SNAPSHOT_ID"
EXPECTED_SHA="c305f6217da65bb69413c39e621b7e797e0fb189"
`);

    expect(result).toEqual({ ok: true, violations: [] });
  });

  it('does not confuse a stable run UUID on the same line with a late-bound attempt', () => {
    const result = evaluateValidationIdentityPolicy(
      `RUN_ID="a6e3ba3f-9856-4353-b05f-29f1049f7ca0"; ATTEMPT_ID="$HARNESS_ATTEMPT_ID"`,
    );

    expect(result).toEqual({ ok: true, violations: [] });
  });
});
