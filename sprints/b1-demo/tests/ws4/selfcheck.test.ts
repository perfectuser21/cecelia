import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const SRC_DIR = resolve(process.cwd(), 'sprints/b1-demo');
const ARTIFACTS = ['schema.md', 'config.json', 'query.md', 'selfcheck.sh'];

let fixtureDir: string;

function copyFixture(): void {
  for (const f of ARTIFACTS) {
    copyFileSync(join(SRC_DIR, f), join(fixtureDir, f));
  }
}

function runSelfCheck(): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync('bash', ['./selfcheck.sh'], {
    cwd: fixtureDir,
    encoding: 'utf8',
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

describe('Workstream 4 — selfcheck.sh [BEHAVIOR]', () => {
  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'b1-demo-selfcheck-'));
    copyFixture();
  });

  afterEach(() => {
    if (fixtureDir && existsSync(fixtureDir)) {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('exits 0 when all four artifacts are present and valid', () => {
    const { status, stdout, stderr } = runSelfCheck();
    expect(status, `stdout=${stdout}\nstderr=${stderr}`).toBe(0);
  });

  it('exits non-zero when schema.md is missing', () => {
    unlinkSync(join(fixtureDir, 'schema.md'));
    const { status } = runSelfCheck();
    expect(status).not.toBe(0);
    expect(status).not.toBeNull();
  });

  it('exits non-zero when config.json is invalid JSON', () => {
    writeFileSync(join(fixtureDir, 'config.json'), '{ this is not valid json,,, }');
    const { status } = runSelfCheck();
    expect(status).not.toBe(0);
    expect(status).not.toBeNull();
  });

  it('exits non-zero when query.md lacks b1-demo reference', () => {
    writeFileSync(
      join(fixtureDir, 'query.md'),
      '# stripped query doc\n\nno module reference here\n'
    );
    const { status } = runSelfCheck();
    expect(status).not.toBe(0);
    expect(status).not.toBeNull();
  });
});
