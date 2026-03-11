/**
 * Claude CLI Authentication Probe
 *
 * Runs `claude --version` to verify the CLI is installed and authenticated.
 * Used by dispatchNextTask() before spawning any agent tasks.
 */

import { spawn } from 'child_process';

export const PROBE_TIMEOUT_MS = 5000;
const AUTH_ERROR_PATTERNS = [
  'not logged in',
  'please run /login',
  'please run claude /login',
  'authentication required',
];

/**
 * Run `claude --version` as a health probe.
 *
 * Returns { ok: true } on success.
 * Returns { ok: false, eventType, reason, output } when probe fails:
 *   - exit code non-zero
 *   - output contains auth error keywords
 *   - times out after PROBE_TIMEOUT_MS (5s)
 *
 * @param {{ _spawnFn?: Function }} options - DI for testing
 * @returns {Promise<{ ok: boolean, eventType?: string, reason?: string, output?: string }>}
 */
export async function runClaudeProbe({ _spawnFn } = {}) {
  const spawnFn = _spawnFn || spawn;
  return new Promise((resolve) => {
    let output = '';
    let settled = false;

    const child = spawnFn('claude', ['--version'], {
      env: { ...process.env },
    });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      if (!settled) {
        settled = true;
        resolve({ ok: false, eventType: 'claude_probe_timeout', reason: 'probe timed out after 5s', output });
      }
    }, PROBE_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { output += chunk.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      const lc = output.toLowerCase();
      const authFail = AUTH_ERROR_PATTERNS.some((p) => lc.includes(p));
      if (authFail) {
        resolve({ ok: false, eventType: 'claude_auth_lost', reason: 'Not logged in', output });
      } else if (code !== 0) {
        resolve({ ok: false, eventType: 'claude_probe_failed', reason: `exit code ${code}`, output });
      } else {
        resolve({ ok: true, output });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ ok: false, eventType: 'claude_probe_failed', reason: err.message, output });
    });
  });
}
