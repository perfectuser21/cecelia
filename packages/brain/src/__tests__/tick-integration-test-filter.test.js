import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

/**
 * tick.js — integration-test 任务调度过滤静态验证
 *
 * 防止集成测试残留任务（trigger_source = 'integration-test'）
 * 被生产调度器派发。
 *
 * 采用静态源码验证：直接检查 selectNextDispatchableTask 函数体
 * 包含正确的 SQL 过滤条件。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tickSource = readFileSync(path.resolve(__dirname, '../tick.js'), 'utf8');

// 提取 selectNextDispatchableTask 函数体（从函数声明到下一个 async function）
const funcStart = tickSource.indexOf('async function selectNextDispatchableTask(');
const funcEnd = tickSource.indexOf('\nasync function ', funcStart + 1);
const funcBody = tickSource.slice(funcStart, funcEnd > 0 ? funcEnd : funcStart + 5000);

describe('selectNextDispatchableTask — integration-test 任务过滤', () => {
  it('函数体内包含 integration-test 触发源过滤条件', () => {
    expect(funcBody).toContain("integration-test");
  });

  it("SQL 过滤：trigger_source != 'integration-test'", () => {
    expect(funcBody).toContain("trigger_source != 'integration-test'");
  });

  it('过滤条件包含 NULL 安全处理（IS NULL OR ...）', () => {
    // 防止 trigger_source 为 NULL 时意外过滤掉正常任务
    expect(funcBody).toContain('trigger_source IS NULL');
  });
});
