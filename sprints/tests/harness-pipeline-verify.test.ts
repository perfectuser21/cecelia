/**
 * TDD Red — harness 内部线 pipeline 贯通验证前置断言
 *
 * 以下测试在 Generator 添加触点注释之前必然 FAIL（红）：
 *   - 触点测试：apps/dashboard/index.html 缺少 harness-pipeline-verify 注释 → FAIL
 *   - 注释位置测试：注释必须在 <head> 区块内（防误加到 body）→ FAIL
 *
 * Generator 添加触点后，两条测试均变绿。
 * DB 接缝断言（staging_e2e_results / promote_status / :5211）由 E2E 脚本在 pipeline 完成后验证。
 *
 * Round 3 变更：移除了 staging-promote resolveLine/decidePromote 和 checkInitiativeAggregate 测试——
 * 这些函数已在 Slice1-9 中实现完毕，测试立即为绿，不提供 TDD 红证据；pipeline 接缝由 E2E 脚本验证。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── 触点注释测试（Generator 添加后方为绿）──────────────────────────────────
describe('apps/dashboard/index.html 触点注释 [BEHAVIOR]', () => {
  it('包含 harness-pipeline-verify 2026-06-27 注释行', () => {
    const indexPath = resolve(process.cwd(), 'apps/dashboard/index.html');
    const content = readFileSync(indexPath, 'utf8');
    expect(content).toContain('harness-pipeline-verify 2026-06-27');
  });

  it('触点注释在 <head> 区块内（不在 <body>）', () => {
    const indexPath = resolve(process.cwd(), 'apps/dashboard/index.html');
    const content = readFileSync(indexPath, 'utf8');
    const headEnd = content.indexOf('</head>');
    const commentPos = content.indexOf('harness-pipeline-verify 2026-06-27');
    expect(commentPos).toBeGreaterThan(-1);
    expect(commentPos).toBeLessThan(headEnd);
  });
});
