/**
 * impact-contracts 路由 smoke 测试
 * 全链集成测试需要 DB — 此处仅验证路由挂载和导出格式
 *
 * sprint: 08110022-relay-d96c9fa0 ws2
 */
import { describe, test, expect, vi } from 'vitest';
import express from 'express';
import impactContractsRouter, { evaluateImpactContractSubmission } from '../impact-contracts.js';

const TASK_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_BODY = {
  change_kind: 'bugfix',
  repo: 'perfectuser21/cecelia',
  base_revision: 'a'.repeat(40),
  affected_capabilities: [{ capability_id: 'brain' }],
  required_assertions: [],
};

describe('impact-contracts route', () => {
  test('impactContractsRouter 是有效的 Express router', () => {
    expect(impactContractsRouter).toBeDefined();
    expect(typeof impactContractsRouter).toBe('function');
  });

  test('router 可挂载到 Express 应用不抛错', () => {
    const app = express();
    expect(() => app.use('/api/brain', impactContractsRouter)).not.toThrow();
  });

  test('router 有 stack（有路由注册）', () => {
    expect(impactContractsRouter.stack).toBeDefined();
    expect(impactContractsRouter.stack.length).toBeGreaterThan(0);
  });

  test('合同 change_kind 与任务事实不一致时拒绝', async () => {
    const db = {
      query: vi.fn(async () => ({ rows: [{ id: TASK_ID, change_kind: 'capability_change' }] })),
    };
    const structureGate = vi.fn();

    const result = await evaluateImpactContractSubmission({
      db,
      taskId: TASK_ID,
      body: VALID_BODY,
      structureGate,
    });

    expect(result).toMatchObject({
      httpStatus: 409,
      body: { gate: 'blocked', reason: 'change_kind_mismatch' },
    });
    expect(structureGate).not.toHaveBeenCalled();
  });

  test('普通 POST 同样经过 Structure Gate，Mapper 不可用不能直写 active 合同', async () => {
    const db = {
      query: vi.fn(async () => ({ rows: [{ id: TASK_ID, change_kind: 'bugfix' }] })),
    };
    const structureGate = vi.fn(async () => ({
      gate: 'blocked',
      reason: 'mapper_unavailable',
      retryable: true,
      httpStatus: 503,
    }));

    const result = await evaluateImpactContractSubmission({
      db,
      taskId: TASK_ID,
      body: VALID_BODY,
      structureGate,
    });

    expect(result).toMatchObject({
      httpStatus: 503,
      body: { gate: 'blocked', reason: 'mapper_unavailable', retryable: true },
    });
    expect(structureGate).toHaveBeenCalledOnce();
  });
});
