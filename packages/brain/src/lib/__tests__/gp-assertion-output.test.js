import { describe, expect, it } from 'vitest';
import {
  appendBufferTail,
  byteSafeTail,
  normalizeExecutionEvidence,
  redactAndBoundOutput,
  scenarioEvidenceFromOutput,
} from '../gp-assertion-output.js';

describe('GP assertion output evidence', () => {
  it.each([undefined, Number.NaN, -1, 1.5])(
    'fails closed when appending with an invalid byte limit: %s',
    (limit) => {
      expect(appendBufferTail(Buffer.from('old'), 'new', limit)).toEqual(
        Buffer.alloc(0),
      );
    },
  );

  it.each([undefined, Number.NaN, -1, 1.5])(
    'fails closed for an invalid byte limit: %s',
    (limit) => {
      expect(byteSafeTail('must-not-escape', limit)).toBe('');
    },
  );

  it('returns a valid UTF-8 tail within the byte limit', () => {
    const output = byteSafeTail(
      Buffer.concat([Buffer.from('prefix-🙂'), Buffer.alloc(16, 0xFF)]),
      16,
    );

    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(16);
    expect(byteSafeTail('prefix-🙂尾巴', 10)).toBe('🙂尾巴');
  });

  it('redacts bearer, quoted, JSON, and bare key secrets', () => {
    const output = redactAndBoundOutput(
      'Authorization: Bearer bearer-secret\n'
        + '{"api_key":"json-secret","token": "token-secret"}',
      "password='quoted-secret'\naccess_token=bare-secret",
    );

    for (const secret of [
      'bearer-secret',
      'json-secret',
      'token-secret',
      'quoted-secret',
      'bare-secret',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(5);
  });

  it.each([
    ['vitest', 'Tests  3 passed (3)\nTests  1 failed (1)', 4, 3, 1],
    ['pytest', '2 passed, 1 failed in 0.12s', 3, 2, 1],
  ])('extracts %s scenario evidence', (kind, text, count, passed, failed) => {
    expect(scenarioEvidenceFromOutput(kind, text)).toEqual({
      scenarioCount: count,
      scenarioEvidence: { kind, passed, failed },
    });
  });

  it('extracts bash scenario evidence only from the explicit marker', () => {
    expect(scenarioEvidenceFromOutput(
      'bash',
      'looks successful\nGP_ASSERTION_SCENARIO_COUNT=7',
    )).toEqual({
      scenarioCount: 7,
      scenarioEvidence: {
        kind: 'bash',
        marker: 'GP_ASSERTION_SCENARIO_COUNT',
      },
    });
  });

  it('preserves explicit execution evidence', () => {
    expect(normalizeExecutionEvidence({
      scenarioCount: 4,
      scenarioEvidence: { kind: 'custom', suite: 'receipt' },
      stdout: '0 passed',
    }, 'vitest')).toEqual({
      scenarioCount: 4,
      scenarioEvidence: { kind: 'custom', suite: 'receipt' },
    });
  });

  it('derives evidence when an executor omits structured evidence', () => {
    expect(normalizeExecutionEvidence({
      stdout: '1 passed',
      stderr: '',
    }, 'pytest')).toEqual({
      scenarioCount: 1,
      scenarioEvidence: { kind: 'pytest', passed: 1, failed: 0 },
    });
  });
});
