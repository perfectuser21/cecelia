/**
 * otel.js 单元测试
 * TDD: 先写失败 test，install 依赖 + 实现后变绿
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('otel - graceful skip when no API key', () => {
  const origKey = process.env.HONEYCOMB_API_KEY;

  beforeEach(() => {
    delete process.env.HONEYCOMB_API_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    if (origKey !== undefined) {
      process.env.HONEYCOMB_API_KEY = origKey;
    } else {
      delete process.env.HONEYCOMB_API_KEY;
    }
  });

  it('initOtel() 无 HONEYCOMB_API_KEY 时返回 null（静默跳过，不初始化 SDK）', async () => {
    const { initOtel } = await import('../otel.js');
    const result = await initOtel();
    // 无 key 时必须返回 null，表示 OTel 未初始化
    expect(result).toBe(null);
  });

  it('initOtel() 连续调用两次无 key 均返回 null（幂等跳过）', async () => {
    const { initOtel } = await import('../otel.js');
    const r1 = await initOtel();
    const r2 = await initOtel();
    expect(r1).toBe(null);
    expect(r2).toBe(null);
  });
});

describe('otel - with HONEYCOMB_API_KEY', () => {
  let mockStart;

  beforeEach(() => {
    vi.resetModules();
    mockStart = vi.fn();
    vi.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: vi.fn().mockImplementation(() => ({
        start: mockStart,
        shutdown: vi.fn().mockResolvedValue(undefined),
      })),
    }));
    vi.doMock('@opentelemetry/exporter-otlp-http', () => ({
      OTLPTraceExporter: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('@opentelemetry/auto-instrumentations-node', () => ({
      getNodeAutoInstrumentations: vi.fn().mockReturnValue([]),
    }));
  });

  afterEach(() => {
    delete process.env.HONEYCOMB_API_KEY;
    vi.resetModules();
  });

  it('initOtel() 有 key 时调用 sdk.start()（OTel SDK 已激活）', async () => {
    process.env.HONEYCOMB_API_KEY = 'test-key-abc123';
    const { initOtel, _resetOtel } = await import('../otel.js');
    await initOtel();
    // 真行为验证：SDK 的 start() 方法被调用过，证明 OTel 真正启动
    expect(mockStart).toHaveBeenCalledTimes(1);
    _resetOtel();
  });

  it('initOtel() 有 key 时返回 NodeSDK 对象（包含 start/shutdown 方法）', async () => {
    process.env.HONEYCOMB_API_KEY = 'test-key-abc123';
    const { initOtel, _resetOtel } = await import('../otel.js');
    const sdk = await initOtel();
    // 验 sdk 对象有 start 方法（行为接口验证，非 null 检查）
    expect(typeof sdk.start).toBe('function');
    expect(typeof sdk.shutdown).toBe('function');
    _resetOtel();
  });
});
