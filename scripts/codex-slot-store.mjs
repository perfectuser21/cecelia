import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { hostname as getHostname } from 'node:os';
import { dirname, join } from 'node:path';

const ACTIVE_STATES = new Set(['active', 'quarantined']);
const RELEASE_STATES = new Set(['released', 'quarantined']);
const LOCK_OWNER_FILE = 'owner.json';
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_LOCKF_PATH = '/usr/bin/lockf';
const LOCK_COMPROMISED_EXIT_CODE = 70;

function requireRoot(root) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('root must be a non-empty path');
  }
}

function leasePath(root, team) {
  return join(root, 'registry', 'leases', `${validateSegment(team, 'team')}.json`);
}

function leaseLockPath(root, team) {
  return join(root, 'locks', `lease-${validateSegment(team, 'team')}.lock`);
}

function sessionPath(root, sessionId) {
  return join(root, 'registry', 'sessions', `${validateSegment(sessionId, 'sessionId')}.json`);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function numberOption(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeLockOptions(options = {}) {
  return {
    timeoutMs: numberOption(
      options.timeoutMs ?? options.lockTimeoutMs,
      DEFAULT_LOCK_TIMEOUT_MS
    ),
    token: typeof options.token === 'string' && options.token.length > 0
      ? options.token
      : randomUUID(),
    pid: numberOption(options.pid, process.pid),
    hostname: typeof options.hostname === 'string' && options.hostname.length > 0
      ? options.hostname
      : getHostname(),
    nowMs: typeof options.nowMs === 'function' ? options.nowMs : Date.now,
    lockfPath: typeof options.lockfPath === 'string' && options.lockfPath.length > 0
      ? options.lockfPath
      : DEFAULT_LOCKF_PATH,
    onLockCompromised: typeof options.onLockCompromised === 'function'
      ? options.onLockCompromised
      : null,
  };
}

function lockOwnerPath(lockPath) {
  return join(lockPath, LOCK_OWNER_FILE);
}

function lockMutationGuardPath(lockPath) {
  return `${lockPath}.mutating`;
}

async function readLockOwner(lockPath) {
  try {
    const owner = JSON.parse(await readFile(lockOwnerPath(lockPath), 'utf8'));
    return owner && typeof owner === 'object' ? owner : null;
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function sameLockOwner(a, b) {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.token === b.token &&
    a.pid === b.pid &&
    a.hostname === b.hostname &&
    a.acquiredAtMs === b.acquiredAtMs
  );
}

async function writeLockOwner(lockPath, owner) {
  try {
    await writeFile(
      lockOwnerPath(lockPath),
      `${JSON.stringify(owner, null, 2)}\n`,
      'utf8'
    );
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }
}

function lockHelperArgs(lockPath) {
  return [
    '-k',
    `${lockPath}.kernel`,
    '/bin/sh',
    '-c',
    'printf READY\\\\n; cat >/dev/null',
  ];
}

function formatLockHelperExit(code, signal, stderr) {
  const status = signal ? `signal ${signal}` : `exit code ${code}`;
  const details = stderr.trim();
  return details ? `${status}: ${details}` : status;
}

function lockHelperExitError(lockPath, code, signal, stderr, phase) {
  return new Error(
    `lock helper ${phase} for ${lockPath}: ${formatLockHelperExit(code, signal, stderr)}`
  );
}

function failStopLockCompromised(error, options) {
  try {
    process.stderr.write(`[codex-slot-store] lock compromised: ${error.message}\n`);
  } catch {
    // Exit is mandatory even if stderr is unavailable.
  }

  try {
    options.onLockCompromised?.(error);
  } catch (observerError) {
    try {
      process.stderr.write(
        `[codex-slot-store] onLockCompromised failed: ${observerError.message}\n`
      );
    } catch {
      // Preserve fail-stop semantics.
    }
  }

  process.exit(LOCK_COMPROMISED_EXIT_CODE);
}

function endLockHelperStdin(child) {
  if (child.stdin.destroyed || child.stdin.writableEnded) {
    return;
  }

  child.stdin.end();
}

async function terminateLockHelper(child, closePromise) {
  endLockHelperStdin(child);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
  }

  const forceKillTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, 1000);

  try {
    await closePromise;
  } finally {
    clearTimeout(forceKillTimer);
  }
}

async function startLockHelper(lockPath, options) {
  const child = spawn(options.lockfPath, lockHelperArgs(lockPath), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdin.on('error', () => {});

  let ready = false;
  let releasing = false;
  let stderr = '';
  let stdout = '';
  let unexpectedExit = null;

  const closePromise = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      const info = { code, signal };
      if (ready && !releasing) {
        failStopUnexpectedExit(
          lockHelperExitError(lockPath, code, signal, stderr, 'exited while running')
        );
      } else if (releasing) {
        unexpectedExit = null;
      }
      resolve(info);
    });
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const helper = {
    child,
    closePromise,
    get unexpectedExit() {
      return unexpectedExit;
    },
    get stderr() {
      return stderr;
    },
    startRelease() {
      releasing = true;
    },
    failStopIfCompromised() {
      if (!ready || releasing) {
        return;
      }

      if (unexpectedExit) {
        failStopLockCompromised(unexpectedExit, options);
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        failStopUnexpectedExit(
          lockHelperExitError(
            lockPath,
            child.exitCode,
            child.signalCode,
            stderr,
            'exited while running'
          )
        );
      }
    },
  };

  function setUnexpectedExit(error) {
    if (!unexpectedExit) {
      unexpectedExit = error;
    }
  }

  function failStopUnexpectedExit(error) {
    setUnexpectedExit(error);
    failStopLockCompromised(error, options);
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;

    function settle(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.stdout.off('data', onStdout);
      if (error) {
        child.off('error', onError);
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    function onError(error) {
      if (ready) {
        if (!releasing) {
          failStopUnexpectedExit(
            new Error(`lock helper failed while running for ${lockPath}: ${error.message}`)
          );
        }
        return;
      }

      settle(new Error(`lock helper failed to start for ${lockPath}: ${error.message}`));
    }

    function onStdout(chunk) {
      stdout += chunk;
      const newlineIndex = stdout.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }

      const line = stdout.slice(0, newlineIndex).replace(/\r$/, '');
      if (line !== 'READY') {
        timedOut = true;
        terminateLockHelper(child, closePromise)
          .catch(() => {})
          .finally(() => {
            settle(new Error(`lock helper emitted unexpected READY line for ${lockPath}: ${line}`));
          });
        return;
      }

      ready = true;
      settle(null);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      terminateLockHelper(child, closePromise)
        .catch(() => {})
        .finally(() => {
          settle(new Error(`timed out waiting for lock: ${lockPath}`));
        });
    }, options.timeoutMs);

    child.once('error', onError);
    child.stdout.on('data', onStdout);
    closePromise.then(({ code, signal }) => {
      if (!ready && !timedOut) {
        settle(lockHelperExitError(lockPath, code, signal, stderr, 'exited before READY'));
      }
    });
  });

  return helper;
}

