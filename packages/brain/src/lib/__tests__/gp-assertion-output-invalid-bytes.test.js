import { describe, expect, it } from 'vitest';
import {
  byteSafeTail,
  redactAndBoundOutput,
  scenarioEvidenceFromOutput,
} from '../gp-assertion-output.js';

describe('GP assertion invalid output bytes', () => {
  it('drops undecodable bytes instead of emitting replacement characters', () => {
    const output = byteSafeTail(Buffer.alloc(32, 0xFF), 16);

    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(16);
    expect(output).not.toContain('�');
  });

  it('does not join a credential key across an invalid byte', () => {
    const output = redactAndBoundOutput(Buffer.concat([
      Buffer.from('tok'),
      Buffer.from([0xFF]),
      Buffer.from('en=receipt-secret'),
    ]));

    expect(output).not.toContain('receipt-secret');
  });

  it('does not derive passing scenario evidence across an invalid byte', () => {
    const output = byteSafeTail(Buffer.concat([
      Buffer.from('Tests  1 pa'),
      Buffer.from([0xFF]),
      Buffer.from('ssed (1)'),
    ]), 64);

    expect(scenarioEvidenceFromOutput('vitest', output).scenarioCount).toBe(0);
  });
});
