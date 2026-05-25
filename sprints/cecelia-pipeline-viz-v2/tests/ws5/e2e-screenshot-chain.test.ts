import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

const SCREENSHOTS_DIR = join(process.env.HOME || '/home/cecelia', 'claude-output', 'harness-screenshots');

describe('WS5 — E2E 截图链路验证 [BEHAVIOR]', () => {
  it('~/claude-output/harness-screenshots/ 目录可创建（前置环境）', () => {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    expect(existsSync(SCREENSHOTS_DIR)).toBe(true);
  });

  it('/api/brain/harness/initiative/:id/detail 端点可访问（端到端链路）', async () => {
    const res = await fetch('http://localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail');
    // 应返回 404（initiative 不存在），但不是 500 或 connection refused
    expect([200, 404]).toContain(res.status);
  });

  it('Brain API 健康检查（E2E 前置依赖）', async () => {
    const res = await fetch('http://localhost:5221/api/brain/health');
    expect(res.ok).toBe(true);
  });

  it('harness-screenshots 目录有 PNG 文件（需先跑 E2E final-e2e 脚本）', () => {
    if (!existsSync(SCREENSHOTS_DIR)) {
      console.log('SKIP: harness-screenshots 目录不存在，需先跑 E2E');
      return;
    }
    const pngs = readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.png'));
    // TDD Red: 此时 E2E 未跑，截图为 0 → 测试 fail
    expect(pngs.length).toBeGreaterThanOrEqual(1);
  });
});
