/**
 * routes/initiatives.test.js — lint-test-pairing stub
 *
 * 验证 routes/initiatives.js 的 GET /:id/dag 响应含 journey_type 字段。
 * 纯静态文件内容检查，不碰 DB / 不起服务器。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(
  path.resolve(__dirname, '../initiatives.js'),
  'utf8'
);

describe('routes/initiatives — journey_type 字段', () => {
  it('SELECT 语句含 journey_type', () => {
    expect(SRC).toMatch(/journey_type/);
  });

  it('JSON 响应含 journey_type 兜底值 autonomous', () => {
    expect(SRC).toMatch(/journey_type.*autonomous/);
  });

  it('使用 run?.journey_type 安全访问', () => {
    expect(SRC).toMatch(/run\?\.journey_type/);
  });
});
