import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const UTILS_FILE = 'packages/brain/src/harness-utils.js';

// 刀4阶段3：harness-task.graph.js / harness-initiative.graph.js 已物理删除
// （LangGraph 图路径废弃，orchestrator 硬校验后不可达）。原本断言这两个死图
// 文件里 prdContent 传递的 3 个用例随之删除，buildGeneratorPrompt 本体（活代码，
// harness-utils.js）的 3 个用例保留。

describe('WS3 — buildGeneratorPrompt prdContent + runSubTaskNode 传递 [BEHAVIOR]', () => {
  it('harness-utils.js buildGeneratorPrompt 含 prdContent 参数', () => {
    const c = readFileSync(UTILS_FILE, 'utf8');
    expect(c).toContain('prdContent');
  });

  it('buildGeneratorPrompt 代码体含 Sprint PRD 段标识（条件注入逻辑）', () => {
    const c = readFileSync(UTILS_FILE, 'utf8');
    const hasPrdLabel = c.includes('Sprint PRD') || c.includes('sprint_prd');
    expect(hasPrdLabel).toBe(true);
  });

  it('buildGeneratorPrompt 含 prdContent 的空值保护（条件判断或默认值）', () => {
    const c = readFileSync(UTILS_FILE, 'utf8');
    const hasGuard =
      c.includes('prdContent ?') ||
      c.includes('prdContent &&') ||
      c.includes('if (prdContent') ||
      c.includes('if(prdContent') ||
      c.includes('prdContent = null') ||
      c.includes('prdContent = undefined');
    expect(hasGuard).toBe(true);
  });
});
