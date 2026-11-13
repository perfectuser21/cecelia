

import { describe, expect, test } from 'vitest';
import { appendAttemptVerdict } from '../../../packages/brain/src/routes/harness-callback.js';

import { CANONICAL_SIGNATURE, createDecisionLog, evaluatorAttempt, evidenceInvalidResult } from './kernel-convergence-signatures-fixture.js';

describe('R5/R6 structured convergence signatures', () => {
  test('evaluator callback canonicalizes a structured failure_signature and ignores feedback text', async () => {
    const log = createDecisionLog();
    const attempt = evaluatorAttempt('71000000-0000-4000-8000-000000000071');

    await appendAttemptVerdict(
      attempt,
      evidenceInvalidResult(attempt.id, [
        ' stale receipt ',
        'missing screenshot',
        'stale receipt',
      ]),
      log.db,
    );

    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]).toMatchObject({
      action: 'verdict:evaluate',
      detail: {
        failure_class: 'evidence_invalid',
        failure_signature: CANONICAL_SIGNATURE,
      },
    });
    expect(log.rows[0].detail).not.toHaveProperty('failure_signature_text');
  });

});
