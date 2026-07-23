import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ACTIVE_STATES = new Set(['active', 'quarantined']);
const RELEASE_STATES = new Set(['released', 'quarantined']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export async function withDirLock(lockPath, fn) {
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 5000;

  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for lock: ${lockPath}`);
      }
      await sleep(5);
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmpPath, path);
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
