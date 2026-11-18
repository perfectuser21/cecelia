import { it, expect, vi } from 'vitest';

const calls = vi.hoisted(() => ({ graph: vi.fn(), query: vi.fn(), guidance: vi.fn() }));
vi.mock('../consciousness-guard.js', () => ({ isConsciousnessEnabled: () => false }));
vi.mock('../workflows/consciousness.graph.js', () => ({ getCompiledConsciousnessGraph: calls.graph }));
vi.mock('../db.js', () => ({ default: { query: calls.query } }));
vi.mock('../guidance.js', () => ({ getGuidance: calls.guidance, setGuidance: calls.guidance }));
import { startConsciousnessLoop, stopConsciousnessLoop } from '../consciousness-loop.js';

// 从已退出默认CI的loop专项中保留关闭态合同，不启用思考图。
it('关闭后台思考时不建定时器，不调用图、数据库或guidance', () => {
  vi.useFakeTimers();
  try {
    expect(startConsciousnessLoop()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(calls.graph).not.toHaveBeenCalled();
    expect(calls.query).not.toHaveBeenCalled();
    expect(calls.guidance).not.toHaveBeenCalled();
  } finally {
    stopConsciousnessLoop();
    vi.useRealTimers();
  }
});
