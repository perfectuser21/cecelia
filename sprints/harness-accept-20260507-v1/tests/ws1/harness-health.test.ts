/**
 * Workstream 1 — harness-health endpoint [BEHAVIOR]
 *
 * 这些测试覆盖 contract Step 2 + Step 3 的运行时行为：
 *  - GET /api/brain/harness/health 在 happy path 返 200 + 三字段
 *  - LangGraph 包元数据读取失败时降级 "unknown" 仍 200
 *  - DB 查询失败时 last_attempt_at 降级 null 仍 200
 *
 * Round 1（TDD Red）：harness-health.js 尚不存在，import 触发 ERR_MODULE_NOT_FOUND，
 *   全部用例 FAIL。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db.js — 默认返回最近一次 started_at；fallback 测试中可改为 reject
vi.mock('../../../../packages/brain/src/db.js', () => {
  const mockQuery = vi.fn();
  return {
    default: { query: mockQuery },
    __mockQuery: mockQuery,
  };
});

describe('Workstream 1 — GET /api/brain/harness/health [BEHAVIOR]', () => {
  let app: express.Express;
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const dbModule: any = await import('../../../../packages/brain/src/db.js');
    mockQuery = dbModule.__mockQuery || dbModule.default.query;
    mockQuery.mockReset();

    app = express();
    // Router 必须挂在 /api/brain/harness 前缀（与 server.js 实际挂载一致）
    const routeModule: any = await import(
      '../../../../packages/brain/src/routes/harness-health.js'
    );
    app.use('/api/brain/harness', routeModule.default);
  });

  it('returns HTTP 200 with langgraph_version, last_attempt_at, healthy keys (happy path)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ started_at: '2026-05-07T01:23:45.000Z' }],
    });

    const res = await request(app).get('/api/brain/harness/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('langgraph_version');
    expect(res.body).toHaveProperty('last_attempt_at');
    expect(res.body).toHaveProperty('healthy');
  });

  it('enforces strict types on the three fields (string | string-or-null | true)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ started_at: '2026-05-07T01:23:45.000Z' }],
    });

    const res = await request(app).get('/api/brain/harness/health');

    expect(res.status).toBe(200);
    expect(typeof res.body.langgraph_version).toBe('string');
    expect(
      res.body.last_attempt_at === null ||
        typeof res.body.last_attempt_at === 'string'
    ).toBe(true);
    expect(res.body.healthy).toBe(true);
  });

  it('falls back to "unknown" when langgraph package metadata is unreadable, still HTTP 200', async () => {
    // 模拟 langgraph 包元数据读取失败：mock fs.readFileSync 抛错
    // 由于 harness-health.js 内部应当 try/catch 任何 fs / dynamic import，
    // 端点必须降级 langgraph_version="unknown" 而非 503。
    vi.resetModules();
    vi.doMock('fs', async () => {
      const actual: any = await vi.importActual('fs');
      return {
        ...actual,
        default: {
          ...actual,
          readFileSync: (p: string, ...rest: any[]) => {
            if (typeof p === 'string' && p.includes('@langchain/langgraph')) {
              throw new Error('ENOENT: simulated langgraph metadata missing');
            }
            return actual.readFileSync(p, ...rest);
          },
        },
        readFileSync: (p: string, ...rest: any[]) => {
          if (typeof p === 'string' && p.includes('@langchain/langgraph')) {
            throw new Error('ENOENT: simulated langgraph metadata missing');
          }
          return actual.readFileSync(p, ...rest);
        },
      };
    });

    const dbModule: any = await import('../../../../packages/brain/src/db.js');
    const localMockQuery = dbModule.__mockQuery || dbModule.default.query;
    localMockQuery.mockReset();
    localMockQuery.mockResolvedValueOnce({ rows: [] });

    const localApp = express();
    const routeModule: any = await import(
      '../../../../packages/brain/src/routes/harness-health.js'
    );
    localApp.use('/api/brain/harness', routeModule.default);

    const res = await request(localApp).get('/api/brain/harness/health');

    expect(res.status).toBe(200);
    expect(res.body.langgraph_version).toBe('unknown');
    expect(res.body.healthy).toBe(true);
  });

  it('falls back to last_attempt_at=null when DB query rejects, still HTTP 200', async () => {
    mockQuery.mockRejectedValueOnce(new Error('simulated DB outage'));

    const res = await request(app).get('/api/brain/harness/health');

    expect(res.status).toBe(200);
    expect(res.body.last_attempt_at).toBeNull();
    expect(res.body.healthy).toBe(true);
    // version 仍应是字符串（happy 路径未污染）
    expect(typeof res.body.langgraph_version).toBe('string');
  });
});
