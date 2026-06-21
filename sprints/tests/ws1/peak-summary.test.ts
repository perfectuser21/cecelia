import { describe, it, expect } from 'vitest';
// @ts-ignore — Generator 需在 scripts/measure/container-mem-peak.mjs 导出 summarizePeak（TDD Red：现不存在）
import { summarizePeak } from '../../../scripts/measure/container-mem-peak.mjs';

// summarizePeak(samples_mb: number[], opts?: { exited?: boolean }):
//   { peak_rss_mb, samples_mb, status }
// 纯函数：从采样数组算峰值 + status，环境无关（接缝 #1 逻辑断言）。

describe('summarizePeak [BEHAVIOR] 采样峰值汇总逻辑', () => {
  it('peak_rss_mb 等于采样数组最大值', () => {
    const r = summarizePeak([120.5, 980.2, 1100.7, 1050.1]);
    expect(r.peak_rss_mb).toBe(1100.7);
  });

  it('正常结束标记 status=complete', () => {
    const r = summarizePeak([100, 200, 300], { exited: false });
    expect(r.status).toBe('complete');
    expect(r.samples_mb.length).toBeGreaterThanOrEqual(3);
  });

  it('容器异常退出标记 status=incomplete 并保留最后采样值', () => {
    const r = summarizePeak([100, 200], { exited: true });
    expect(r.status).toBe('incomplete');
    expect(r.peak_rss_mb).toBe(200);
  });

  it('采样点不足 3 个时抛错或标 incomplete（边界：采样间隔过疏）', () => {
    // 实现可选择抛错或返回 incomplete；二者之一即可，但不得静默当 complete
    let flagged = false;
    try {
      const r = summarizePeak([512]);
      if (r.status !== 'complete') flagged = true;
    } catch {
      flagged = true;
    }
    expect(flagged).toBe(true);
  });
});
