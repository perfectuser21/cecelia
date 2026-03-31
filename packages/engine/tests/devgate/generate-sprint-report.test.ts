import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

const SCRIPT = resolve(__dirname, '../../scripts/devgate/generate-sprint-report.sh');

describe('generate-sprint-report.sh', () => {
  it('script file exists', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it('script is executable', () => {
    const mode = statSync(SCRIPT).mode;
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  it('script contains required section markers', () => {
    const { readFileSync } = require('fs');
    const content = readFileSync(SCRIPT, 'utf8');
    const sections = ['## Planner Isolation', '## Sprint Contract', '## CI Gate', '## Scores'];
    for (const section of sections) {
      expect(content).toContain(section);
    }
  });

  it('script does not make external HTTP calls', () => {
    const { readFileSync } = require('fs');
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).not.toContain('curl http://');
    expect(content).not.toContain('curl https://');
  });

  it('script references seal files', () => {
    const { readFileSync } = require('fs');
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('.seal');
  });

  it('exits with error when no branch argument given', () => {
    let code = 0;
    try {
      execSync(`bash "${SCRIPT}"`, { encoding: 'utf8', stdio: 'pipe' });
    } catch (e: any) {
      code = e.status ?? 1;
    }
    expect(code).toBeGreaterThan(0);
  });
});
