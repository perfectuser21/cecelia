import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ read: vi.fn(), websocket: vi.fn(), query: vi.fn() }));
vi.mock('fs', () => ({ readFileSync: io.read }));
vi.mock('ws', () => ({ default: io.websocket }));
vi.mock('../db.js', () => ({ default: { query: io.query } }));
import { getRealtimeConfig, handleRealtimeWebSocket, _resetApiKey } from '../orchestrator-realtime.js';

beforeEach(() => {
  vi.clearAllMocks();
  _resetApiKey();
  for (const key of ['NODE_ENV', 'VITEST', 'BRAIN_PREVIEW', 'BRAIN_EVALUATOR_MODE', 'DB_NAME', 'PGDATABASE', 'DATABASE_URL', 'CECELIA_LLM_DISABLED']) vi.stubEnv(key, '');
  io.read.mockReturnValue('OPENAI_API_KEY=fixture-only');
  io.websocket.mockImplementation(() => ({ on: vi.fn(), close: vi.fn(), send: vi.fn() }));
  io.query.mockResolvedValue({ rows: [] });
});
afterEach(() => { _resetApiKey(); vi.unstubAllEnvs(); });
const isolationModes = [
  ['NODE_ENV', 'test'], ['NODE_ENV', 'development'], ['BRAIN_PREVIEW', '1'],
  ['BRAIN_EVALUATOR_MODE', 'true'], ['DB_NAME', 'cecelia_scratch'], ['CECELIA_LLM_DISABLED', 'true'],
];

describe('Realtime入口使用真实隔离判断，系统边界均为模拟', () => {
  it.each(isolationModes)('%s=%s时配置接口不得读取或返回凭据', (key, value) => {
    vi.stubEnv(key, value);
    expect(getRealtimeConfig()).toMatchObject({ success: false, code: 'LLM_RUNTIME_ISOLATED' });
    expect(io.read).not.toHaveBeenCalled();
    expect(io.websocket).not.toHaveBeenCalled();
    expect(io.query).not.toHaveBeenCalled();
  });

  it.each(isolationModes)('%s=%s时WS安全关闭，不抛出异常或连接模型', (key, value) => {
    vi.stubEnv(key, value);
    const client = { close: vi.fn(), on: vi.fn() };
    expect(() => handleRealtimeWebSocket(client, {})).not.toThrow();
    expect(client.close).toHaveBeenCalledWith(1008, 'LLM_RUNTIME_ISOLATED');
    expect(io.read).not.toHaveBeenCalled();
    expect(io.websocket).not.toHaveBeenCalled();
    expect(io.query).not.toHaveBeenCalled();
  });

  it('已有凭据缓存也不能绕过随后启用的隔离', () => {
    expect(getRealtimeConfig().success).toBe(true);
    vi.stubEnv('NODE_ENV', 'test');
    io.read.mockClear();
    expect(getRealtimeConfig()).toMatchObject({ success: false, code: 'LLM_RUNTIME_ISOLATED' });
    const client = { close: vi.fn(), on: vi.fn() };
    handleRealtimeWebSocket(client, {});
    expect(client.close).toHaveBeenCalledWith(1008, 'LLM_RUNTIME_ISOLATED');
    expect(io.read).not.toHaveBeenCalled();
    expect(io.websocket).not.toHaveBeenCalled();
  });

  it('生产路径仍使用原协议和模拟WebSocket传输', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('DB_NAME', 'cecelia');
    expect(getRealtimeConfig()).toMatchObject({ success: true, config: { api_key: 'fixture-only' } });
    const client = { close: vi.fn(), on: vi.fn() };
    handleRealtimeWebSocket(client, {});
    expect(io.websocket).toHaveBeenCalledTimes(1);
    expect(client.close).not.toHaveBeenCalled();
  });
});
