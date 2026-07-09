import { describe, it, expect } from 'vitest';
import diagnosis from '../diagnosis.js';

const { ANOMALY_PATTERNS } = diagnosis;

function buildHistory(entries) {
  // entries: [{ value, timestamp }]
  return entries.map(e => ({ metrics: { memory: { value: e.value } }, timestamp: e.timestamp }));
}

describe('ANOMALY_PATTERNS.MEMORY_LEAK', () => {
  it('时间窗小于 2 分钟时，即使增长率数值很高也不判定为泄漏（防噪声误判）', () => {
    const now = 1000000;
    // 10 个采样点，全部挤在 6 秒内（0.1 分钟），372MB 附近的正常小波动
    // 会被短时间窗放大成虚高的 MB/分钟速率。
    const history = buildHistory([
      { value: 370, timestamp: now },
      { value: 371, timestamp: now + 600 },
      { value: 372, timestamp: now + 1200 },
      { value: 371, timestamp: now + 1800 },
      { value: 373, timestamp: now + 2400 },
      { value: 372, timestamp: now + 3000 },
      { value: 374, timestamp: now + 3600 },
      { value: 373, timestamp: now + 4200 },
      { value: 375, timestamp: now + 4800 },
      { value: 380, timestamp: now + 6000 },
    ]);
    const metrics = { memory: { value: 380 } };

    expect(ANOMALY_PATTERNS.MEMORY_LEAK.checks(metrics, history)).toBe(false);
  });

  it('时间窗 >= 2 分钟且增长率超阈值时，仍正确判定为泄漏（不误伤真实检测）', () => {
    const now = 1000000;
    const history = buildHistory([
      { value: 200, timestamp: now },
      { value: 220, timestamp: now + 20000 },
      { value: 240, timestamp: now + 40000 },
      { value: 260, timestamp: now + 60000 },
      { value: 280, timestamp: now + 80000 },
      { value: 300, timestamp: now + 100000 },
      { value: 320, timestamp: now + 120000 },
      { value: 340, timestamp: now + 140000 },
      { value: 360, timestamp: now + 160000 },
      { value: 400, timestamp: now + 180000 }, // 3 分钟窗口，200MB 涨到 400MB
    ]);
    const metrics = { memory: { value: 400 } };

    expect(ANOMALY_PATTERNS.MEMORY_LEAK.checks(metrics, history)).toBe(true);
  });

  it('时间窗恰好 2 分钟且增长率超阈值时，边界条件应判定为泄漏（验证 timeDiffMinutes===2 不被短路）', () => {
    const now = 1000000;
    // 10 个采样点，恰好跨越 2 分钟（120000ms）
    // 200MB 涨到 350MB，增长 150MB，速率 75MB/分钟 > 50MB/分钟阈值
    const history = buildHistory([
      { value: 200, timestamp: now },
      { value: 216.67, timestamp: now + 12000 },
      { value: 233.33, timestamp: now + 24000 },
      { value: 250, timestamp: now + 36000 },
      { value: 266.67, timestamp: now + 48000 },
      { value: 283.33, timestamp: now + 60000 },
      { value: 300, timestamp: now + 72000 },
      { value: 316.67, timestamp: now + 84000 },
      { value: 333.33, timestamp: now + 96000 },
      { value: 350, timestamp: now + 120000 }, // 2 分钟窗口，150MB 增长
    ]);
    const metrics = { memory: { value: 350 } };

    expect(ANOMALY_PATTERNS.MEMORY_LEAK.checks(metrics, history)).toBe(true);
  });
});
