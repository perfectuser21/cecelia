import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {isPhoneDispatchTask} from './task-ownership.js';

const boundary = vi.hoisted(() => ({
  pool: { query: vi.fn() },
  processes: { execSync: vi.fn(), execFileSync: vi.fn(), spawn: vi.fn() },
}));
vi.mock('../db.js', () => ({ default: boundary.pool }));
vi.mock('child_process', () => boundary.processes);
vi.mock('node:child_process', () => boundary.processes);
vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: () => null, getTaskLocation: () => 'us',
}));

let executor;
let task;
beforeAll(async () => {
  executor = await import('../executor.js');
});
beforeEach(() => {
  vi.clearAllMocks();
  executor.suspectProcesses.clear();
  task = {
    id: randomUUID(), title: '有头会话探活回归', status: 'in_progress', task_type: 'dev',
    executor_kind: 'headed-session', claimed_by: 'session:codex-external',
    claimed_at: new Date(Date.now() - 180 * 60_000).toISOString(),
    updated_at: new Date(Date.now() - 180 * 60_000).toISOString(),
    started_at: null, error_message: 'prior dispatch rejected before spawn', payload: {},
  };
  boundary.processes.execSync.mockImplementation((command) => {
    if (command.startsWith('tmux ')) throw new Error('session is on another host');
    return '0\n';
  });
  boundary.processes.execFileSync.mockImplementation(() => { throw new Error('tmux unavailable'); });
  boundary.pool.query.mockImplementation(async (sql) => {
    if (/SELECT id, title, payload, started_at/.test(sql)
      || /SELECT payload, task_type, project_id, title, started_at/.test(sql)) {
      return { rows: task.status === 'in_progress' ? [task] : [], rowCount: 1 };
    }
    if (/UPDATE tasks SET status = 'queued'/.test(sql)) task.status = 'queued';
    return { rows: [], rowCount: 1 };
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function probeTwice() {
  return [...await executor.probeTaskLiveness(), ...await executor.probeTaskLiveness()];
}

describe('手机controller专属回执所有权不走旧device超时回队',()=>{
 it.each([false,true])('认领180min无spawn时连续probe不写task、不suspect、不传播guard错误（DBguard=%s）',async(enforceGuard)=>{
  task.task_type='device_job';task.executor_kind='phone-ssh-controller';task.claimed_by='phone-dispatch:test';task.error_message=null;task.payload={phone_dispatch_id:'test'};
  expect(isPhoneDispatchTask(task)).toBe(true);
  if(enforceGuard){const query=boundary.pool.query.getMockImplementation();boundary.pool.query.mockImplementation(async(sql,...args)=>{
   if(/UPDATE tasks/.test(sql))throw Error('phone_task_managed');return query(sql,...args);
  });}
  executor.suspectProcesses.set(task.id,{firstSeen:new Date().toISOString(),tickCount:1});
  expect(await probeTwice()).toEqual([]);expect(task.status).toBe('in_progress');expect(executor.suspectProcesses.has(task.id)).toBe(false);
  expect(boundary.pool.query.mock.calls.some(([sql])=>/UPDATE tasks/.test(sql))).toBe(false);
 });
 it('旧device_job超过45min仍走双确认回队，payload伪造phone不能抢所有权',async()=>{
  task.task_type='device_job';task.executor_kind=null;task.claimed_by='legacy-device-worker';task.error_message=null;
  task.payload={phone_dispatch_id:'fake',executor_kind:'phone-ssh-controller'};
  expect(isPhoneDispatchTask(task)).toBe(false);
  expect(await executor.probeTaskLiveness()).toEqual([]);expect(executor.suspectProcesses.has(task.id)).toBe(true);
  expect(await executor.probeTaskLiveness()).toEqual([expect.objectContaining({action:'liveness_safe_requeue'})]);expect(task.status).toBe('queued');
 });
 it('错误task_type不能借phone executor_kind豁免本机探活',async()=>{
  task.executor_kind='phone-ssh-controller';task.claimed_by='phone-dispatch:fake';
  expect(isPhoneDispatchTask(task)).toBe(false);
  expect(await probeTwice()).toEqual([expect.objectContaining({action:'liveness_auto_requeue'})]);expect(task.status).toBe('queued');
 });
});
