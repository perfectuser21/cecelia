/**
 * DoD tests: Learning 入库强制绑定 action_task_id（cortex 路径）
 *
 * 背景（migration 271）：过去 8 天 5 条 relevance_score=9 的 cortex_insight learning 全部命中
 * "Viability Gate 缺失" 主题但零条转化为代码 → 106 次可预防失败。
 * 根因：maybeCreateInsightTask 在 insight 不含 CODE_FIX_SIGNALS（bug/fix/修复...）时
 * 直接 return，导致抽象类 insight 被静默放过。
 *
 * 本测试在源码层断言：
 *   1. cortex_insight 不再被 hasCodeFixSignal gate 静默跳过
 *   2. maybeCreateInsightTask 返回 task id（供 recordLearnings 写回 action_task_id）
 *   3. createTask 抛错时 learning 仍写入，并发 learning_unbound 告警事件
 *   4. 同 insight_learning_id 的旧 task 仍被识别，复用其 id（去重不破坏）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORTEX_SRC = readFileSync(
  resolve(__dirname, '../src/cortex.js'),
  'utf8'
);

describe('cortex.js: recordLearnings → 强制绑定 action_task_id', () => {
  it('cortex_insight 不再被 hasCodeFixSignal gate 静默跳过（loophole 关闭）', () => {
    // 修复前：maybeCreateInsightTask 函数体首句 `if (!hasCodeFixSignal(content)) return;`
    // 修复后：该 early-return 整体移除（hasCodeFixSignal 只影响优先级）
    const fnMatch = CORTEX_SRC.match(/async function maybeCreateInsightTask[^]*?^\}/m);
    expect(fnMatch, 'maybeCreateInsightTask 函数应存在').toBeTruthy();
    const body = fnMatch[0];
    expect(
      body,
      'maybeCreateInsightTask 不应再以 `if (!hasCodeFixSignal(...)) return` 静默放过 cortex_insight'
    ).not.toMatch(/if\s*\(\s*!hasCodeFixSignal\([^)]+\)\s*\)\s*\{?\s*return\s*;\s*\}?\s*\/\/\s*无代码修复信号/);
  });

  it('maybeCreateInsightTask 返回 task.id（供调用方写回 learning.action_task_id）', () => {
    // 函数体内必须 `return taskId` 或类似返回值，且 dedup 命中分支也要返回 dedup.rows[0].id
    const fnMatch = CORTEX_SRC.match(/async function maybeCreateInsightTask[^]*?^\}/m);
    const body = fnMatch[0];
    expect(body, 'createTask 成功后应 return taskId').toMatch(/return\s+taskId/);
    expect(body, 'dedup 命中时应 return dedup.rows[0].id（不再 return undefined）').toMatch(
      /return\s+dedup\.rows\[0\]\.id/
    );
  });

  it('recordLearnings 把 maybeCreateInsightTask 返回值写回 learning（bindActionTaskOrFlagUnbound）', () => {
    const fnMatch = CORTEX_SRC.match(/async function recordLearnings[^]*?\nasync function/);
    expect(fnMatch, 'recordLearnings 应存在').toBeTruthy();
    const body = fnMatch[0];
    expect(body, 'recordLearnings 应调用 maybeCreateInsightTask').toMatch(/maybeCreateInsightTask\s*\(/);
    expect(body, 'recordLearnings 应调用 bindActionTaskOrFlagUnbound 写回 action_task_id').toMatch(
      /bindActionTaskOrFlagUnbound\s*\(/
    );
  });

  it('createTask 抛错时（actionTaskId=null），写 cecelia_events learning_unbound 告警事件', () => {
    expect(CORTEX_SRC, '应有 bindActionTaskOrFlagUnbound 兜底函数').toMatch(
      /async function bindActionTaskOrFlagUnbound/
    );
    const fnMatch = CORTEX_SRC.match(/async function bindActionTaskOrFlagUnbound[^]*?^\}/m);
    const body = fnMatch[0];
    expect(body, '无 actionTaskId 时应写 learning_unbound 事件').toMatch(/learning_unbound/);
    expect(body, '事件 payload 应含 learning_id').toMatch(/learning_id/);
    expect(body, '有 actionTaskId 时应 UPDATE learnings.action_task_id').toMatch(
      /UPDATE\s+learnings\s+SET\s+action_task_id/i
    );
  });

  it('hasCodeFixSignal 函数和 CODE_FIX_SIGNALS 常量被保留（priority 决策仍依赖）', () => {
    // [PRESERVE]：原有路径不破坏。函数和常量仍存在；只是不再作为静默 gate。
    expect(CORTEX_SRC).toMatch(/const\s+CODE_FIX_SIGNALS\s*=/);
    expect(CORTEX_SRC).toMatch(/function\s+hasCodeFixSignal/);
    // 现在 hasCodeFixSignal 只影响 priority（P1 vs P2），保证 [PRESERVE] 行为
    expect(CORTEX_SRC).toMatch(/hasCodeFixSignal\([^)]+\)\s*\?\s*['"]P1['"]\s*:\s*['"]P2['"]/);
  });

  it('反向链路 tasks.payload->>insight_learning_id 仍写入（巡检 SQL 不破坏）', () => {
    // [PRESERVE]：dedup 仍按 insight_learning_id 查；createTask payload 仍含 insight_learning_id
    expect(CORTEX_SRC).toMatch(/payload->>'insight_learning_id'/);
    expect(CORTEX_SRC).toMatch(/insight_learning_id:\s*learningId/);
  });
});
