import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query, connect: vi.fn() } }));
vi.mock('../../llm-caller.js', () => ({ callLLM: vi.fn(), callLLMStream: vi.fn() }));
vi.mock('../../executor.js', () => ({ triggerCeceliaRun: vi.fn() }));
vi.mock('../../tick.js', () => ({ getTickStatus: vi.fn(), runTickSafe: vi.fn() }));
vi.mock('../../cortex.js', () => ({ searchRelevantAnalyses: vi.fn() }));
vi.mock('../../orchestrator-chat.js', () => ({ handleChat: vi.fn(), handleChatStream: vi.fn() }));
vi.mock('../../orchestrator-realtime.js', () => ({ getRealtimeConfig: vi.fn(), handleRealtimeTool: vi.fn() }));

const cases = [
  ['analytics', '/cortex/analyses?task_id=existing-task'],
  ['brain-meta', '/policies'],
  ['execution', '/execution-history'],
  ['goals', '/blocks/task/existing-task'],
  ['system-reports', '/'],
  ['warroom', '/line/existing-line/advancements'],
];

describe('模块路由限流只消耗匹配请求的额度', () => {
  for (const [moduleName, path] of cases) {
    it(`${moduleName}：未匹配请求不计数，正常批量可读，超限不再查询数据库`, async () => {
      query.mockReset();
      query.mockImplementation(async (sql) => ({
        rows: /count\s*\(/i.test(sql) ? [{ count: '0', total: '0' }] : [],
        rowCount: 0,
      }));
      const { default: router } = await import(`../${moduleName}.js`);
      const app = express();
      app.use(express.json());
      app.use('/test', router);
      app.use('/test/not/a/route', (_req, res) => res.json({ forwarded: true }));
      const server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const client = request(server);
      try {
        // 若误用router.use，穿过模块的其他Brain路由也会耗尽本模块额度。
        for (let index = 0; index < 1201; index++) {
          const response = await client.get('/test/not/a/route');
          expect(response.status).toBe(200);
          expect(response.body.forwarded).toBe(true);
        }
        expect(query).not.toHaveBeenCalled();
        for (let index = 0; index < 1200; index++) {
          expect((await client.get(`/test${path}`)).status).toBe(200);
        }
        const callsBeforeBlock = query.mock.calls.length;
        expect(callsBeforeBlock).toBeGreaterThanOrEqual(1200);
        const blocked = await client.get(`/test${path}`);
        expect(blocked.status).toBe(429);
        expect(blocked.headers.ratelimit).toContain('limit=1200');
        expect(blocked.headers['x-ratelimit-limit']).toBeUndefined();
        expect(query).toHaveBeenCalledTimes(callsBeforeBlock);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }, 30_000);
  }
});
