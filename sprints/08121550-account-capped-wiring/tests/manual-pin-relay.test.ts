/**
 * 人工钉号：payload.CECELIA_CREDENTIALS 透传到 acctOpts —— TDD Red 合同测试（第 5 环）。
 *
 * 契约锚点：contract-draft.md Golden Path Step 4。harness-skill-relay.js 构造 acctOpts 时，
 * 若 task.payload.CECELIA_CREDENTIALS 存在，必须把它带进 acctOpts.env，再交给
 * account-rotation.resolveAccount（该函数以 opts.env.CECELIA_CREDENTIALS 作为 explicit 指定入口）。
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：harness-skill-relay 构造 acctOpts → resolveAccount 的透传。
 * 本测试真调 spawnSkillRelaySession（acctOpts 构造逻辑真实执行），仅把 resolveAccountFn 注入为
 * 捕获间谍（account-rotation 是外层依赖边界，非被改逻辑），断言它收到的 env 携带显式凭据。
 */
import { describe, it, expect } from 'vitest';
import { spawnSkillRelaySession } from '../../../packages/brain/src/harness-skill-relay.js';

// 所有 DB 查询返回空行：findActiveRunBlockingSpawn → 无阻塞 run；其余 UPDATE 结果被忽略。
function fakePool() {
  return { query: async () => ({ rows: [] }) };
}

describe('人工钉号 payload 透传 [BEHAVIOR]', () => {
  it('B-06 payload 指定 CECELIA_CREDENTIALS=creds-account2 → resolveAccount 收到该显式凭据', async () => {
    let capturedEnv = null;
    const resolveAccountFn = async (opts) => {
      capturedEnv = { ...opts.env };
      // 保持既有语义：显式凭据存在时 account-rotation 原样沿用（此处不改写 env）。
    };

    const task = {
      id: 'manual-pin-task-0001',
      task_type: 'harness_controller',
      title: '人工钉号验证',
      location: null,
      payload: {
        CECELIA_CREDENTIALS: 'creds-account2',
        sprint_dir: 'sprints/08121550-account-capped-wiring',
      },
    };

    await spawnSkillRelaySession(task, {
      pool: fakePool(),
      execFn: () => '',
      loadSkill: () => 'SKILL CONTENT',
      ensureWt: async () => '/tmp/wt-manual-pin',
      tokenFn: async () => 'ghtoken',
      spawnFn: async () => ({ ok: true }),
      resolveAccountFn,
      now: () => new Date('2026-08-11T00:00:00.000Z'),
    });

    expect(capturedEnv).not.toBeNull();
    expect(capturedEnv.CECELIA_CREDENTIALS).toBe('creds-account2');
  });
});
