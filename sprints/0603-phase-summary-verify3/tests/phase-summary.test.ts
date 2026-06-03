/**
 * Sprint TDD Red — phase-summary route
 *
 * 期望红证据：packages/brain/src/routes/initiative-runs.js 不存在，
 * import 阶段抛 ERR_MODULE_NOT_FOUND → 6 个 it 块全部 FAIL。
 *
 * Generator 实现后转绿。Evaluator 不读 vitest verdict，
 * 真验收以 contract-dod.md 的 BEHAVIOR manual:bash 命令为准（v7.4 协议）。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

let app: express.Express;

beforeAll(async () => {
  const initiativeRunsRouter = (
    await import('../../../packages/brain/src/routes/initiative-runs.js')
  ).default;
  app = express();
  app.use('/api/brain/initiative-runs', initiativeRunsRouter);
});

describe('GET /api/brain/initiative-runs/phase-summary [BEHAVIOR]', () => {
  it('返回 HTTP 200 + 顶层是 JSON 数组', async () => {
    const res = await request(app).get('/api/brain/initiative-runs/phase-summary');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('非空时每条元素 keys 完整匹配 ["count","phase"]，无多余字段', async () => {
    const res = await request(app).get('/api/brain/initiative-runs/phase-summary');
    expect(res.status).toBe(200);
    if (res.body.length > 0) {
      for (const item of res.body) {
        expect(Object.keys(item).sort()).toEqual(['count', 'phase']);
      }
    }
  });

  it('非空时 phase 是 string、count 是 number 且 >= 1', async () => {
    const res = await request(app).get('/api/brain/initiative-runs/phase-summary');
    if (res.body.length > 0) {
      for (const item of res.body) {
        expect(typeof item.phase).toBe('string');
        expect(typeof item.count).toBe('number');
        expect(item.count).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('NULL phase 行不出现在结果中（PRD 边界第 27 行）', async () => {
    const res = await request(app).get('/api/brain/initiative-runs/phase-summary');
    for (const item of res.body) {
      expect(item.phase).not.toBeNull();
    }
  });

  it('count 整体单调降序', async () => {
    const res = await request(app).get('/api/brain/initiative-runs/phase-summary');
    const counts = res.body.map((x: { count: number }) => x.count);
    const sortedDesc = [...counts].sort((a, b) => b - a);
    expect(counts).toEqual(sortedDesc);
  });

  it('禁用字段名反向断言 — 不含 name/total/stage/runs/n/num/cnt/value/type/phase_name/phaseName', async () => {
    const res = await request(app).get('/api/brain/initiative-runs/phase-summary');
    const forbidden = [
      'name',
      'phase_name',
      'phaseName',
      'stage',
      'type',
      'total',
      'n',
      'num',
      'runs',
      'value',
      'cnt',
    ];
    for (const item of res.body) {
      for (const key of forbidden) {
        expect(item, `禁用字段 ${key} 出现在响应`).not.toHaveProperty(key);
      }
    }
  });
});
