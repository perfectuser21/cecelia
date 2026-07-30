/**
 * 验证：executor.js harness_initiative 分支在 compiled.invoke() 返回后
 * 调用 updateTaskStatus 回写任务状态。静态断言代码形状。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('executor.js harness_initiative 状态回写', () => {
  const SRC = fs.readFileSync(new URL('../executor.js', import.meta.url), 'utf8');

  // 提取完整 harness_initiative 分支；Kernel authority guard 让该块略长。
  const harnessStart = SRC.indexOf("task.task_type === 'harness_initiative'");
  const harnessBlock = harnessStart >= 0 ? SRC.slice(harnessStart, harnessStart + 3200) : '';

  it('harness_initiative 成功路径调用 updateTaskStatus completed', () => {
    expect(harnessBlock).toMatch(/updateTaskStatus\s*\(\s*task\.id\s*,\s*['"]completed['"]/);
  });

  it('harness_initiative final.error 路径调用 updateTaskStatus failed', () => {
    expect(harnessBlock).toMatch(/updateTaskStatus\s*\(\s*task\.id\s*,\s*['"]failed['"]/);
  });

  it('legacy harness catch 块仍调用 updateTaskStatus failed', () => {
    expect(harnessBlock).toMatch(
      /catch[\s\S]*?shouldUseGenericHarnessTaskWriteback[\s\S]*?updateTaskStatus[\s\S]*?failed/,
    );
  });

  it('harness_initiative 所有路径 return { success: true }（不再是 !final.error）', () => {
    expect(harnessBlock).not.toMatch(/success\s*:\s*!final\.error/);
    expect(harnessBlock).toMatch(/success\s*:\s*true/);
  });
});
