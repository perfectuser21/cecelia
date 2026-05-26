import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { buildGeneratorPrompt } from '../../../../packages/brain/src/harness-utils.js';

const SPRINT_PRD_PATH = 'sprints/dev-visibility-smoke/sprint-prd.md';
const TASK_ID = process.env.TASK_ID || 'smoke-test-task-id';

const TASK = {
  id: 'dev-visibility-smoke-test',
  title: 'Dev-Visibility 冒烟验证',
  description: '确认 generator 收到含完整 Sprint PRD 的 prompt',
  payload: {
    dod: ['[BEHAVIOR] generator prompt 包含 ## Sprint PRD 段'],
    files: ['packages/brain/src/harness-utils.js'],
    parent_task_id: 'smoke-initiative',
    logical_task_id: 'ws1',
  },
};

describe('Dev-Visibility 冒烟验证 — Generator PRD 注入 [BEHAVIOR]', () => {
  it('sprint-prd.md 存在且非空', () => {
    expect(existsSync(SPRINT_PRD_PATH)).toBe(true);
    const content = readFileSync(SPRINT_PRD_PATH, 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('buildGeneratorPrompt 注入 ## Sprint PRD 段（prdContent 非 null 时）', () => {
    const prdContent = readFileSync(SPRINT_PRD_PATH, 'utf8');
    const prompt = buildGeneratorPrompt(TASK, { prdContent });
    expect(prompt).toContain('## Sprint PRD');
  });

  it('PRD 内容完整注入（前 100 字符未截断）', () => {
    const prdContent = readFileSync(SPRINT_PRD_PATH, 'utf8');
    const prompt = buildGeneratorPrompt(TASK, { prdContent });
    expect(prompt).toContain(prdContent.slice(0, 100));
  });

  it('## Sprint PRD 出现在 ## DoD 之前（顺序正确）', () => {
    const prdContent = readFileSync(SPRINT_PRD_PATH, 'utf8');
    const prompt = buildGeneratorPrompt(TASK, { prdContent });
    const prdIdx = prompt.indexOf('## Sprint PRD');
    const dodIdx = prompt.indexOf('## DoD');
    expect(prdIdx).toBeGreaterThan(-1);
    expect(prdIdx).toBeLessThan(dodIdx);
  });

  it('smoke-verify.sh 存在（WS1 前置 — 边界情况验证触达能力）', () => {
    expect(existsSync('sprints/dev-visibility-smoke/smoke-verify.sh')).toBe(true);
  });

  it('prdContent=null 时 buildGeneratorPrompt 返回含错误标注的 prompt（不抛异常不返空）', () => {
    const prompt = buildGeneratorPrompt(TASK, { prdContent: null });
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
    const lower = prompt.toLowerCase();
    const hasAnnotation =
      lower.includes('error') ||
      prompt.includes('PRD 不存在') ||
      prompt.includes('无法读取');
    expect(hasAnnotation).toBe(true);
  });

  it('Brain tasks 表有本次 TASK_ID 记录且 status = completed 或 in_progress', async () => {
    let brainOnline = false;
    try {
      const healthResp = await fetch('http://localhost:5221/api/brain/health');
      brainOnline = healthResp.ok;
    } catch {
      brainOnline = false;
    }
    if (!brainOnline) {
      console.log('SKIP: Brain 未运行，跳过 tasks 表验证');
      return;
    }
    const resp = await fetch(`http://localhost:5221/api/brain/tasks/${TASK_ID}`);
    expect(resp.ok).toBe(true);
    const data = await resp.json() as { status: string };
    expect(['completed', 'in_progress']).toContain(data.status);
  });
});
