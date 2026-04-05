/**
 * pipeline-patrol dedup 逻辑测试
 *
 * 验证 createRescueTask 的 dedup SQL 在 24h 窗口内阻止同一分支重复创建，
 * 包括已被 canceled 的任务（防止 cancel→2h 后重建→cancel 无限循环）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('child_process', () => ({ execSync: vi.fn().mockReturnValue('') }));
vi.mock('fs', () => ({
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: vi.fn().mockReturnValue(''),
  existsSync: vi.fn().mockReturnValue(false),
}));

import { DEDUP_COOLDOWN_MS } from '../pipeline-patrol.js';

describe('DEDUP_COOLDOWN_MS', () => {
  it('冷却时间为 24h（86400000ms）', () => {
    expect(DEDUP_COOLDOWN_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('pipeline-patrol dedup SQL', () => {
  it('dedup SQL 包含 24 hours 窗口', async () => {
    const src = await import('fs').then(
      () => require('fs').readFileSync(
        require('path').join(__dirname, '../pipeline-patrol.js'),
        'utf8'
      )
    ).catch(() => {
      // 直接读文件内容
      const fs = require('fs');
      const path = require('path');
      return fs.readFileSync(path.join(__dirname, '../pipeline-patrol.js'), 'utf8');
    });

    expect(src).toContain('24 hours');
    expect(src).toContain("status IN ('completed', 'cancelled', 'canceled')");
  });

  it('dedup SQL 对 canceled 状态也生效（24h 窗口内阻止重建）', async () => {
    const src = (() => {
      const fs = require('fs');
      const path = require('path');
      return fs.readFileSync(path.join(__dirname, '../pipeline-patrol.js'), 'utf8');
    })();

    // 验证新的 OR 条件存在（活跃任务 OR 24h 内 canceled/completed）
    expect(src).toContain('status NOT IN');
    expect(src).toContain('24 hours');
    // 旧的 2h 单独 dedup 窗口不再存在
    expect(src).not.toMatch(/AND created_at > NOW\(\) - INTERVAL '2 hours'/);
  });
});
