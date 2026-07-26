import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseE2EScript } from '../../src/harness/evaluate.js';

const fixtures: string[] = [];

function writeContract(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'evaluate-e2e-parser-'));
  fixtures.push(dir);
  const contractPath = path.join(dir, 'contract-draft.md');
  writeFileSync(contractPath, content);
  return contractPath;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe('parseE2EScript shared canonical parser', () => {
  it('fails closed when an earlier H3 E2E occurrence precedes an exact H2', () => {
    const contractPath = writeContract([
      '# Contract',
      '',
      '### E2E 验收',
      '',
      '```bash',
      'echo earlier',
      '```',
      '',
      '## E2E 验收',
      '',
      '```bash',
      'echo later',
      '```',
      '',
    ].join('\n'));

    expect(parseE2EScript(contractPath)).toBeNull();
  });

  it('retains the evaluator-supported broad single-heading family', () => {
    const contractPath = writeContract([
      '# Contract',
      '',
      '### E2E smoke suffix',
      '',
      '```bash',
      'echo broad',
      '```',
      '',
    ].join('\n'));

    expect(parseE2EScript(contractPath)).toBe('echo broad\n');
  });
});
