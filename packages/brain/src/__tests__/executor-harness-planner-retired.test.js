/**
 * 验证：executor.js 不再有 harness_planner LangGraph 路由分支；
 * harness_planner task_type 被归入 _RETIRED_HARNESS_TYPES，标 terminal_failure。
 *
 * 使用源码静态断言（避免启动 executor 大模块的副作用）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

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
    const m = SRC.match(/_RETIRED_HARNESS_TYPES\s*=\s*new Set\(\[([\s\S]+?)\]/);
    expect(m, '_RETIRED_HARNESS_TYPES Set 存在').not.toBeNull();
    expect(m[1]).toMatch(/['"]harness_planner['"]/);
  });
});
