import { describe, it, expect } from 'vitest';
import * as dispatcher from '../factory-dispatcher.js';

const taskId = 'abcdef12-3456-7890-abcd-ef1234567890';
const executionId = 'c01ca63a-df7f-49e9-b062-35e404d601f0';
const verification = () => ({ id: taskId, status: 'queued', task_type: 'skill_factory_run', payload: {
  factory_dispatch: true, factory_verify_of: executionId, factory_verify_run_id: 'wfd-c01ca63a-1791792845110', skill: 'run-verify',
  factory: { stage: 'verify', skill: 'run-verify', agent: 'skill-factory', device: { profile: 'xiaolongxia', serial: 'SERIAL' } },
} });
function world(task) {
  const claims = [], calls = [];
  return { claims, calls, deps: { now: () => new Date('2026-10-12T08:00:00Z'), log: () => {},
    brain: { listQueued: async () => [task], getTask: async () => { calls.push('read'); return task; },
      claim: async id => { claims.push(id); calls.push('claim'); return { status: 409 }; } },
  } };
}
describe('仅核验消费：旧业务执行持续关闭', () => {
  it('默认 all 保持旧执行消费，verify-only 必须显式开启且配置错拼拒绝', () => {
    expect(dispatcher.readDispatchMode()).toBe('all');
    expect(dispatcher.readDispatchMode('verify-only')).toBe('verify-only');
    for (const mode of ['verify', '', 'true', null]) expect(() => dispatcher.readDispatchMode(mode)).toThrow('dispatch mode');
  });
  it('核验消息要求独立读证据，禁止读执行会话及对外动作', () => {
    const text = dispatcher.buildAgentMessage({ runId: 'sfv-test', taskId, contract: verification().payload.factory });
    expect(text).toContain('禁止读取执行会话');
    expect(text).toContain('禁止对外动作');
  });
  it('旧执行默认仍能领，verify-only 下 poll 与直接派发均不 claim', async () => {
    const old = verification(); old.payload.factory.stage = '3'; old.payload.skill = old.payload.factory.skill = 'android-douyin-publish';
    const normal = world(old); await dispatcher.pollOnce(normal.deps); expect(normal.claims).toEqual([taskId]);
    for (const call of [dispatcher.pollOnce, (deps, opts) => dispatcher.dispatchTask(old, deps, opts)]) {
      const w = world(old); await call(w.deps, { dispatchMode: 'verify-only' }); expect(w.claims).toEqual([]);
    }
  });
  it.each(['type', 'dispatch', 'stage', 'skill', 'factorySkill', 'source', 'self', 'run', 'arrayRun'])('不完整核验契约 %s 不领', async key => {
    const t = verification();
    if (key === 'type') t.task_type = 'research';
    if (key === 'dispatch') t.payload.factory_dispatch = false;
    if (key === 'stage') t.payload.factory.stage = 3;
    if (key === 'skill') t.payload.skill = 'android-douyin-publish';
    if (key === 'factorySkill') t.payload.factory.skill = 'android-douyin-publish';
    if (key === 'source') t.payload.factory_verify_of = 'bad';
    if (key === 'self') t.payload.factory_verify_of = taskId;
    if (key === 'run') t.payload.factory_verify_run_id = '';
    if (key === 'arrayRun') t.payload.factory_verify_run_id = ['run'];
    const w = world(t); await dispatcher.pollOnce(w.deps, { dispatchMode: 'verify-only' }); expect(w.claims).toEqual([]);
  });
  it('合格核验在 claim 前真实读回契约，遇 409 不动锁', async () => {
    const w = world(verification()); const result = await dispatcher.pollOnce(w.deps, { dispatchMode: 'verify-only' });
    expect(result.outcome).toBe('claim_conflict'); expect(w.claims).toEqual([taskId]); expect(w.calls).toEqual(['read', 'claim']);
  });
  it.each(['changed', 'terminal', 'foreign'])('队列快照过期 %s 在直接入口也不 claim', async key => {
    const stale = verification(), current = verification();
    if (key === 'changed') current.payload.factory.stage = '3';
    if (key === 'terminal') current.status = 'completed';
    if (key === 'foreign') current.id = executionId;
    const w = world(current); await dispatcher.dispatchTask(stale, w.deps, { dispatchMode: 'verify-only' }); expect(w.claims).toEqual([]);
  });
});
