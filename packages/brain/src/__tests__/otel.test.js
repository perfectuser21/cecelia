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

  it('initOtel() 在无 HONEYCOMB_API_KEY 时不抛错', async () => {
    const { initOtel } = await import('../otel.js');
    await expect(Promise.resolve(initOtel())).resolves.not.toThrow();
  });

  it('initOtel() 无 key 时返回 null（跳过模式）', async () => {
    const { initOtel } = await import('../otel.js');
    const result = await initOtel();
    expect(result).toBeNull();
  });
});

describe('otel - with HONEYCOMB_API_KEY', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.HONEYCOMB_API_KEY;
    vi.resetModules();
  });

  it('initOtel() 有 key 时返回 SDK 实例（非 null）', async () => {
    vi.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: vi.fn().mockImplementation(() => ({
        start: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      })),
    }));
    vi.doMock('@opentelemetry/exporter-otlp-http', () => ({
      OTLPTraceExporter: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('@opentelemetry/auto-instrumentations-node', () => ({
      getNodeAutoInstrumentations: vi.fn().mockReturnValue([]),
    }));

    process.env.HONEYCOMB_API_KEY = 'test-key-abc123';
    const { initOtel, _resetOtel } = await import('../otel.js');
    const sdk = await initOtel();
    expect(sdk).not.toBeNull();
    _resetOtel();
  });
});
