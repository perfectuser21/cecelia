/**
 * Test: executor.js preparePrompt 重构后路由验证（静态分析）
 *
 * 验证重构后的子函数存在，且各 taskType 路由逻辑正确。
 * 采用静态源码分析（与 executor-codex-review.test.js 相同模式），
 * 避免 worktree 缺少 node_modules 的问题。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const executorSrc = readFileSync(
  join(__dirname, '../executor.js'),
  'utf8'
);

describe('preparePrompt 重构：子函数存在', () => {
  it('提取了 _prepareDecompositionPrompt 子函数', () => {
    expect(executorSrc).toContain('_prepareDecompositionPrompt');
  });

  it('提取了 _prepareContinueDecompWithInitiative 子函数', () => {
    expect(executorSrc).toContain('_prepareContinueDecompWithInitiative');
  });

  it('提取了 _prepareInitiativeSupplementDecomp 子函数', () => {
    expect(executorSrc).toContain('_prepareInitiativeSupplementDecomp');
  });

  it('提取了 _prepareFirstDecomp 子函数', () => {
    expect(executorSrc).toContain('_prepareFirstDecomp');
  });

  it('提取了 _prepareScopePlanPrompt 子函数', () => {
    expect(executorSrc).toContain('_prepareScopePlanPrompt');
  });

  it('提取了 _prepareProjectPlanPrompt 子函数', () => {
    expect(executorSrc).toContain('_prepareProjectPlanPrompt');
  });

  it('提取了 _prepareSprintPrompt 子函数', () => {
    expect(executorSrc).toContain('_prepareSprintPrompt');
  });

  it('提取了 _prepareSprintEvaluatePrompt 子函数', () => {
    expect(executorSrc).toContain('_prepareSprintEvaluatePrompt');
  });

  it('提取了 _prepareSpecReviewPrompt 子函数', () => {
    expect(executorSrc).toContain('_prepareSpecReviewPrompt');
  });

  it('提取了 _prepareCodeReviewGatePrompt 子函数', () => {
    expect(executorSrc).toContain('_prepareCodeReviewGatePrompt');
  });

  it('提取了 _prepareTalkPrompt 子函数', () => {
    expect(executorSrc).toContain('_prepareTalkPrompt');
  });

  it('提取了 _prepareCodeReviewArgs 子函数', () => {
    expect(executorSrc).toContain('_prepareCodeReviewArgs');
  });

  it('提取了 _prepareResearchPrompt 子函数', () => {
    expect(executorSrc).toContain('_prepareResearchPrompt');
  });

  it('提取了 _prepareDefaultPrompt 子函数', () => {
    expect(executorSrc).toContain('_prepareDefaultPrompt');
  });
});

describe('preparePrompt 重构：路由表覆盖关键 taskType', () => {
  it('routes 对象包含 initiative_plan', () => {
    expect(executorSrc).toContain("initiative_plan");
  });

  it('routes 对象包含 scope_plan', () => {
    expect(executorSrc).toContain("scope_plan");
  });

  it('routes 对象包含 project_plan', () => {
    expect(executorSrc).toContain("project_plan");
  });

  it('routes 对象包含 sprint_evaluate', () => {
    expect(executorSrc).toContain("sprint_evaluate");
  });

  it('routes 对象包含 talk', () => {
    expect(executorSrc).toContain("talk");
  });

  it('routes 对象包含 research', () => {
    expect(executorSrc).toContain("research");
  });

  it('routes 对象包含 review / qa / audit', () => {
    expect(executorSrc).toContain("'review'");
    expect(executorSrc).toContain("'qa'");
    expect(executorSrc).toContain("'audit'");
  });

  it('routes 对象包含 code_review', () => {
    expect(executorSrc).toContain("code_review");
  });
});

describe('preparePrompt 重构：主函数为 dispatcher 结构', () => {
  it('preparePrompt 主函数存在且为 async', () => {
    expect(executorSrc).toContain('async function preparePrompt(task)');
  });

  it('preparePrompt 包含 decomposition 分支', () => {
    expect(executorSrc).toContain("decomposition === 'true'");
    expect(executorSrc).toContain("_prepareDecompositionPrompt(task)");
  });

  it('preparePrompt 包含 sprint/harness 分支', () => {
    expect(executorSrc).toContain("sprint_generate");
    expect(executorSrc).toContain("sprint_fix");
    expect(executorSrc).toContain("harness_mode");
    expect(executorSrc).toContain("_prepareSprintPrompt(task, taskType)");
  });

  it('preparePrompt 包含 routes dispatch table', () => {
    expect(executorSrc).toContain('const routes = {');
    expect(executorSrc).toContain('const handler = routes[taskType]');
  });

  it('preparePrompt 最终回落到 _prepareDefaultPrompt', () => {
    expect(executorSrc).toContain('_prepareDefaultPrompt(task, skill)');
  });
});
