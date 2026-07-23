import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  validateSegment,
  acquireLease,
  atomicWriteJson,
  releaseLease,
  heartbeatLease,
  putSession,
  getSession,
  listSessions,
  withDirLock,
} from './codex-slot-store.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'codex-slot-store-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function session(sessionId, actor, extra = {}) {
  return {
    sessionId,
    actor,
    host: 'xian-m4',
    project: 'infra',
    name: sessionId,
    state: 'running',
    updatedAt: '2026-07-23T00:00:00Z',
    ...extra,
  };
}

async function writeLockOwner(lockPath, owner) {
  await mkdir(lockPath, { recursive: true });
  await writeFile(
    join(lockPath, 'owner.json'),
    `${JSON.stringify(owner, null, 2)}\n`,
    'utf8'
  );
}

async function readLockOwner(lockPath) {
  return JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8'));
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function writeNeverReadyLockf(root) {
  const lockfPath = join(root, 'never-ready-lockf.mjs');
  await writeFile(
    lockfPath,
    `#!/usr/bin/env node
process.stdin.resume();
`,
    'utf8'
  );
  await chmod(lockfPath, 0o755);
  return lockfPath;
}

async function writeReadyThenExitLockf(root) {
  const lockfPath = join(root, 'ready-then-exit-lockf.mjs');
  await writeFile(
    lockfPath,
    `#!/usr/bin/env node
import { stat } from 'node:fs/promises';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const markerPath = process.env.CODEX_SLOT_LOCKF_EXIT_AFTER_FILE;
process.stdout.write('READY\\n');

const deadline = Date.now() + 2000;
while (markerPath && Date.now() < deadline) {
  try {
    await stat(markerPath);
    break;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
    await sleep(10);
  }
}

process.stderr.write('helper self-terminated after READY\\n');
process.exit(66);
`,
    'utf8'
  );
  await chmod(lockfPath, 0o755);
  return lockfPath;
}

function waitForChild(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`child process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
}

test('rejects empty and traversal path segments', () => {
  assert.equal(validateSegment('alex-infra-main', 'sessionId'), 'alex-infra-main');
  assert.throws(() => validateSegment('', 'sessionId'), /sessionId/);
  assert.throws(() => validateSegment('../team1', 'team'), /team/);
  assert.throws(() => validateSegment('team/one', 'team'), /team/);
});

test('同一 team 的并发 acquire 只有一个成功', async (t) => {
  const root = await tempRoot(t);
  const req = {
    root,
    actor: 'alex',
    sessionId: 'alex-infra-main',
    host: 'xian-m4',
    accounts: ['team1'],
    now: '2026-07-23T00:00:00Z',
  };

  const [a, b] = await Promise.allSettled([
    acquireLease(req),
    acquireLease({ ...req, sessionId: 'alex-infra-two' }),
  ]);

  const fulfilled = [a, b].filter((x) => x.status === 'fulfilled');
  assert.equal(fulfilled.length, 1);
  assert.equal(fulfilled[0].value.team, 'team1');
  assert.equal(fulfilled[0].value.state, 'active');
});

test('acquireLease honors caller account order when multiple accounts are free', async (t) => {
  const root = await tempRoot(t);

  const lease = await acquireLease({
    root,
    actor: 'alex',
    sessionId: 'alex-infra-main',
    host: 'xian-m4',
    accounts: ['team2', 'team1'],
    now: '2026-07-23T00:00:00Z',
  });

  assert.equal(lease.team, 'team2');
});

test('acquireLease concurrently replays one exact actor request session lease', async (t) => {
  const root = await tempRoot(t);
  const request = {
    root,
    actor: 'alex',
    requestId: 'request-main',
    sessionId: 'alex-infra-main',
    host: 'xian-m4',
    accounts: ['team1', 'team2'],
    now: '2026-07-23T00:00:00Z',
  };

  const [first, replay] = await Promise.all([
    acquireLease(request),
    acquireLease(request),
  ]);

  assert.equal(replay.leaseId, first.leaseId);
  assert.equal(replay.team, first.team);
  assert.equal(replay.requestId, request.requestId);
});

test('acquireLease never returns an active lease from a different request tuple', async (t) => {
  const root = await tempRoot(t);
  const first = await acquireLease({
    root,
    actor: 'alex',
    requestId: 'request-one',
    sessionId: 'alex-infra-main',
    host: 'xian-m4',
    accounts: ['team1', 'team2'],
    now: '2026-07-23T00:00:00Z',
  });
  const other = await acquireLease({
    root,
    actor: 'alex',
    requestId: 'request-two',
    sessionId: 'alex-infra-main',
    host: 'xian-m4',
    accounts: ['team1', 'team2'],
    now: '2026-07-23T00:01:00Z',
  });

  assert.notEqual(other.leaseId, first.leaseId);
  assert.notEqual(other.team, first.team);
  assert.equal(other.requestId, 'request-two');
});

test('acquireLease finds an exact replay outside the current allocation candidates', async (t) => {
  const root = await tempRoot(t);
  const request = {
    root,
    actor: 'alex',
    requestId: 'request-main',
    sessionId: 'alex-infra-main',
    host: 'xian-m4',
    now: '2026-07-23T00:00:00Z',
  };
  const first = await acquireLease({
    ...request,
    accounts: ['team1'],
    lookupAccounts: ['team1', 'team2'],
  });
  const replay = await acquireLease({
    ...request,
    accounts: ['team2'],
    lookupAccounts: ['team1', 'team2'],
    now: '2026-07-23T00:01:00Z',
  });

  assert.equal(replay.leaseId, first.leaseId);
  assert.equal(replay.team, 'team1');
});

test('atomicWriteJson leaves one complete target and no temp residue under concurrent writes', async (t) => {
  const root = await tempRoot(t);
  const target = join(root, 'registry/leases/atomic.json');
  const writes = Array.from({ length: 16 }, (_, index) => ({
    writer: `writer-${index}`,
    payload: `${index}`.repeat(4096),
    updatedAt: `2026-07-23T00:${String(index).padStart(2, '0')}:00Z`,
  }));

  await Promise.all(writes.map((value) => atomicWriteJson(target, value)));

  const stored = JSON.parse(await readFile(target, 'utf8'));
  assert.deepEqual(stored, writes.find((value) => value.writer === stored.writer));
  assert.deepEqual(
    (await readdir(join(root, 'registry/leases'))).filter((entry) => entry.endsWith('.tmp')),
    []
  );
});

test('withDirLock removes lock directory after callback throw and can lock again', async (t) => {
  const root = await tempRoot(t);
  const lockPath = join(root, 'locks/failing.lock');

  await assert.rejects(
    withDirLock(lockPath, async () => {
      throw new Error('callback failed');
    }),
    /callback failed/
  );
  assert.equal(await pathExists(lockPath), false);

  assert.equal(
    await withDirLock(lockPath, async () => 'second acquisition'),
    'second acquisition'
  );
  assert.equal(await pathExists(lockPath), false);
});

test('withDirLock serializes concurrent long callbacks with a kernel lock', async (t) => {
  const root = await tempRoot(t);
  const lockPath = join(root, 'locks/concurrent.lock');
  let activeCount = 0;
  let maxActiveCount = 0;
  const entries = [];

  async function runWithLock(token, pid) {
    return withDirLock(
      lockPath,
      async () => {
        activeCount += 1;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        entries.push(token);

        const owner = await readLockOwner(lockPath);
        assert.equal(owner.token, token);
        assert.equal(owner.pid, pid);

        await sleep(80);

        activeCount -= 1;
        return token;
      },
      {
        token,
        pid,
        hostname: hostname(),
        timeoutMs: 1000,
      }
    );
  }

  const results = await Promise.all([
    runWithLock('owner-a', 11_111),
    runWithLock('owner-b', 22_222),
  ]);

  assert.deepEqual(results.sort(), ['owner-a', 'owner-b']);
  assert.deepEqual(entries.sort(), ['owner-a', 'owner-b']);
  assert.equal(maxActiveCount, 1);
  assert.equal(await pathExists(lockPath), false);
  assert.equal(await pathExists(`${lockPath}.kernel`), true);
});

test('withDirLock timeout kills helper and does not run callback before READY', async (t) => {
  const root = await tempRoot(t);
  const lockPath = join(root, 'locks/timeout.lock');
  const lockfPath = await writeNeverReadyLockf(root);
  let called = false;

  await assert.rejects(
    withDirLock(
      lockPath,
      async () => {
        called = true;
      },
      {
        lockfPath,
        timeoutMs: 25,
      }
    ),
    /timed out waiting for lock/
  );

  assert.equal(called, false);
});

test('withDirLock fail-stops when helper exits after READY while callback is running', async (t) => {
  const root = await tempRoot(t);
  const lockPath = join(root, 'locks/compromised.lock');
  const lockfPath = await writeReadyThenExitLockf(root);
  const enteredPath = join(root, 'entered');
  const finishedPath = join(root, 'finished');
  const childPath = join(root, 'compromised-child.mjs');
  const storeUrl = pathToFileURL(join(process.cwd(), 'scripts/codex-slot-store.mjs')).href;

  await writeFile(
    childPath,
    `import { writeFile } from 'node:fs/promises';
import { withDirLock } from ${JSON.stringify(storeUrl)};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const [, , lockPath, lockfPath, enteredPath, finishedPath] = process.argv;

await withDirLock(
  lockPath,
  async () => {
    await writeFile(enteredPath, 'entered\\n', 'utf8');
    await sleep(1000);
    await writeFile(finishedPath, 'finished\\n', 'utf8');
  },
  {
    lockfPath,
    timeoutMs: 1000,
  }
);
`,
    'utf8'
  );

  const child = spawn(
    process.execPath,
    [childPath, lockPath, lockfPath, enteredPath, finishedPath],
    {
      env: {
        ...process.env,
        CODEX_SLOT_LOCKF_EXIT_AFTER_FILE: enteredPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const result = await waitForChild(child);

  assert.equal(result.exitCode, 70, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(await pathExists(enteredPath), true);
  assert.equal(await pathExists(finishedPath), false);

  assert.equal(
    await withDirLock(
      lockPath,
      async () => 'reacquired',
      {
        timeoutMs: 1000,
      }
    ),
    'reacquired'
  );
});

test('withDirLock ignores and removes legacy .mutating directories', async (t) => {
  const root = await tempRoot(t);
  const lockPath = join(root, 'locks/legacy.lock');
  await mkdir(`${lockPath}.mutating`, { recursive: true });
  await writeFile(join(`${lockPath}.mutating`, 'owner.json'), '{"legacy":true}\n', 'utf8');

  assert.equal(
    await withDirLock(
      lockPath,
      async () => {
        const owner = await readLockOwner(lockPath);
        assert.equal(owner.token, 'fresh-owner');
        return 'acquired';
      },
      {
        token: 'fresh-owner',
        timeoutMs: 500,
      }
    ),
    'acquired'
  );

  assert.equal(await pathExists(lockPath), false);
  assert.equal(await pathExists(`${lockPath}.mutating`), false);
});

test('withDirLock finally does not delete a replacement with the same token but different owner', async (t) => {
  const root = await tempRoot(t);
  const lockPath = join(root, 'locks/replaced-same-token.lock');
  const replacementOwner = {
    token: 'shared-token',
    pid: 22_222,
    hostname: hostname(),
    acquiredAtMs: 2_000,
  };

  assert.equal(
    await withDirLock(
      lockPath,
      async () => {
        const originalOwner = await readLockOwner(lockPath);
        assert.equal(originalOwner.token, 'shared-token');
        assert.equal(originalOwner.pid, 11_111);

        await rm(lockPath, { recursive: true, force: true });
        await writeLockOwner(lockPath, replacementOwner);
        return 'callback-result';
      },
      {
        token: 'shared-token',
        pid: 11_111,
        hostname: hostname(),
        nowMs: () => 1_000,
      }
    ),
    'callback-result'
  );

  assert.deepEqual(await readLockOwner(lockPath), replacementOwner);
  assert.equal(await pathExists(`${lockPath}.kernel`), true);
});

test('atomicWriteJson removes its temp file when rename fails', async (t) => {
  const root = await tempRoot(t);
  const target = join(root, 'target.json');
  await mkdir(target);

  await assert.rejects(atomicWriteJson(target, { value: 'cannot replace directory' }));

  assert.deepEqual(
    (await readdir(root)).filter((entry) => entry.endsWith('.tmp')),
    []
  );
});

test('release 拒绝 lease ID 不匹配且保留原租约', async (t) => {
  const root = await tempRoot(t);
  const lease = await acquireLease({
    root,
    actor: 'alex',
    sessionId: 'alex-infra-main',
    host: 'xian-m4',
    accounts: ['team1'],
    now: '2026-07-23T00:00:00Z',
  });

  await assert.rejects(
    releaseLease({
      root,
      team: 'team1',
      leaseId: 'wrong-lease-id',
      now: '2026-07-23T00:01:00Z',
    }),
    /leaseId/
  );

  const stored = JSON.parse(await readFile(join(root, 'registry/leases/team1.json'), 'utf8'));
  assert.equal(stored.leaseId, lease.leaseId);
  assert.equal(stored.state, 'active');
});

test('release 后同一 team 可以重新 acquire', async (t) => {
  const root = await tempRoot(t);
  const lease = await acquireLease({
    root,
    actor: 'alex',
    sessionId: 'alex-infra-main',
    host: 'xian-m4',
    accounts: ['team1'],
    now: '2026-07-23T00:00:00Z',
  });

  const released = await releaseLease({
    root,
    team: 'team1',
    leaseId: lease.leaseId,
    now: '2026-07-23T00:01:00Z',
  });
  assert.equal(released.state, 'released');

  const next = await acquireLease({
    root,
    actor: 'alex',
    sessionId: 'alex-infra-two',
    host: 'xian-m4',
    accounts: ['team1'],
    now: '2026-07-23T00:02:00Z',
  });
  assert.equal(next.team, 'team1');
  assert.notEqual(next.leaseId, lease.leaseId);
});

test('release is idempotent only for the same terminal state', async (t) => {
  const root = await tempRoot(t);
  const lease = await acquireLease({
    root,
    actor: 'alex',
    sessionId: 'alex-infra-main',
    host: 'xian-m4',
    accounts: ['team1'],
    now: '2026-07-23T00:00:00Z',
  });

  const first = await releaseLease({
    root,
    team: 'team1',
    leaseId: lease.leaseId,
    state: 'released',
    now: '2026-07-23T00:01:00Z',
  });
  const replay = await releaseLease({
    root,
    team: 'team1',
    leaseId: lease.leaseId,
    state: 'released',
    now: '2026-07-23T00:02:00Z',
  });

  assert.deepEqual(replay, first);
  assert.equal(replay.releasedAt, '2026-07-23T00:01:00Z');
});

test('release refuses to turn a quarantined lease into released', async (t) => {
  const root = await tempRoot(t);
  const lease = await acquireLease({
    root,
    actor: 'alex',
    sessionId: 'alex-infra-main',
    host: 'xian-m4',
    accounts: ['team1'],
    now: '2026-07-23T00:00:00Z',
  });
  await releaseLease({
    root,
    team: 'team1',
    leaseId: lease.leaseId,
    state: 'quarantined',
    now: '2026-07-23T00:01:00Z',
  });

  await assert.rejects(
    releaseLease({
      root,
      team: 'team1',
      leaseId: lease.leaseId,
      state: 'released',
      now: '2026-07-23T00:02:00Z',
    }),
    /terminal state conflict: quarantined/
  );
  const stored = JSON.parse(await readFile(join(root, 'registry/leases/team1.json'), 'utf8'));
  assert.equal(stored.state, 'quarantined');
});

test('heartbeat 更新时间但拒绝 lease ID 不匹配', async (t) => {
  const root = await tempRoot(t);
  const lease = await acquireLease({
    root,
    actor: 'alex',
    sessionId: 'alex-infra-main',
    host: 'xian-m4',
    accounts: ['team1'],
    now: '2026-07-23T00:00:00Z',
  });

  const updated = await heartbeatLease({
    root,
    team: 'team1',
    leaseId: lease.leaseId,
    now: '2026-07-23T00:03:00Z',
  });

  assert.equal(updated.updatedAt, '2026-07-23T00:03:00Z');
  assert.equal(updated.acquiredAt, '2026-07-23T00:00:00Z');
  await assert.rejects(
    heartbeatLease({
      root,
      team: 'team1',
      leaseId: 'wrong-lease-id',
      now: '2026-07-23T00:04:00Z',
    }),
    /leaseId/
  );
});

test('quarantined lease 不可再次 acquire', async (t) => {
  const root = await tempRoot(t);
  const lease = await acquireLease({
    root,
    actor: 'alex',
    sessionId: 'alex-infra-main',
    host: 'xian-m4',
    accounts: ['team1'],
    now: '2026-07-23T00:00:00Z',
  });
  const quarantined = await releaseLease({
    root,
    team: 'team1',
    leaseId: lease.leaseId,
    state: 'quarantined',
    now: '2026-07-23T00:01:00Z',
  });

  assert.equal(quarantined.state, 'quarantined');
  await assert.rejects(
    acquireLease({
      root,
      actor: 'alex',
      sessionId: 'alex-infra-two',
      host: 'xian-m4',
      accounts: ['team1'],
      now: '2026-07-23T00:02:00Z',
    }),
    /no available lease/
  );
});

test('普通 actor 只看到自己的 session', async (t) => {
  const root = await tempRoot(t);
  await putSession({ root, session: session('alex-infra-main', 'alex') });
  await putSession({ root, session: session('morgan-infra-main', 'morgan') });

  assert.deepEqual((await listSessions({ root, actor: 'alex' })).map((x) => x.actor), ['alex']);
  assert.deepEqual(
    (await listSessions({ root, actor: 'alex', admin: true })).map((x) => x.actor).sort(),
    ['alex', 'morgan']
  );
});

test('putSession/getSession 往返并校验 sessionId segment', async (t) => {
  const root = await tempRoot(t);
  const value = session('alex-infra-main', 'alex', { state: 'prepared' });

  await putSession({ root, session: value });

  assert.deepEqual(await getSession({ root, sessionId: 'alex-infra-main' }), value);
  assert.equal(await getSession({ root, sessionId: 'missing-session' }), null);
  await assert.rejects(
    putSession({ root, session: session('../bad', 'alex') }),
    /sessionId/
  );
});
