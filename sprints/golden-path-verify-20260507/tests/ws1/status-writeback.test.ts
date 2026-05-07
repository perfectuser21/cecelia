/**
 * Workstream 1 — harness_initiative status 终态回写 [BEHAVIOR]
 *
 * 验证 PR #2816 在 executor.js 的 **外层 caller**（即 if (task.task_type === 'harness_initiative') 块）
 * 中明确调用了 updateTaskStatus(task.id, 'completed' | 'failed')，且所有 return 路径返回
 * { success: true } 防止 dispatcher 把已处理任务回退 'queued' 形成回路。
 *
 * 设计：用 readFileSync 静态读源码，对外层 caller 块切窗口断言代码形状。
 * 这套模式与 PR #2816 自带的 executor-harness-initiative-status-writeback.test.js 一致，
 * 但本测试**不依赖 PR 自带文件存在**，独立守护合同语义。
 *
 * 预期 Red（当前分支 base 未含 PR #2816 fix）：
 *   - 外层 caller 块中找不到 `updateTaskStatus(task.id, 'completed')` → toMatch FAIL
 *   - 外层 caller 块中找不到 `updateTaskStatus(task.id, 'failed')`    → toMatch FAIL
 *   - return 仍写 `success: result.ok` 而非 `success: true`             → toMatch FAIL
 *
 * 预期 Green（rebase 至 main 含 PR #2816 后）：四项断言全 PASS。
 *
 * 目标 task_id（PRD 钉的金路径样本，运行时端到端观察用）：
 *   84075973-99a4-4a0d-9a29-4f0cd8b642f5
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_INITIATIVE_TASK_ID = '84075973-99a4-4a0d-9a29-4f0cd8b642f5';

describe('WS1 — harness_initiative status 终态回写 [BEHAVIOR]', () => {
  const EXECUTOR_PATH = path.resolve(
    __dirname,
    '../../../../packages/brain/src/executor.js',
  );
  const SRC = fs.readFileSync(EXECUTOR_PATH, 'utf8');

  // 切外层 caller 窗口：从 "if (task.task_type === 'harness_initiative')" 起 2500 字符。
  // 该窗口完整覆盖 try-catch 全块（PR #2816 fix 所在区域）。
  const OUTER_START = SRC.indexOf("task.task_type === 'harness_initiative'");
  const OUTER_BLOCK = OUTER_START >= 0 ? SRC.slice(OUTER_START, OUTER_START + 2500) : '';

  it('外层 caller 存在（基础结构存在）', () => {
    expect(OUTER_START).toBeGreaterThan(0);
    expect(OUTER_BLOCK).toContain('harness_initiative');
  });

  it('成功路径：外层 caller try 块调用 updateTaskStatus(task.id, "completed")', () => {
    expect(OUTER_BLOCK).toMatch(
      /updateTaskStatus\s*\(\s*task\.id\s*,\s*['"]completed['"]/,
    );
  });

  it('FAIL 路径：外层 caller try 块调用 updateTaskStatus(task.id, "failed", ...)', () => {
    // final.error / result.error 非空 → 写 failed
    expect(OUTER_BLOCK).toMatch(
      /updateTaskStatus\s*\(\s*task\.id\s*,\s*['"]failed['"]/,
    );
  });

  it('异常路径：外层 caller catch 块也调用 updateTaskStatus(task.id, "failed")', () => {
    // catch 块在 harness_initiative try-catch 内，含 updateTaskStatus failed
    // 用更严格的 multiline 模式匹配 "} catch ... updateTaskStatus(task.id, 'failed'"
    expect(OUTER_BLOCK).toMatch(
      /catch\s*\([\s\S]*?\)\s*\{[\s\S]*?updateTaskStatus\s*\(\s*task\.id\s*,\s*['"]failed['"]/,
    );
  });

  it('防回路：外层 caller 所有 return 路径写 success: true（不再是 success: result.ok / !final.error）', () => {
    // 不应存在 success: result.ok 或 success: !final.error 这种写法（dispatcher 会回退 queued）
    expect(OUTER_BLOCK).not.toMatch(/success\s*:\s*result\.ok/);
    expect(OUTER_BLOCK).not.toMatch(/success\s*:\s*!\s*final\.error/);
    // 应至少存在一处 success: true（成功 return + catch return 共两处）
    const hits = OUTER_BLOCK.match(/success\s*:\s*true/g) || [];
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('PRD 目标 task_id 字面引用：本测试文件锚定 84075973-99a4-4a0d-9a29-4f0cd8b642f5（防漂移）', () => {
    // 守护本测试文件的 PRD 锚定字符串不被偷偷改动 — 整个 Sprint 围绕这一个 task_id。
    const SELF = fs.readFileSync(__filename, 'utf8');
    expect(SELF).toContain(TARGET_INITIATIVE_TASK_ID);
  });
});
