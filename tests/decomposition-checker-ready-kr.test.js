/**
 * decomposition-checker: Check A 不应处理 ready 状态 KR
 *
 * 背景（Test KR for decomp 验证报告）：
 *   Check A 的 SQL 曾包含 status IN ('pending', 'ready')，
 *   导致 ready KR 在 24h dedup 窗口过期后被错误地重新触发拆解，
 *   将已审核通过的 KR 强制退回 decomposing 状态。
 *
 * 修复：Check A 只查询 status = 'pending' 的 KR。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const checkerSrc = readFileSync(
  join(__dirname, '../packages/brain/src/decomposition-checker.js'),
  'utf8'
);

describe('decomp-checker Check A: 不处理 ready 状态 KR', () => {
  it('Check A SQL 不包含 ready 状态过滤', () => {
    // Check A (checkPendingKRs) 的 SQL 不应再包含 'ready'
    // 确保 ready KR 不会被重新触发拆解
    expect(checkerSrc).not.toContain("status IN ('pending', 'ready')");
  });

  it('Check A SQL 只查询 pending 状态', () => {
    // 确认新的查询使用 status = 'pending'
    expect(checkerSrc).toContain("WHERE g.status = 'pending'");
  });

  it('Check A 注释说明不含 ready（与代码一致）', () => {
    // 注释中应明确说明不含 ready
    expect(checkerSrc).toContain('不包含 ready');
  });
});
