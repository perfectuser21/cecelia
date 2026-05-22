import { describe, it, expect } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const ENGINE_ROOT = resolve(__dirname, '../..');
const STOP_SH = resolve(ENGINE_ROOT, 'hooks/stop.sh');
const STOP_DEV_SH = resolve(ENGINE_ROOT, 'hooks/stop-dev.sh');
const DEVLOOP_CHECK = resolve(ENGINE_ROOT, 'lib/devloop-check.sh');
const GUARDIAN = resolve(ENGINE_ROOT, 'lib/dev-heartbeat-guardian.sh');
const SHIP_FINALIZE = resolve(ENGINE_ROOT, 'scripts/ship-finalize.sh');

describe('stop.sh routing — post goal-hook refactor', () => {
  it('stop-dev.sh has been deleted', () => {
    expect(existsSync(STOP_DEV_SH)).toBe(false);
  });

  it('dev-heartbeat-guardian.sh has been deleted', () => {
    expect(existsSync(GUARDIAN)).toBe(false);
  });

  it('devloop-check.sh has been deleted', () => {
    expect(existsSync(DEVLOOP_CHECK)).toBe(false);
  });

  it('ship-finalize.sh has been deleted', () => {
    expect(existsSync(SHIP_FINALIZE)).toBe(false);
  });

  it('stop.sh does NOT invoke stop-dev.sh (no bash call)', () => {
    const source = readFileSync(STOP_SH, 'utf8');
    // Only check for actual invocation, not comments
    expect(source).not.toMatch(/^\s*bash\s+.*stop-dev\.sh/m);
    expect(source).not.toMatch(/^\s*\$SCRIPT_DIR\/stop-dev\.sh/m);
  });

  it('stop.sh still routes to stop-architect.sh and stop-decomp.sh', () => {
    const source = readFileSync(STOP_SH, 'utf8');
    expect(source).toContain('stop-architect.sh');
    expect(source).toContain('stop-decomp.sh');
  });

  it('stop.sh exits 0 in plain session (no lock files)', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'stop-sh-plain-'));
    try {
      execSync(
        'git init -q && git config user.email "ci@test" && git config user.name "CI" && git commit --allow-empty -m "init"',
        { cwd: testDir, stdio: 'pipe' }
      );
      const result = spawnSync('bash', [STOP_SH], {
        cwd: testDir,
        env: {
          ...process.env,
          CLAUDE_HOOK_STDIN_JSON_OVERRIDE: JSON.stringify({
            session_id: 'test-plain-session',
            cwd: testDir,
            transcript_path: ''
          }),
          HOME: testDir,
        },
        timeout: 5000
      });
      expect(result.status).toBe(0);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
