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

  it('DRY_RUN=1 plan mentions brain_boot_time and breaker OPEN check (R3+R5)', () => {
    const r = spawnSync(
      'bash',
      [SCRIPT, '00000000-0000-0000-0000-000000000000', '/tmp/w8v13-evidence-dryrun'],
      { encoding: 'utf8', env: { ...process.env, DRY_RUN: '1' } },
    );
    expect(r.status).toBe(0);
    const out = (r.stdout || '') + (r.stderr || '');
    // R3: 干跑计划必须提到 brain 容器启动时间抓取
    expect(out).toMatch(/brain_boot_time/);
    // R5: 干跑计划必须提到 breaker OPEN 关键字检测
    expect(out).toMatch(/breaker\s+OPEN/i);
  });
});
