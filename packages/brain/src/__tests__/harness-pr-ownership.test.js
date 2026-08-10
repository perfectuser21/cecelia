/**
 * harness-pr-ownership 单测。
 *
 * 覆盖：
 *   - 纯函数层 extractBranchIdTokens / buildOwnershipQuery / resolvePrOwnership
 *   - GET /api/brain/harness/pr-ownership 路由（已知 harness PR / 已知非 harness PR）
 *
 * 法源：决策 e8f6134f；事故 PR #4755（auto-merge 归属判据改向 Brain 求证）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  extractBranchIdTokens,
  buildOwnershipQuery,
  resolvePrOwnership,
} from '../harness-pr-ownership.js';

describe('extractBranchIdTokens', () => {
  it('从 generator 分支抽出 task 短 id，排除 8 位纯数字时间戳', () => {
    // cp-08101107-04e4690d：08101107 是时间戳（纯数字，排除），04e4690d 是 task 短 id
    expect(extractBranchIdTokens('cp-08101107-04e4690d')).toEqual(['04e4690d']);
  });

  it('从手工 /dev 分支抽出末尾 hex，忽略 slug 词', () => {
    expect(extractBranchIdTokens('cp-08081317-gate3-deploy-fix-cd7e0028'))
      .toEqual(['cd7e0028']);
  });

  it('空分支返回空数组', () => {
    expect(extractBranchIdTokens('')).toEqual([]);
    expect(extractBranchIdTokens(undefined)).toEqual([]);
  });
});

describe('buildOwnershipQuery', () => {
  it('给 pr_number 时用 pr_url LIKE %/pull/<n> 求证', () => {
    const built = buildOwnershipQuery({ prNumber: '4755' });
    expect(built).not.toBeNull();
    expect(built.sql).toContain('pr_url LIKE');
    expect(built.params).toContain('%/pull/4755');
  });

  it('给分支时用 current_task_id / initiative_id 前缀求证', () => {
    const built = buildOwnershipQuery({ branch: 'cp-08101107-04e4690d' });
    expect(built.sql).toContain('current_task_id::text LIKE');
    expect(built.sql).toContain('initiative_id::text LIKE');
    expect(built.params).toContain('04e4690d%');
  });

  it('无任何可用判据 → 返回 null', () => {
    expect(buildOwnershipQuery({ branch: 'cp-08101107-' })).toBeNull();
    expect(buildOwnershipQuery({})).toBeNull();
  });

  it('非法 pr_number 不进入 SQL（防注入/脏参数）', () => {
    const built = buildOwnershipQuery({ prNumber: '4755; DROP TABLE x', branch: '' });
    expect(built).toBeNull();
  });
});

describe('resolvePrOwnership', () => {
  it('查询命中 → owned:true 且带 run_id', async () => {
    const fakeQuery = vi.fn(async () => ({
      rows: [{ id: 'run-1', initiative_id: 'init-1', pr_url: 'https://github.com/x/y/pull/4755' }],
    }));
    const r = await resolvePrOwnership(fakeQuery, { prNumber: '4755' });
    expect(r.owned).toBe(true);
    expect(r.run_id).toBe('run-1');
    expect(r.matched_by).toBe('pr');
  });

  it('查询无命中 → owned:false', async () => {
    const fakeQuery = vi.fn(async () => ({ rows: [] }));
    const r = await resolvePrOwnership(fakeQuery, { branch: 'cp-08081317-manual-cd7e0028' });
    expect(r.owned).toBe(false);
  });

  it('无可用判据 → owned:false, reason=no_usable_identifier（不误判 owned）', async () => {
    const fakeQuery = vi.fn(async () => ({ rows: [] }));
    const r = await resolvePrOwnership(fakeQuery, { branch: 'cp-08101107-' });
    expect(r.owned).toBe(false);
    expect(r.reason).toBe('no_usable_identifier');
    expect(fakeQuery).not.toHaveBeenCalled();
  });
});

// ── 路由层：GET /api/brain/harness/pr-ownership ─────────────────────────────────
const queryMock = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => queryMock(...args) },
  getPoolHealth: () => ({ total: 0, idle: 0, waiting: 0, activeCount: 0 }),
}));

describe('GET /api/brain/harness/pr-ownership', () => {
  let app;
  let request;

  beforeEach(async () => {
    queryMock.mockReset();
    const express = (await import('express')).default;
    request = (await import('supertest')).default;
    const harnessRouter = (await import('../routes/harness.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/brain/harness', harnessRouter);
  });

  it('已知 harness PR（Brain 有匹配 run）→ owned:true', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'run-42', initiative_id: 'init-9', pr_url: 'https://github.com/perfectuser21/cecelia/pull/4755' }],
    });
    const res = await request(app)
      .get('/api/brain/harness/pr-ownership')
      .query({ branch: 'cp-08101107-04e4690d', pr_number: '4755' });
    expect(res.status).toBe(200);
    expect(res.body.owned).toBe(true);
    expect(res.body.run_id).toBe('run-42');
  });

  it('已知非 harness PR（Brain 无匹配 run）→ owned:false', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/brain/harness/pr-ownership')
      .query({ branch: 'cp-08081317-manual-cd7e0028', pr_number: '9999' });
    expect(res.status).toBe(200);
    expect(res.body.owned).toBe(false);
  });

  it('缺全部入参 → 400', async () => {
    const res = await request(app).get('/api/brain/harness/pr-ownership');
    expect(res.status).toBe(400);
  });

  it('DB 抛错 → 500（调用方据此 fail-closed）', async () => {
    queryMock.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app)
      .get('/api/brain/harness/pr-ownership')
      .query({ pr_number: '4755' });
    expect(res.status).toBe(500);
  });
});
