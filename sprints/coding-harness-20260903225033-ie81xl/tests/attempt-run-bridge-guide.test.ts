import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('四个独立章节与全部正负 oracle 同时成立', () => {
    const output = execFileSync(process.execPath, [
      'sprints/coding-harness-20260903225033-ie81xl/tests/contract-oracles.mjs',
      'all',
    ], { encoding: 'utf8' });
    expect(output).toContain('P1/N1 PASS');
    expect(output).toContain('P2/N2 PASS');
    expect(output).toContain('P3/N3 PASS');
    expect(output).toContain('P4/N4 PASS');
    expect(output).toContain('P5 PASS');
  });
});
