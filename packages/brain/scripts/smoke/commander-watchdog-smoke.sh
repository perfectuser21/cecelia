#!/usr/bin/env bash
# 本地fixture执行真实巡检与趋势函数；不连接Brain、不发通知、不启动外部进程。
set -euo pipefail
cd "$(dirname "$0")/../.."
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { recordCommanderHeartbeat, runCommanderWatchdog, runWorkflowTrendBark } from './src/commander-watchdog.js';

const now = Date.now();
const oldHeartbeat = new Date(now - 20 * 60e3).toISOString();
async function inspect(sent) {
  const task = { id: 'smoke-run', task_type: 'device_job', title: '旧运行巡检',
    payload: { source: 'cron', tag: 'watchdog-smoke', host: 'retired-host', escort_id: 'old-escort', commander_heartbeat_at: oldHeartbeat } };
  const calls = [], notices = [];
  const pool = { query: async (sql, params) => {
    calls.push({ sql: String(sql), params });
    if (/FROM tasks/.test(sql) && /commander_heartbeat_at/.test(sql)) return { rows: [task] };
    if (/UPDATE tasks/.test(sql)) return { rows: [{ id: task.id }], rowCount: 1 };
    return { rows: [] };
  } };
  const result = await runCommanderWatchdog(pool, {
    execFileFn: () => { throw Error('退役执行器不得被启动'); },
    bark: async (title, body) => { notices.push({ title, body }); return sent; }, gateMs: 0, now,
  });
  assert.equal(result.relaunched, 0);
  assert.equal(result.adopted, 0);
  assert.deepEqual(task.payload, { source: 'cron', tag: 'watchdog-smoke', host: 'retired-host', escort_id: 'old-escort', commander_heartbeat_at: oldHeartbeat });
  const writes = calls.filter(call => /UPDATE tasks/.test(call.sql)).map(call => JSON.parse(call.params[1]));
  if (sent) {
    assert.equal(result.barked, 1);
    assert.match(notices[0].body, /watchdog-smoke/);
    assert.deepEqual(writes, [{ commander_bark_at: new Date(now).toISOString() }]);
    assert.equal(calls.find(call => /INSERT INTO task_events/.test(call.sql)).params[1], 'commander_heartbeat_stale');
  } else {
    assert.equal(result.barked, 0);
    assert.equal(result.failed, 1);
    assert.deepEqual(writes, []);
  }
}
await inspect(true);
await inspect(false);
console.log('PASS 失联巡检只报真实状态、零SSH，通知失败不伪记成功');

let heartbeat;
const heartbeatPool = { query: async (sql, params) => {
  if (/payload->>'tag' = \$1/.test(sql)) return { rows: [{ id: 'smoke-heartbeat', payload: { escort_id: 'old' } }] };
  if (/UPDATE tasks/.test(sql)) { heartbeat = JSON.parse(params[1]); return { rows: [{ id: 'smoke-heartbeat' }], rowCount: 1 }; }
  return { rows: [] };
} };
assert.equal((await recordCommanderHeartbeat(heartbeatPool, { tag: 'heartbeat-smoke' }, { now })).matched, true);
assert.deepEqual(heartbeat, { commander_heartbeat_at: new Date(now).toISOString(), tag: 'heartbeat-smoke' });
console.log('PASS 真实收到的心跳仍能登记');

const day = new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
const ago = days => { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - days); return date.toISOString().slice(0, 10); };
const notices = [];
const pool = { query: async sql => {
  if (/Asia\/Shanghai/.test(sql)) return { rows: [
    { label: 'zero-wf', day: ago(1), runs: '2', leads: '0' }, { label: 'zero-wf', day: ago(2), runs: '1', leads: '0' },
    { label: 'ok-wf', day: ago(1), runs: '1', leads: '5' }, { label: 'ok-wf', day: ago(2), runs: '1', leads: '0' },
  ] };
  if (/FROM phone_registry/.test(sql)) return { rows: [
    { serial: 'S1', nickname: '旧运行设备', recent_runs: '3', last_ok: null },
    { serial: 'S2', nickname: '闲置设备', recent_runs: '0', last_ok: null },
  ] };
  return { rows: [] };
} };
const trend = await runWorkflowTrendBark(pool, { bark: async (_title, body) => { notices.push(body); return true; }, windowOverride: true, now });
assert.deepEqual(trend.zeroLeads, ['zero-wf']);
assert.deepEqual(trend.staleSerials, ['S1']);
assert.equal(notices.length, 2);
console.log('PASS 零线索与设备趋势告警保留');
NODE
