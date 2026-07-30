import {
  appendBufferTail,
  byteSafeTail,
  scenarioEvidenceFromOutput,
} from './gp-assertion-output.js';

const PROCESS_CAPTURE_LIMIT_BYTES = 4096 * 4;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_KILL_GRACE_MS = 5_000;
const ENV_ALLOWLIST = ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'TZ'];
const SIGNAL_EXIT_CODES = { SIGTERM: 143, SIGKILL: 137 };
const killProcessGroup = (pid, signal) => process.kill(-pid, signal);

export function createAssertionExecutor({
  spawnFn,
  environment = {},
  killProcessGroupFn = killProcessGroup,
  captureLimitBytes = PROCESS_CAPTURE_LIMIT_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
} = {}) {
  if (typeof spawnFn !== 'function') {
    throw Object.assign(new Error('trusted process adapter is required'), {
      code: 'TRUSTED_PROCESS_ADAPTER_REQUIRED',
    });
  }
  const childEnv = Object.fromEntries(ENV_ALLOWLIST.flatMap(key => (
    typeof environment?.[key] === 'string' ? [[key, environment[key]]] : []
  )));
  return (executable, argv, options) => (
    new Promise((resolveExecution, rejectExecution) => {
      const child = spawnFn(executable, argv, {
        cwd: options.cwd,
        detached: true,
        env: childEnv,
        shell: false,
      });
      const effectiveTimeoutMs = options.timeoutMs ?? timeoutMs;
      let stdoutBytes = Buffer.alloc(0);
      let stderrBytes = Buffer.alloc(0);
      let settled = false;
      let timedOut = false;
      let forceKillTimer;
      let closeSignal = null;
      const termination = {
        target: 'process_group',
        term_sent: false,
        kill_sent: false,
        cleanup_confirmed: false,
      };

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
          signal: closeSignal,
          timedOut: true,
          stdout,
          stderr: `${stderrTail}${stderrTail ? '\n' : ''}`
            + `assertion timed out after ${effectiveTimeoutMs}ms`,
          scenarioCount: 0,
          scenarioEvidence: {
            kind: 'timeout',
            timeout_ms: effectiveTimeoutMs,
            termination,
          },
        };
      };
      const terminateGroup = (signal, phase) => {
        try {
          killProcessGroupFn(child.pid, signal);
          termination[`${phase}_sent`] = true;
        } catch (error) {
          if (error?.code === 'ESRCH') termination.cleanup_confirmed = true;
          else termination[`${phase}_error`] = error?.code ?? error?.message;
        }
      };
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminateGroup('SIGTERM', 'term');
        forceKillTimer = setTimeout(() => {
          terminateGroup('SIGKILL', 'kill');
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
        if (timedOut) termination.child_error = error?.code ?? error?.message;
        else if (!settled) {
          settled = true;
          rejectExecution(error);
        }
      });
      child.once('close', (exitCode, signal) => {
        if (timedOut) {
          closeSignal = signal;
          return;
        }
        const stdout = byteSafeTail(stdoutBytes, captureLimitBytes);
        const stderr = byteSafeTail(stderrBytes, captureLimitBytes);
        if (exitCode === null) {
          finish({
            exitCode: SIGNAL_EXIT_CODES[signal] ?? 1,
            signal,
            stdout,
            stderr,
            scenarioCount: 0,
            scenarioEvidence: { kind: 'signal', signal: signal ?? 'UNKNOWN' },
          });
          return;
        }
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
