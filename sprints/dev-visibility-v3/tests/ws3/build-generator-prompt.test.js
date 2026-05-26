import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const UTILS_FILE = 'packages/brain/src/harness-utils.js';
const INIT_GRAPH  = 'packages/brain/src/workflows/harness-initiative.graph.js';
const TASK_GRAPH  = 'packages/brain/src/workflows/harness-task.graph.js';

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

  it('harness-task.graph.js TaskState 含 prdContent Annotation', () => {
    const c = readFileSync(TASK_GRAPH, 'utf8');
    expect(c).toContain('prdContent');
  });

  it('harness-task.graph.js buildGeneratorPrompt 调用点传 prdContent', () => {
    const c = readFileSync(TASK_GRAPH, 'utf8');
    const callIdx = c.indexOf('buildGeneratorPrompt(');
    expect(callIdx).toBeGreaterThan(-1);
    const callCtx = c.slice(callIdx, callIdx + 200);
    expect(callCtx).toContain('prdContent');
  });

  it('harness-initiative.graph.js runSubTaskNode 函数体含 prdContent 传递', () => {
    const c = readFileSync(INIT_GRAPH, 'utf8');
    const fnIdx = c.indexOf('export async function runSubTaskNode');
    expect(fnIdx).toBeGreaterThan(-1);
    const body = c.slice(fnIdx, fnIdx + 3000);
    expect(body).toContain('prdContent');
  });
});
