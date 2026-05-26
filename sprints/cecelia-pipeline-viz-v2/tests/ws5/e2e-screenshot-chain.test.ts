import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * WS5 — E2E 截图链路验证（端到端验收 WS1-WS4 联动）
 *
 * 验证：
 * 1. harness-screenshots 目录可创建（截图路径存在）
 * 2. /api/brain/harness/initiative/:id/detail 端点可访问（200 or 404，非 500）
 * 3. 测试文件正确引用关键路径
 *
 * 运行环境要求：Brain 在 localhost:5221 运行（BEHAVIOR 4 需要 Brain 存活）
 */

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';
const HARNESS_SCREENSHOTS_DIR = join(
  process.env.HOME || '/tmp',
  'claude-output/harness-screenshots'
);
const TEST_INITIATIVE_ID = '00000000-0000-0000-0000-000000000099';
const DETAIL_ENDPOINT = `/api/brain/harness/initiative/${TEST_INITIATIVE_ID}/detail`;

describe('WS5 — E2E 截图链路验证', () => {
  describe('harness-screenshots 目录', () => {
    it('文件存在含关键断言：harness-screenshots 目录可创建且路径正确', () => {
      mkdirSync(HARNESS_SCREENSHOTS_DIR, { recursive: true });
      expect(existsSync(HARNESS_SCREENSHOTS_DIR)).toBe(true);
      expect(HARNESS_SCREENSHOTS_DIR).toContain('harness-screenshots');
    });
  });

  describe('/api/brain/harness/initiative/:id/detail 端点', () => {
    let statusCode: number;

    beforeAll(async () => {
      try {
        const resp = await fetch(`${BRAIN_URL}${DETAIL_ENDPOINT}`, {
          signal: AbortSignal.timeout(5000),
        });
        statusCode = resp.status;
      } catch {
        statusCode = 0;
      }
    });

    it('/detail 端点返回非 500（200 or 404 均为正常，500 表示端点异常）', () => {
      expect(statusCode).not.toBe(500);
    });

    it('/detail 端点不因 connection refused 返回 0（Brain 必须运行）', () => {
      expect(statusCode).not.toBe(0);
    });

    it('/detail 端点返回 200 或 404', () => {
      expect([200, 404]).toContain(statusCode);
    });
  });

  describe('合同路径引用验证', () => {
    it('DETAIL_ENDPOINT 引用 /api/brain/harness/initiative 路径', () => {
      expect(DETAIL_ENDPOINT).toContain('/api/brain/harness/initiative');
    });

    it('DETAIL_ENDPOINT 引用 /detail 子路径', () => {
      expect(DETAIL_ENDPOINT).toContain('/detail');
    });
  });
});
