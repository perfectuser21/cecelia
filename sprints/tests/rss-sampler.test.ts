import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
// @ts-expect-error 模块尚未实现 — TDD Red：generator 实现后转绿
import { sampleProcessRss, sampleCommandRss } from '../../packages/brain/src/harness-rss-sampler.js';

describe('harness-rss-sampler [BEHAVIOR]', () => {
  it('对真实子进程读真实 RSS：峰值 > 0、采样次数 >= 2（无 mock）', async () => {
    const child = spawn('node', ['-e', 'const a=[];for(let i=0;i<2e6;i++)a.push(i);setTimeout(()=>{},2500)']);
    const { peak_rss_mb, sample_count } = await sampleProcessRss(child.pid, { intervalMs: 200, maxMs: 2000 });
    try { child.kill(); } catch {}
    expect(peak_rss_mb).toBeGreaterThan(0);
    expect(sample_count).toBeGreaterThanOrEqual(2);
  });

  it('提前退出的进程仍给出两点保底峰值 > 0（绝不为 0/空）', async () => {
    const child = spawn('node', ['-e', 'const a=[];for(let i=0;i<1e6;i++)a.push(i);setTimeout(()=>process.exit(0),700)']);
    const { peak_rss_mb, sample_count } = await sampleProcessRss(child.pid, { intervalMs: 300, maxMs: 3000 });
    expect(peak_rss_mb).toBeGreaterThan(0);
    expect(sample_count).toBeGreaterThanOrEqual(1);
  });

  it('进程寿命 ≪ 一个采样间隔：spawn 自管 + start/exit 两点保底 → sample_count>=2、peak>0（interval tick 永不触发）', async () => {
    // 进程约几十 ms，远短于 1000ms 间隔；纯 interval-tick 采样器会得 0 样本/peak=0（PRD 边界逃逸）
    const { peak_rss_mb, sample_count } = await sampleCommandRss(
      'node -e "const a=[];for(let i=0;i<1e6;i++)a.push(i)"',
      { intervalMs: 1000, maxMs: 2000 }
    );
    expect(sample_count).toBeGreaterThanOrEqual(2); // start + exit 两点，非 interval tick
    expect(peak_rss_mb).toBeGreaterThan(0);
  });
});
