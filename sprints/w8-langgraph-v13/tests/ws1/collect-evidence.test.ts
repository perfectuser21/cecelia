import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const SCRIPT = resolve(REPO_ROOT, 'sprints/w8-langgraph-v13/scripts/collect-evidence.sh');

describe('Workstream 1 — collect-evidence.sh [BEHAVIOR]', () => {
  it('script file exists at expected path', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it('script is executable', () => {
    const mode = statSync(SCRIPT).mode;
    expect(mode & 0o111).not.toBe(0);
  });

  it('exits non-zero with usage on stderr when called with no args', () => {
    const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect((r.stderr || '') + (r.stdout || '')).toMatch(/usage|Usage|USAGE/);
  });

  it('DRY_RUN=1 with valid args exits 0 and stdout names trace.txt + db-snapshot.json + pr-link.txt', () => {
    const r = spawnSync(
      'bash',
      [SCRIPT, '00000000-0000-0000-0000-000000000000', '/tmp/w8v13-evidence-dryrun'],
      { encoding: 'utf8', env: { ...process.env, DRY_RUN: '1' } },
    );
    expect(r.status).toBe(0);
    const out = (r.stdout || '') + (r.stderr || '');
    expect(out).toMatch(/trace\.txt/);
    expect(out).toMatch(/db-snapshot\.json/);
    expect(out).toMatch(/pr-link\.txt/);
  });
});
