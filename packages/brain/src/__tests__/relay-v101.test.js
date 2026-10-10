// 本文件验证已获授权后的协议；真实默认拒绝见 execution-directory/legacy-relay.test.js。
vi.mock('../execution-directory/legacy-relay.js',()=>({withLegacyRelayExecution:async(_identity,operation)=>operation()}));
// 此执行器测试注入模拟传输；真实隔离入口由 runtime-isolation.test.js 验证。
vi.mock('../runtime-safety.js', () => ({ assertExternalExecutionAllowed: () => {} }));
/**
 * v1.0.1 接线三件（N4 三跑实证修订，与 harness-controller skill v1.1.0 配套）：
 * 1. spawn env 补 HARNESS_NODE + HARNESS_CALLBACK_URL —— entrypoint tee stdout 观测
 * 2. /harness/callback/:containerId 对 cecelia-relay-* 容器 200 ack ——
 *    relay session 无 thread_lookup，免掉 entrypoint 5×404 重试尾巴（~36s/session）
 *
 * relay run 的回写契约已迁移到 run_id 精确寻址；永久回归由
 * relay-runs-exact-api.test.js 与 relay-runs-legacy-adapter.test.js 承接。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/orchestrator', router);
  return a;
}

beforeEach(() => {
  mockPool.query.mockReset();
});

describe('spawn env 观测接线（HARNESS_NODE + HARNESS_CALLBACK_URL）', () => {
  it('spawnSkillRelaySession 的 env 含 HARNESS_NODE=controller 且 callback URL 含 containerId', async () => {
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const deps = {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({}),
      loadSkill: vi.fn().mockReturnValue('SKILL'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt'),
      resolveAccountFn: vi.fn().mockImplementation(async (o) => { o.env = o.env || {}; o.env.CECELIA_CREDENTIALS = 'account1'; }),  // 新契约（5167ef48）：claude 需已解析账号
      tokenFn: vi.fn().mockResolvedValue('t'),
      now: () => new Date('2026-07-04T12:00:00Z'),
      snapshotCodexHome: vi.fn().mockReturnValue('/tmp/fake-snapshot-dir'),
    };
    // Claude 无头通道已退役（任务 76a160b3）：env/callback 接线与执行体无关，用 codex 执行体覆盖
    const task = { id: 'aaaabbbb-cccc-dddd-eeee-ffff00001111', payload: { orchestrator: 'skill-relay', sprint_dir: 's', executor: 'codex' } };
    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(true);
    const opts = deps.spawnFn.mock.calls[0][0];
    expect(opts.env.HARNESS_NODE).toBe('controller');
    expect(opts.env.HARNESS_CALLBACK_URL).toContain(opts.containerId);
    expect(opts.env.HARNESS_CALLBACK_URL).toMatch(/^http:\/\/host\.docker\.internal:5221\/api\/brain\/harness\/callback\//);
  });

  it('executor 缺省（claude）→ claude_channel_retired，不 spawn（任务 76a160b3）', async () => {
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const deps = { pool: { query: vi.fn().mockResolvedValue({ rows: [] }) }, spawnFn: vi.fn(), loadSkill: vi.fn(), ensureWt: vi.fn() };
    const r = await spawnSkillRelaySession({ id: 'aaaabbbb-cccc-dddd-eeee-ffff00009999', payload: { orchestrator: 'skill-relay', sprint_dir: 's' } }, deps);
    expect(r).toMatchObject({ ok: false, error: 'claude_channel_retired' });
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });
});

describe('harness-callback 对 relay 容器 200 ack', () => {
  it('containerId 前缀 cecelia-relay- → 200 relayAck，不做 thread lookup', async () => {
    const { default: cbRouter } = await import('../routes/harness-callback.js');
    const a = express();
    a.use(express.json());
    a.use('/api/brain', cbRouter);
    const r = await request(a)
      .post('/api/brain/harness/callback/cecelia-relay-deadbeef-12345678')
      .send({ result: 'completed', exit_code: 0, stdout: 'x' });
    expect(r.status).toBe(200);
    expect(r.body.relayAck).toBe(true);
  });
});
