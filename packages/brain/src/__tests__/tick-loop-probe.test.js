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
import { startHarnessWatchdogLoop } from '../harness-watchdog-loop.js';
import { startRecoveryLoop } from '../recovery-loop.js';
import { startPipelinePatrolLoop } from '../pipeline-patrol-loop.js';

beforeEach(() => vi.clearAllMocks());
afterEach(() => stopTickLoop());

describe('startTickLoop', () => {
  it('启动时调用 startProbeLoop（probe 复活），且并排的兄弟 loop 都各启动一次', () => {
    startTickLoop();
    expect(startProbeLoop).toHaveBeenCalledOnce();
    // 锁定 probe 与其余并排启动的 loop 的架构约定：
    // 未来若有人把 probe 挪走时顺手删了别的 loop，这里会炸
    expect(startHarnessWatchdogLoop).toHaveBeenCalledOnce();
    expect(startRecoveryLoop).toHaveBeenCalledOnce();
    expect(startPipelinePatrolLoop).toHaveBeenCalledOnce();
  });

  it('loop 已在跑时重复调用 startTickLoop 提前退出，startProbeLoop 幂等仍只调用一次', () => {
    startTickLoop();
    startTickLoop(); // 第二次调用应因 isRunning 提前 return false，不重复启动内部 loop
    expect(startProbeLoop).toHaveBeenCalledOnce();
  });
});
