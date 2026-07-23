import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  assert.deepEqual(await readdir(join(root, 'locks')), []);

  assert.equal(
    await withDirLock(lockPath, async () => 'second acquisition'),
    'second acquisition'
  );
  assert.deepEqual(await readdir(join(root, 'locks')), []);
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
