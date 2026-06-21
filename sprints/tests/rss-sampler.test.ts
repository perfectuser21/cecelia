import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
// @ts-expect-error 模块尚未实现 — TDD Red：generator 实现后转绿
import { sampleProcessRss } from '../../packages/brain/src/harness-rss-sampler.js';

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
});