async function prepareDirLockMetadata(lockPath, owner) {
  await rm(lockPath, { recursive: true, force: true });
  await rm(lockMutationGuardPath(lockPath), { recursive: true, force: true });
  await mkdir(lockPath, { recursive: true });
  await writeLockOwner(lockPath, owner);
}

async function releaseDirLock(lockPath, expectedOwner) {
  const owner = await readLockOwner(lockPath);
  if (sameLockOwner(owner, expectedOwner)) {
    await rm(lockPath, { recursive: true, force: true });
  }
  await rm(lockMutationGuardPath(lockPath), { recursive: true, force: true });
}

async function closeLockHelper(helper, lockPath) {
  if (helper.unexpectedExit) {
    await helper.closePromise;
    throw helper.unexpectedExit;
  }
  if (helper.child.exitCode !== null || helper.child.signalCode !== null) {
    const { code, signal } = await helper.closePromise;
    throw lockHelperExitError(lockPath, code, signal, helper.stderr, 'exited while running');
  }

  helper.startRelease();
  endLockHelperStdin(helper.child);
  const { code, signal } = await helper.closePromise;
  if (code !== 0 || signal) {
    throw lockHelperExitError(lockPath, code, signal, helper.stderr, 'closed unexpectedly');
  }
}

export function validateSegment(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty path segment`);
  }
  if (
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw new Error(`${label} must not contain path traversal`);
  }
  return value;
}

export async function withDirLock(lockPath, fn, options = {}) {
  await mkdir(dirname(lockPath), { recursive: true });
  const lockOptions = normalizeLockOptions(options);
  const helper = await startLockHelper(lockPath, lockOptions);
  const acquiredOwner = {
    token: lockOptions.token,
    pid: lockOptions.pid,
    hostname: lockOptions.hostname,
    acquiredAtMs: lockOptions.nowMs(),
  };

  try {
    await prepareDirLockMetadata(lockPath, acquiredOwner);
  } catch (error) {
    try {
      await closeLockHelper(helper, lockPath);
    } catch {
      // Preserve the metadata write error.
    }
    throw error;
  }

  let callbackResult;
  let callbackError = null;
  let releaseError = null;
  let closeError = null;

  try {
    callbackResult = await fn();
  } catch (error) {
    callbackError = error;
  }

  helper.failStopIfCompromised();

  try {
    await releaseDirLock(lockPath, acquiredOwner);
  } catch (error) {
    releaseError = error;
  }

  try {
    await closeLockHelper(helper, lockPath);
  } catch (error) {
    closeError = error;
  }

  if (callbackError) {
    throw callbackError;
  }
  if (releaseError) {
    throw releaseError;
  }
  if (helper.unexpectedExit) {
    throw helper.unexpectedExit;
  }
  if (closeError) {
    throw closeError;
  }

  return callbackResult;
}

export async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(tmpPath, path);
  } catch (error) {
    try {
      await rm(tmpPath, { force: true });
    } catch {
      // Preserve the original write or rename error.
    }
    throw error;
  }
}

export async function acquireLease({ root, actor, sessionId, host, accounts, now }) {
  requireRoot(root);
  validateSegment(actor, 'actor');
  validateSegment(sessionId, 'sessionId');
  validateSegment(host, 'host');
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('accounts must be a non-empty array');
  }

  for (const account of accounts) {
    const team = validateSegment(account, 'team');
    const acquired = await withDirLock(leaseLockPath(root, team), async () => {
      const path = leasePath(root, team);
      const current = await readJson(path);
      if (current && ACTIVE_STATES.has(current.state)) {
        return null;
      }

      const lease = {
        leaseId: randomUUID(),
        team,
        actor,
        sessionId,
        host,
        state: 'active',
        acquiredAt: now,
        updatedAt: now,
      };
      await atomicWriteJson(path, lease);
      return lease;
    });

    if (acquired) {
      return acquired;
    }
  }

  throw new Error('no available lease');
}

export async function releaseLease({ root, team, leaseId, state = 'released', now }) {
  requireRoot(root);
  validateSegment(team, 'team');
  validateSegment(leaseId, 'leaseId');
  if (!RELEASE_STATES.has(state)) {
    throw new Error('state must be released or quarantined');
  }

  return withDirLock(leaseLockPath(root, team), async () => {
    const path = leasePath(root, team);
    const current = await readJson(path);
    if (!current) {
      throw new Error(`lease not found for team ${team}`);
    }
    if (current.leaseId !== leaseId) {
      throw new Error(`leaseId mismatch for team ${team}`);
    }

    const updated = {
      ...current,
      state,
      updatedAt: now,
      releasedAt: now,
    };
    await atomicWriteJson(path, updated);
    return updated;
  });
}

export async function heartbeatLease({ root, team, leaseId, now }) {
  requireRoot(root);
  validateSegment(team, 'team');
  validateSegment(leaseId, 'leaseId');

  return withDirLock(leaseLockPath(root, team), async () => {
    const path = leasePath(root, team);
    const current = await readJson(path);
    if (!current) {
      throw new Error(`lease not found for team ${team}`);
    }
    if (current.leaseId !== leaseId) {
      throw new Error(`leaseId mismatch for team ${team}`);
    }
    if (current.state !== 'active') {
      throw new Error(`lease for team ${team} is not active`);
    }

    const updated = {
      ...current,
      updatedAt: now,
    };
    await atomicWriteJson(path, updated);
    return updated;
  });
}

export async function putSession({ root, session }) {
  requireRoot(root);
  if (!session || typeof session !== 'object') {
    throw new Error('session must be an object');
  }
  validateSegment(session.sessionId, 'sessionId');
  validateSegment(session.actor, 'actor');

  await atomicWriteJson(sessionPath(root, session.sessionId), session);
  return session;
}

export async function getSession({ root, sessionId }) {
  requireRoot(root);
  return readJson(sessionPath(root, sessionId));
}

export async function listSessions({ root, actor, admin = false }) {
  requireRoot(root);
  if (!admin) {
    validateSegment(actor, 'actor');
  }

  let entries;
  try {
    entries = await readdir(join(root, 'registry', 'sessions'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const sessions = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    const item = await readJson(join(root, 'registry', 'sessions', entry));
    if (item && (admin || item.actor === actor)) {
      sessions.push(item);
    }
  }
  return sessions;
}
