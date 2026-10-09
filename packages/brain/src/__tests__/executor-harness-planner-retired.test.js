/**
 * 验证：executor.js 不再有 harness_planner LangGraph 路由分支；
 * harness_planner task_type 被归入 _RETIRED_HARNESS_TYPES，标 terminal_failure。
 *
 * 使用源码静态断言（避免启动 executor 大模块的副作用）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { RETIRED_HARNESS_TYPES_DISPATCH } from '../lib/task-type-registry.js';

describe('executor.js harness_planner retired', () => {
  const SRC = fs.readFileSync(new URL('../executor.js', import.meta.url), 'utf8');

  it('不再含 harness_planner 路由到 LangGraph Pipeline 的分支', () => {
    // 旧代码：if (task.task_type === 'harness_planner') { ... runHarnessPipeline ... }
    expect(SRC).not.toMatch(/task\.task_type\s*===\s*['"]harness_planner['"][^\n]*\{[\s\S]{0,200}runHarnessPipeline/);
  });

  it('不再 import runHarnessPipeline / harness-graph-runner', () => {
    expect(SRC).not.toMatch(/runHarnessPipeline/);
    expect(SRC).not.toMatch(/harness-graph-runner/);
  });

  it('_RETIRED_HARNESS_TYPES 包含 harness_planner', () => {
    // Task 3（qiumi-task-router PR1）之后 _RETIRED_HARNESS_TYPES 改从
    // lib/task-type-registry.js 的 RETIRED_HARNESS_TYPES_DISPATCH 派生集合构造，
    // executor.js 里不再手抄字面量数组，断言改为对真实运行值 + 接线来源双重校验。
    expect(RETIRED_HARNESS_TYPES_DISPATCH, 'RETIRED_HARNESS_TYPES_DISPATCH 包含 harness_planner').toContain('harness_planner');
    expect(SRC, 'executor.js 没有接线到注册表的 RETIRED_HARNESS_TYPES_DISPATCH').toMatch(
      /_RETIRED_HARNESS_TYPES\s*=\s*new Set\(RETIRED_HARNESS_TYPES_DISPATCH\)/,
    );
  });
});
