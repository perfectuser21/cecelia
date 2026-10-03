import { it, expect } from 'vitest';
import { finishEscortAftercare } from '../commander-aftercare.js';

const oldId = '11111111-2222-4333-8444-555555555555';
const newId = '22222222-2222-4333-8444-555555555555';
const start = Date.parse('2026-10-03T00:00:00Z');
function fixture() {
  const context = { finalized: true, taskId: oldId, tag: 'test', host: 'local', escortId: oldId,
    nonce: 'original', requestedAt: new Date(start).toISOString(), generation: 1, operationId: 'op1',
    startup: { startSummary: 'fixed START', businessPid: 123 }, serial: 'SER', profile: 'p', cap: 'dy' };
  const events = []; let time = 0, current = context, actualId = newId, enabled = true, receipt = null, removed = false;
  const ack = c => ({ schema_version: 1, run_tag: c.tag, host: c.host, escort_id: c.escortId,
    nonce: c.nonce, finalize_verified: true, status: 'completed', actor: 'work-commander',
    at: new Date(start + 1).toISOString(), facts: ['terminal'], evidence: ['/ack'] });
  const deps = {
    now: () => time, wallNow: () => start + time, timeoutMs: 100, pollMs: 10,
    sleep: async ms => { time += ms; },
    refreshContext: async c => ({ state: 'committed', operationId: 'op2', generation: 2,
      context: { ...c, escortId: newId } }),
    withGenerationFence: async (_token, action) => action(),
    persistContext: async (next, previous) => { events.push(['persist', next, previous]); current = next; },
    readJobs: async () => removed ? [] : [{ id: actualId, name: 'escort-local-test', agentId: 'work-commander',
      sessionTarget: 'session:escort-local-test', schedule: { kind: 'every', everyMs: 600000 },
      enabled, state: { lastRunStatus: 'ok', lastRunAtMs: start, lastDurationMs: 2 } }],
    readReceipt: async () => receipt,
    requestTick: async id => { events.push(['run', id]); receipt = ack(current); },
    recordAftercare: async r => { events.push(['record', r.escort_id]); },
    quiesceJob: async id => { events.push(['disable', id]); enabled = false; },
    removeJob: async id => { events.push(['remove', id]); removed = true; },
  };
  return { context, deps, events, ack, setAck: r => { receipt = r; }, setActualId: id => { actualId = id; }, time: n => { time = n; } };
}
it('committed新owner独立nonce、归档持久化先于run，原START及requestedAt保留', async () => {
  const f = fixture(); const result = await finishEscortAftercare(f.context, f.deps);
  expect(result.status).toBe('retired');
  const next = f.events[0][1];
  expect(next.escortId).toBe(newId); expect(next.nonce).not.toBe(f.context.nonce);
  expect(next.requestedAt).toBe(f.context.requestedAt); expect(next.startup).toEqual(f.context.startup);
  expect(f.events.slice(1)).toEqual([['run', newId], ['record', newId], ['disable', newId], ['remove', newId]]);
});
for (const state of ['pending', 'unknown']) it(state+' authority拒绝零mutation', async () => {
  const f = fixture(); f.deps.refreshContext = async () => ({ state });
  expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained'); expect(f.events).toEqual([]);
});
it('refresh配置缺少shared fence不能降级旧path', async () => {
  const f = fixture(); delete f.deps.withGenerationFence;
  expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained'); expect(f.events).toEqual([]);
});
for (const key of ['taskId', 'tag', 'host', 'startup', 'requestedAt', 'serial']) it('authority不能更改'+key, async () => {
  const f = fixture(); f.deps.refreshContext = async c => ({ state: 'committed', generation: 2, operationId: 'op2',
    context: { ...c, escortId: newId, [key]: key === 'startup' ? { businessPid: 456 } : 'changed' } });
  expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained'); expect(f.events).toEqual([]);
});
it('fence拒绝代际race不能写Brain/disable/remove', async () => {
  const f = fixture(); let calls = 0;
  f.deps.withGenerationFence = async (_token, action) => { if (++calls > 2) throw Error('generation-stale'); return action(); };
  expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained');
  expect(f.events.map(e => e[0])).toEqual(['persist', 'run']);
});
it('旧nonce回执不能注销新owner，仍只请求一次', async () => {
  const f = fixture(); f.setAck(f.ack(f.context)); f.deps.requestTick = async id => { f.events.push(['run', id]); };
  expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained');
  expect(f.events.map(e => e[0])).toEqual(['persist', 'run']);
});
it('same committed operation恢复复用已持久nonce，不重复换代', async () => {
  const f = fixture(); f.deps.refreshContext = async c => ({ state: 'committed', generation: 1, operationId: 'op1', context: { ...c } });
  f.setActualId(oldId);
  f.setAck(f.ack(f.context)); expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retired');
  expect(f.events[0][0]).toBe('record'); expect(f.events.some(e => e[0] === 'persist')).toBe(false);
});
it('原requestedAt固定20min，worker重启不可取得新deadline', async () => {
  const f = fixture(); f.deps.wallNow = () => start + 20 * 60 * 1000;
  f.setAck(f.ack(f.context)); expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained'); expect(f.events).toEqual([]);
});
it('代际倒退或同UUID另operation无权推进', async () => {
  for (const change of [{ generation: 1, operationId: 'other', escortId: oldId }, { generation: 0, operationId: 'op0', escortId: newId }]) {
    const f = fixture(); f.deps.refreshContext = async c => ({ state: 'committed', ...change, context: { ...c, escortId: change.escortId } });
    expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained'); expect(f.events).toEqual([]);
  }
});
it('fence只返回pending且不执行callback，不能虚报retired', async () => {
  const f = fixture(); f.deps.refreshContext = async c => ({ state: 'committed', generation: 1, operationId: 'op1', context: c });
  f.setActualId(oldId);
  f.deps.withGenerationFence = async () => ({ state: 'pending' }); f.setAck(f.ack(f.context));
  const read = f.deps.readJobs; f.deps.readJobs = async () => (await read()).map(job => ({ ...job, enabled: false }));
  expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained'); expect(f.events).toEqual([]);
});
it('不能在await后超出初次deadline再记录或注销', async () => {
  const f = fixture(); f.deps.requestTick = async id => { f.events.push(['run', id]); f.setAck(f.ack({ ...f.context, escortId: newId, nonce: f.events[0][1].nonce })); f.time(1200000); };
  expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained'); expect(f.events.map(e => e[0])).toEqual(['persist', 'run']);
});
it('remove共享事务内实际list变重名，零rm且不假报注销', async () => {
  const f = fixture(), read = f.deps.readJobs;
  f.deps.withGenerationFence = async (token, action) => {
    if (token.operation === 'removeJob') f.deps.readJobs = async () => { const jobs = await read(); return [...jobs, { ...jobs[0], id: 'foreign' }]; };
    return action();
  };
  expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained');
  expect(f.events.some(e => e[0] === 'remove')).toBe(false);
});
it('authority未传wallNow仍不能跳过持久20min期限', async () => {
  const f = fixture(); delete f.deps.wallNow; f.context.requestedAt = '2000-01-01T00:00:00Z';
  expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained'); expect(f.events).toEqual([]);
});
it('非法负retry计数不能取得额外取消恢复预算', async () => {
  const f = fixture(); f.context.cancellationRetries = -1;
  expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained'); expect(f.events).toEqual([]);
});
it('fence内list await耗尽期限，运输mutate仍未开始则禁止run', async () => {
  const f = fixture(), read = f.deps.readJobs; let calls = 0;
  f.deps.readJobs = async () => { const jobs = await read(); if (++calls === 3) f.time(1200000); return jobs; };
  expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained'); expect(f.events.map(e => e[0])).toEqual(['persist']);
});
it('authority不能接无task身份或损坏的旧generation上下文', async () => {
  for (const invalid of [{ taskId: undefined }, { generation: -1 }, { operationId: '' }]) {
    const f = fixture(); Object.assign(f.context, invalid);
    expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained'); expect(f.events).toEqual([]);
  }
});
for (const patch of [{ agentId: 'foreign' }, { sessionTarget: 'session:foreign' },
  { schedule: { kind: 'every', everyMs: 1 } }, { agentId: undefined }, { sessionTarget: undefined },
  { schedule: { kind: 'every' } }]) it('authority拒绝错/缺实际role身份 '+JSON.stringify(patch), async () => {
  const f = fixture(), read = f.deps.readJobs;
  f.deps.readJobs = async () => (await read()).map(job => ({ ...job, ...patch }));
  expect((await finishEscortAftercare(f.context, f.deps)).status).toBe('retained');
  expect(f.events).toEqual([]);
});
