import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// vitest 运行目录: packages/brain/
const GAN_PATH = join(process.cwd(), 'src/workflows/harness-gan.graph.js');

function getProposerBody(): string {
  const c = readFileSync(GAN_PATH, 'utf8');
  const s = c.indexOf('async function proposer(');
  if (s < 0) throw new Error('proposer() not found');
  const e = c.indexOf('\n  async function ', s + 1);
  return c.slice(s, e > 0 ? e : s + 4000);
}

function getReviewerBody(): string {
  const c = readFileSync(GAN_PATH, 'utf8');
  const s = c.indexOf('async function reviewer(');
  if (s < 0) throw new Error('reviewer() not found');
  const e = c.indexOf('\n  async function ', s + 1);
  return c.slice(s, e > 0 ? e : s + 4000);
}

describe('WS3 — GAN 每轮异步化 [BEHAVIOR]', () => {
  it('harness-gan.graph.js 导入 spawnDockerDetached', () => {
    const c = readFileSync(GAN_PATH, 'utf8');
    expect(c).toContain('spawnDockerDetached');
  });

  it('proposer 函数体内不含阻塞 reconnectOrSpawn', () => {
    expect(getProposerBody()).not.toContain('reconnectOrSpawn');
  });

  it('reviewer 函数体内不含阻塞 reconnectOrSpawn', () => {
    expect(getReviewerBody()).not.toContain('reconnectOrSpawn');
  });

  it('harness-gan.graph.js 含 interrupt() 调用（每轮 detached + interrupt）', () => {
    const c = readFileSync(GAN_PATH, 'utf8');
    expect(c).toContain('interrupt');
  });

  it('detectConvergenceTrend 收敛逻辑仍然存在（异步化不破坏收敛判断）', () => {
    const c = readFileSync(GAN_PATH, 'utf8');
    expect(c).toContain('detectConvergenceTrend');
  });

  it('GAN graph 含 thread_lookup 写入（每轮容器 ID 映射）', () => {
    const c = readFileSync(GAN_PATH, 'utf8');
    const hasLookup = c.includes('walking_skeleton_thread_lookup') ||
      c.includes('harness-thread-lookup') ||
      c.includes('harnessThreadLookup');
    expect(hasLookup).toBe(true);
  });
});
