/**
 * 回归：alertness CPU 指标不得把邻居容器的负载当成 Brain 自己的病。
 *
 * 2026-09-13 生产实锤（us-vps，2 核，与 openclaw 23 个 agent 同机）：
 * collectCPUMetric 用 os.loadavg()（Docker 不隔离，读全机）→ 邻居把 loadavg
 * 顶到 2.0+ → HIGH_LOAD 连续 3 tick >70% → Escalation 一路升到
 * emergency_brake + safe_mode → stop_dispatch —— 调度器在自己 CPU 只有
 * 0-5% 时把自己刹停。与 PR#5290（executor 同病）同根，修法同源：
 * 邻居高压 + Brain 自身空闲 ⇒ 指标取 Brain 自身 CPU，不触发高负载。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';

describe('alertness CPU 指标 —— 邻居负载免疫（PR#5290 同款语义）', () => {
  let cpuUsageSpy;
  let loadavgSpy;
  let cpusSpy;

  beforeEach(async () => {
    vi.resetModules();
    loadavgSpy = vi.spyOn(os, 'loadavg');
    cpusSpy = vi.spyOn(os, 'cpus');
    cpusSpy.mockReturnValue([{}, {}]); // 定死 2 核（us-vps 同款），CI 核数无关
    cpuUsageSpy = vi.spyOn(process, 'cpuUsage');
  });

  afterEach(() => {
    loadavgSpy.mockRestore();
    cpusSpy.mockRestore();
    cpuUsageSpy.mockRestore();
  });

  async function collectSmoothed({ loadAvg, brainBusy }) {
    // 全机 loadavg 由邻居决定；Brain 自身 CPU 由 process.cpuUsage 增量决定。
    // mock 自洽：CPU 累计量 = 目标占比 × 真实墙钟流逝 → 任意采样间隔下
    // delta/elapsed 恒等于目标占比，测试对真实调度时序免疫。
    loadavgSpy.mockReturnValue([loadAvg, loadAvg, loadAvg]);
    const ratio = brainBusy ? 1.0 : 0.02; // 100% / 2%（单核占比）
    const t0 = Date.now();
    cpuUsageSpy.mockImplementation(() => ({
      user: Math.round(ratio * (Date.now() - t0) * 1000), // µs
      system: 0,
    }));
    const { collectMetrics } = await import('../../alertness/metrics.js');
    let last = null;
    for (let i = 0; i < 8; i += 1) { // 首采样建基线 + 7 个增量样本冲过平滑窗
      await new Promise((r) => { setTimeout(r, 15); });
      last = (await collectMetrics()).cpu;
    }
    return last;
  }

  it('邻居高压 + Brain 空闲 → cpu.value 取 Brain 自身（低），不进 danger', async () => {
    const cpu = await collectSmoothed({ loadAvg: 4.0, brainBusy: false }); // 2 核机 loadavg 4.0 = 200%
    expect(cpu.value).toBeLessThan(30);          // 取的是 Brain 自身 ~2%，非全机 200%
    expect(cpu.status).toBe('normal');
    expect(cpu.system_pressure_pct).toBeGreaterThan(100); // 全机压力保留为观测字段
  });

  it('Brain 自己真忙 → 仍如实报高（不因邻居豁免把真病放走）', async () => {
    const cpu = await collectSmoothed({ loadAvg: 4.0, brainBusy: true });
    expect(cpu.value).toBeGreaterThanOrEqual(80);
    expect(cpu.status).toBe('danger');
  });
});
