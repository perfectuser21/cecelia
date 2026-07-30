import { spawn } from 'node:child_process';
import {
  appendBufferTail,
  byteSafeTail,
  scenarioEvidenceFromOutput,
} from './gp-assertion-output.js';

const PROCESS_CAPTURE_LIMIT_BYTES = 4096 * 4;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_KILL_GRACE_MS = 5_000;

export function createAssertionExecutor({
  spawnFn = spawn,
  captureLimitBytes = PROCESS_CAPTURE_LIMIT_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
} = {}) {
  return (executable, argv, options) => (
    new Promise((resolveExecution, rejectExecution) => {
      const child = spawnFn(executable, argv, {
        cwd: options.cwd,
        shell: false,
      });
      const effectiveTimeoutMs = options.timeoutMs ?? timeoutMs;
      let stdoutBytes = Buffer.alloc(0);
      let stderrBytes = Buffer.alloc(0);
      let settled = false;
      let timedOut = false;
      let forceKillTimer;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        clearTimeout(forceKillTimer);
        resolveExecution(result);
      };
      const timeoutResult = () => {
        const stdout = byteSafeTail(stdoutBytes, captureLimitBytes);
        const stderrTail = byteSafeTail(stderrBytes, captureLimitBytes);
        return {
          exitCode: 124,
          signal: 'SIGKILL',
          timedOut: true,
          stdout,
          stderr: `${stderrTail}${stderrTail ? '\n' : ''}`
            + `assertion timed out after ${effectiveTimeoutMs}ms`,
          scenarioCount: 0,
          scenarioEvidence: {
            kind: 'timeout',
            timeout_ms: effectiveTimeoutMs,
          },
        };
      };
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          // Continue to the fail-closed timeout receipt.
        }
        forceKillTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Continue to the fail-closed timeout receipt.
          }
          finish(timeoutResult());
        }, killGraceMs);
      }, effectiveTimeoutMs);

      child.stdout?.on('data', chunk => {
        stdoutBytes = appendBufferTail(
          stdoutBytes,
          chunk,
          captureLimitBytes,
        );
      });
      child.stderr?.on('data', chunk => {
        stderrBytes = appendBufferTail(
          stderrBytes,
          chunk,
          captureLimitBytes,
        );
      });
      child.once('error', error => {
        clearTimeout(timeoutTimer);
        clearTimeout(forceKillTimer);
        if (timedOut) finish(timeoutResult());
        else if (!settled) {
          settled = true;
          rejectExecution(error);
        }
      });
      child.once('close', (exitCode, signal) => {
        if (timedOut) {
          finish(timeoutResult());
          return;
        }
        const stdout = byteSafeTail(stdoutBytes, captureLimitBytes);
        const stderr = byteSafeTail(stderrBytes, captureLimitBytes);
        finish({
          exitCode,
          signal,
          stdout,
          stderr,
          ...scenarioEvidenceFromOutput(
            options.evidenceKind,
            stdout,
            stderr,
          ),
        });
      });
    })
  );
}

export const defaultAssertionExecute = createAssertionExecutor();
