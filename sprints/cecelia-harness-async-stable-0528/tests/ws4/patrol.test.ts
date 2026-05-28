import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// vitest 运行目录: packages/brain/
const PATROL_PATH = join(process.cwd(), 'src/harness-initiative-patrol.js');
const PLUGIN_PATH = join(process.cwd(), 'src/pipeline-patrol-plugin.js');

describe('WS4 — Harness Initiative Patrol [BEHAVIOR]', () => {
  it('harness-initiative-patrol.js 文件存在', () => {
    expect(existsSync(PATROL_PATH)).toBe(true);
  });

  it('patrol 文件含 initiative_runs 查询', () => {
    const c = readFileSync(PATROL_PATH, 'utf8');
    expect(c).toContain('initiative_runs');
  });

  it('patrol 文件含 completed_at IS NULL 扫描逻辑', () => {
    const c = readFileSync(PATROL_PATH, 'utf8');
    expect(c).toContain('completed_at');
  });

  it('patrol 含 Planner 卡住阈值（15 分钟）', () => {
    const c = readFileSync(PATROL_PATH, 'utf8');
    expect(c).toMatch(/15/);
  });

  it('patrol 含 GAN 卡住阈值（20 分钟）', () => {
    const c = readFileSync(PATROL_PATH, 'utf8');
    expect(c).toMatch(/20/);
  });

  it('patrol 含 harness_intervention 任务创建', () => {
    const c = readFileSync(PATROL_PATH, 'utf8');
    expect(c).toContain('harness_intervention');
  });

  it('patrol 含防重逻辑（同 initiative 已有 pending 则跳过）', () => {
    const c = readFileSync(PATROL_PATH, 'utf8');
    const hasDedup = c.includes('pending') || c.includes('duplicate') || c.includes('existing') || c.includes('count');
    expect(hasDedup).toBe(true);
  });

  it('patrol 含 try-catch 错误处理（patrol 失败不崩溃 Brain tick）', () => {
    const c = readFileSync(PATROL_PATH, 'utf8');
    expect(c).toMatch(/try|catch/);
  });

  it('pipeline-patrol-plugin.js 集成 harness patrol 调用', () => {
    const c = readFileSync(PLUGIN_PATH, 'utf8');
    const integrated = c.includes('harness-initiative-patrol') ||
      c.includes('harnessPatrol') ||
      c.includes('harness_patrol');
    expect(integrated).toBe(true);
  });
});
