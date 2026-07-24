/**
 * [RED] harness-skill-relay xian 派发路径测试
 * BEHAVIOR-2: xian 分支白名单门禁
 * BEHAVIOR-3: xian 分支调 bridge 不调 docker
 * BEHAVIOR-4: xian spawn 落 initiative_runs orchestrator_host=skill-relay-xian
 * BEHAVIOR-6: bridge spawn 失败时 loud 失败 + task 回滚
 * TASK_ID: 7750cd32-d73b-4a53-91cf-8fd171bf358b
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSkillRelaySession } from '../harness-skill-relay.js';

// mock DB pool
function makeMockPool(queryFn) {
  return {
    query: queryFn || vi.fn().mockResolvedValue({ rows: [] }),
  };
}

describe('spawnSkillRelaySession xian 派发路径', () => {
  let mockPool;
  let mockBridgeFn;
  let mockDockerFn;
  let mockExecFn;
  let acquireSlotFn;

  beforeEach(() => {
    mockPool = makeMockPool(vi.fn().mockResolvedValue({ rows: [] }));
    mockBridgeFn = vi.fn().mockResolvedValue({ status: 'accepted', job_id: 'abc123' });
    mockDockerFn = vi.fn().mockResolvedValue({ ok: true });
    // execFn: docker ps 去重守卫 → 返回空（无已有容器）
    mockExecFn = vi.fn().mockReturnValue('');
    acquireSlotFn = vi.fn().mockResolvedValue({
      public: {
        agent_id: 'xian-m1',
        lease_id: '11111111-1111-4111-8111-111111111111',
        session_id: '22222222-2222-4222-8222-222222222222',
      },
      receipt: 'broker-receipt-fixture',
    });
  });

  it('BEHAVIOR-2: task.location=xian 但 allow_xian 缺失 → loud 失败，不调 bridgeFn', async () => {
    const task = {
      id: 'test-456',
      task_type: 'harness_initiative',
      location: 'xian',
      payload: {},  // 无 allow_xian
    };
    const result = await spawnSkillRelaySession(task, {
      pool: mockPool,
      bridgeFn: mockBridgeFn,
      spawnFn: mockDockerFn,
      execFn: mockExecFn,
      loadSkill: () => 'skill content',
      ensureWt: async () => '/tmp/wt',
      tokenFn: async () => 'gh-token',
      acquireSlotFn,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/allow_xian/);
    expect(mockBridgeFn).not.toHaveBeenCalled();
    // 当前 failing：xian 分支尚未实现，会走 docker 路径
  });

  it('BEHAVIOR-3: task.location=xian + allow_xian=true → 调 spawnCodexBridgeDetached 不调 spawnDockerDetached', async () => {
    const task = {
      id: 'test-123',
      task_type: 'harness_initiative',
      location: 'xian',
      payload: {
        allow_xian: true,
        sprint_dir: 'sprints/test-sprint',
      },
    };
    const result = await spawnSkillRelaySession(task, {
      pool: mockPool,
      bridgeFn: mockBridgeFn,
      spawnFn: mockDockerFn,
      execFn: mockExecFn,
      loadSkill: () => 'skill content',
      ensureWt: async () => '/tmp/wt',
      tokenFn: async () => 'gh-token',
      acquireSlotFn,
    });
    // bridge 应被调用，docker 不应被调用
    expect(mockBridgeFn).toHaveBeenCalledWith(
      expect.stringContaining('3458'),
      expect.objectContaining({
        task_type: 'harness_relay',
        brain_url: expect.stringContaining('5221'),
        slot: expect.objectContaining({
          agent_id: 'xian-m1',
          receipt: 'broker-receipt-fixture',
        }),
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': expect.any(String),
        }),
      }),
    );
    expect(mockDockerFn).not.toHaveBeenCalled();
    // 当前 failing：xian 分支尚未实现
  });

  it('BEHAVIOR-4: bridge spawn 成功 → DB INSERT 含 skill-relay-xian', async () => {
    const task = {
      id: 'test-789',
      task_type: 'harness_initiative',
      location: 'xian',
      payload: {
        allow_xian: true,
        sprint_dir: 'sprints/test-sprint',
      },
    };
    const insertCalls = [];
    const mockPoolTracking = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO initiative_runs')) {
          insertCalls.push({ sql, params });
        }
        return Promise.resolve({ rows: [] });
      }),
    };
    await spawnSkillRelaySession(task, {
      pool: mockPoolTracking,
      bridgeFn: mockBridgeFn,
      spawnFn: mockDockerFn,
      execFn: mockExecFn,
      loadSkill: () => 'skill content',
      ensureWt: async () => '/tmp/wt',
      tokenFn: async () => 'gh-token',
      acquireSlotFn,
    });
    // 确认 initiative_runs 插入包含 skill-relay-xian
    expect(insertCalls.length).toBeGreaterThan(0);
    const insertCall = insertCalls[0];
    const allParams = JSON.stringify(insertCall.params);
    expect(allParams).toContain('skill-relay-xian');
    // 当前 failing：xian 分支尚未实现
  });

  it('BEHAVIOR-6: bridge 抛异常 → task 回滚为 queued，返回 {ok:false}', async () => {
    const failingBridgeFn = vi.fn().mockRejectedValue(new Error('Bridge connection refused'));
    const task = {
      id: 'test-fail-999',
      task_type: 'harness_initiative',
      location: 'xian',
      payload: {
        allow_xian: true,
        sprint_dir: 'sprints/test-sprint',
      },
    };
    const rollbackCalls = [];
    const mockPoolTracking = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (typeof sql === 'string' && sql.includes("status='queued'")) {
          rollbackCalls.push({ sql, params });
        }
        return Promise.resolve({ rows: [] });
      }),
    };
    const result = await spawnSkillRelaySession(task, {
      pool: mockPoolTracking,
      bridgeFn: failingBridgeFn,
      spawnFn: mockDockerFn,
      execFn: mockExecFn,
      loadSkill: () => 'skill content',
      ensureWt: async () => '/tmp/wt',
      tokenFn: async () => 'gh-token',
      acquireSlotFn,
    });
    expect(result.ok).toBe(false);
    expect(rollbackCalls.length).toBeGreaterThan(0);
    // 当前 failing：xian 分支尚未实现
  });
});
