import { describe, expect, it } from 'vitest';
import { byteSafeTail } from '../gp-assertion-output.js';

describe('GP assertion invalid output bytes', () => {
  it('drops undecodable bytes instead of emitting replacement characters', () => {
    const output = byteSafeTail(Buffer.alloc(32, 0xFF), 16);

    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(16);
    expect(output).not.toContain('�');
  });
});
