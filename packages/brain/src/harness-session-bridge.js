import { execFile as _execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const POLL_INTERVAL_MS = parseInt(process.env.SESSION_BRIDGE_POLL_MS || '5000', 10);
const WAIT_TIMEOUT_MS = parseInt(process.env.SESSION_BRIDGE_TIMEOUT_MS || String(90 * 60 * 1000), 10);

export async function _pollDockerStatus(containerName) {
  try {
    const stdout = await new Promise((resolve, reject) => {
      _execFile('docker', [
        'inspect', containerName, '--format', '{{.State.Status}}:{{.State.ExitCode}}',
      ], (err, out) => {
        if (err) reject(err);
        else resolve(out);
      });
    });
    const [status, code] = stdout.trim().split(':');
    if (status === 'running') return 'running';
    if (status === 'exited' && code === '0') return 'exited_ok';
    if (status === 'exited') return 'exited_err';
    return 'gone';
  } catch {
    return 'gone';
  }
}

async function waitForContainerExit(containerName) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await _pollDockerStatus(containerName);
    if (status !== 'running') return status;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return 'gone';
}

async function readSessionUuid(worktreePath) {
  try {
    const content = await readFile(path.join(worktreePath, '.cecelia-session-uuid'), 'utf8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

export function makeSessionRecord(spawnResult) {
  return {
    container: spawnResult.container ?? null,
    session_uuid: spawnResult.session_uuid ?? null,
  };
}

export async function reconnectOrSpawn({ nodeKey, state, executor, taskArg, worktreePath, readOutput }) {
  const existing = state[nodeKey];

  if (existing?.container) {
    const status = await _pollDockerStatus(existing.container);

    if (status === 'running') {
      const finalStatus = await waitForContainerExit(existing.container);
      if (finalStatus === 'exited_ok') {
        const output = await readOutput(worktreePath);
        if (output) return { ...output, session_uuid: existing.session_uuid };
      }
    } else if (status === 'exited_ok') {
      const output = await readOutput(worktreePath);
      if (output) return { ...output, session_uuid: existing.session_uuid };
    }
    // exited_err / gone / readOutput failed → fresh start
  }

  const result = await executor(taskArg);
  const sessionUuid = await readSessionUuid(worktreePath);
  return { ...result, session_uuid: sessionUuid };
}
