import { afterEach, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ read: vi.fn(), fetch: vi.fn(), query: vi.fn() }));
vi.mock('fs', () => ({ readFileSync: io.read }));
vi.mock('../../db.js', () => ({ default: { query: io.query } }));
vi.mock('../../embedding-service.js', () => ({ generateProfileFactEmbeddingAsync: vi.fn() }));
vi.mock('../../notion-memory-sync.js', () => ({ pushFactToNotion: vi.fn() }));
import profileFacts from '../profile-facts.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('profile facts 真实 import 路由在读 MiniMax 凭据前拒绝隔离环境', async () => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubGlobal('fetch', io.fetch);
  io.read.mockReturnValue('{"api_key":"fixture-only"}');
  io.fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"facts":[]}' } }] }) });
  io.query.mockResolvedValue({ rows: [] });
  const handler = profileFacts.stack.find(layer => layer.route?.path === '/import').route.stack[0].handle;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ body: { text: '一段需要模型分析的文本' } }, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('禁止真实模型调用') }));
  expect(io.read).not.toHaveBeenCalled();
  expect(io.fetch).not.toHaveBeenCalled();
  expect(io.query).not.toHaveBeenCalled();
});
