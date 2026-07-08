/**
 * probe 复活回归锁：startProbeLoop 自 Wave-2 后全仓零调用方（probe 死于 05-22），
 * 本测试锁定 startTickLoop 必须启动 probe loop（与 harness-watchdog/recovery/patrol 同模式）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() } }));
vi.mock('../capability-probe.js', () => ({ startProbeLoop: vi.fn() }));
vi.mock('../consciousness-loop.js', () => ({ startConsciousnessLoop: vi.fn() }));
vi.mock('../harness-watchdog-loop.js', () => ({ startHarnessWatchdogLoop: vi.fn(), stopHarnessWatchdogLoop: vi.fn() }));
vi.mock('../recovery-loop.js', () => ({ startRecoveryLoop: vi.fn(), stopRecoveryLoop: vi.fn() }));
vi.mock('../pipeline-patrol-loop.js', () => ({ startPipelinePatrolLoop: vi.fn(), stopPipelinePatrolLoop: vi.fn() }));
vi.mock('../events/taskEvents.js', () => ({ publishCognitiveState: vi.fn() }));
vi.mock('../tick-stats.js', () => ({ recordTickExecution: vi.fn().mockResolvedValue(undefined) }));

import { startTickLoop, stopTickLoop } from '../tick-loop.js';
import { startProbeLoop } from '../capability-probe.js';

beforeEach(() => vi.clearAllMocks());
afterEach(() => stopTickLoop());

describe('startTickLoop', () => {
  it('启动时调用 startProbeLoop（probe 复活）', () => {
    startTickLoop();
    expect(startProbeLoop).toHaveBeenCalledOnce();
  });
});
