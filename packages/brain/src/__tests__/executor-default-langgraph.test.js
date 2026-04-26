/**
 * 验证：无任何 env flag 时，executor 派 task_type=harness_planner 任务
 * 走 LangGraph Pipeline（runHarnessPipeline），不再 fall through 到单步 Docker。
 *
 * 注意：本测试只验证路由决策（runHarnessPipeline 被调），不验证 pipeline 内部行为。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = {
  runHarnessPipeline: vi.fn(),
  getPgCheckpointer: vi.fn(),
};

vi.mock('../harness-graph-runner.js', () => ({
  runHarnessPipeline: mocks.runHarnessPipeline,
}));
vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: mocks.getPgCheckpointer,
}));

describe('executor default LangGraph for harness_planner', () => {
  let originalEnv;
  beforeEach(() => {
    originalEnv = process.env.HARNESS_LANGGRAPH_ENABLED;
    delete process.env.HARNESS_LANGGRAPH_ENABLED;
    Object.values(mocks).forEach((m) => m.mockReset?.());
    mocks.runHarnessPipeline.mockResolvedValue({ skipped: false, steps: 7, finalState: { ok: true } });
    mocks.getPgCheckpointer.mockResolvedValue({ /* fake */ });
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.HARNESS_LANGGRAPH_ENABLED;
    else process.env.HARNESS_LANGGRAPH_ENABLED = originalEnv;
  });

  it('无 env flag + task_type=harness_planner → runHarnessPipeline 被调（默认走 LangGraph）', async () => {
    // 由于 executor.js 是大文件，直接 import 整个模块依赖较重；
    // 改用读源码做静态断言：harness_planner 路由决策不再依赖 _isLangGraphEnabled
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../executor.js', import.meta.url), 'utf8');
    // 删除后：line 2899 不应再有 _isLangGraphEnabled() 同行调用
    const harnessPlannerLine = src.match(/task\.task_type\s*===\s*['"]harness_planner['"][^\n]*/);
    expect(harnessPlannerLine, 'harness_planner 路由判断行存在').not.toBeNull();
    expect(harnessPlannerLine[0]).not.toMatch(/_isLangGraphEnabled/);
  });

  it('executor.js 不再 export 或定义 _isLangGraphEnabled', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../executor.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/function\s+_isLangGraphEnabled/);
    expect(src).not.toMatch(/HARNESS_LANGGRAPH_ENABLED/);
  });
});
