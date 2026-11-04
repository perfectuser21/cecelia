import {beforeEach, describe, it, expect, vi} from 'vitest';
const forbidden = vi.hoisted(() => vi.fn(() => {throw Error('external action forbidden');}));
vi.mock('../db.js', () => ({default:{query:forbidden}}));
vi.mock('node:child_process', () => ({execFile:forbidden,execSync:forbidden,execFileSync:forbidden,spawn:forbidden,exec:forbidden}));
vi.mock('child_process', () => ({execFile:forbidden,execSync:forbidden,execFileSync:forbidden,spawn:forbidden,exec:forbidden}));
import {resumeStalledRelayRuns} from '../harness-relay-watchdog.js';

beforeEach(() => {vi.clearAllMocks();vi.stubGlobal('fetch',forbidden);});
function world(status, payload = {}) {
  const task = {id:'11111111-1111-4111-8111-111111111111',status,payload:{orchestrator:'skill-relay',...payload}};
  const run = {id:'22222222-2222-4222-8222-222222222222',current_task_id:task.id,
    initiative_id:'33333333-3333-4333-8333-333333333333',phase:'running',attempts:0,
    orchestrator_version:'v2',orchestrator_host:'skill-relay-canary-drill',
    started_at:new Date().toISOString(),deadline_at:new Date(Date.now()+60000).toISOString(),
    pr_url:'https://github.com/owned/fixture/pull/1'};
  const query = vi.fn(async (sql, params) => {
    if (sql.trim().startsWith('WITH candidate_runs')) return {rows:[run]};
    if (sql.startsWith('SELECT id, status, title, description, payload, pr_url FROM tasks')) {
      expect(params).toEqual([task.id]);
      return {rows:[task]};
    }
    throw Error('unexpected database operation');
  });
  const spawnFn = vi.fn(async () => ({ok:true}));
  const execFn = vi.fn(command => {
    if (command.startsWith('docker ps ')) return '';
    if (command.startsWith('gh pr view ')) return JSON.stringify({state:'CLOSED'});
    throw Error(`unexpected command ${command}`);
  });
  return {task,query,spawnFn,execFn,deps:{dbPool:{query},spawnFn,execFn}};
}

describe('watchdog当前真实run身份下的任务状态分支', () => {
  it('queued有同一有效run且确实读到task后拒绝重启', async () => {
    const w = world('queued');
    const result = await resumeStalledRelayRuns(w.deps);
    expect(w.query).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({scanned:1,resumed:0});
    expect(w.spawnFn).not.toHaveBeenCalled();
    expect(w.execFn).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  });
  it('仅状态改为in_progress会实际到达探活和注入spawn分支', async () => {
    const w = world('in_progress');
    const result = await resumeStalledRelayRuns(w.deps);
    expect(w.query).toHaveBeenCalledTimes(2);
    expect(w.execFn).toHaveBeenCalledTimes(2);
    expect(w.spawnFn).toHaveBeenCalledWith(w.task,{pool:w.deps.dbPool});
    expect(result).toMatchObject({scanned:1,resumed:1});
    expect(forbidden).not.toHaveBeenCalled();
  });
  it('退役kernel-v1运行时即使in_progress也不恢复', async () => {
    const w = world('in_progress',{harness_runtime:'kernel-v1'});
    expect(await resumeStalledRelayRuns(w.deps)).toMatchObject({scanned:1,resumed:0});
    expect(w.query).toHaveBeenCalledTimes(2);
    expect(w.spawnFn).not.toHaveBeenCalled();
    expect(w.execFn).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  });
});
