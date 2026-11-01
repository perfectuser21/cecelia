// 旧内联正则已被完整组件计划替代；直接调用实际选择器，未知源码保守验证。
import { describe, it, expect } from 'vitest';
import { planChecks } from '../../../../scripts/ci/basic-scope.mjs';
import brainConfig from '../../vitest.config.js';
const detectsBrain = files => planChecks(files).some(row => row.component === 'brain-unit');
describe('CI Brain 组件选择', () => {
  it('真实 Brain 源码与跨包 Engine/API 变更均运行 Brain 测试', () => {
    for (const file of ['packages/brain/src/routes/harness.js', 'packages/engine/src/index.ts', 'apps/api/src/server.ts'])
      expect(detectsBrain([file])).toBe(true);
  });
  it('未知 Sprint 可执行文件不能当文档忽略，但不恢复旧 sprint 测试收集', () => {
    expect(detectsBrain(['sprints/x/tests/y.spec.ts'])).toBe(true);
    expect(brainConfig.test.include.some(pattern => pattern.includes('sprints/'))).toBe(false);
  });
  it('纯 Sprint PRD/合同只运行基础 CI 回归；未知 JSON 保守验证', () => {
    for (const file of ['sprints/x/prep-prd.md', 'sprints/x/contract-dod.md'])
      expect(planChecks([file])).toEqual([{component: 'scripts'}]);
    expect(detectsBrain(['sprints/x/task-plan.json'])).toBe(true);
  });
  it('独立 Dashboard 改动不运行 Brain，仍保留对应测试与基础回归', () => {
    expect(planChecks(['apps/dashboard/src/App.tsx', 'docs/x.md']))
      .toEqual([{component: 'dashboard'}, {component: 'scripts'}]);
  });
  it('共享工作流、脚本或未知可执行路径不得漏掉 Brain', () => {
    for (const file of ['.github/workflows/ci.yml', 'scripts/smoke/new.sh', 'unknown/service.js'])
      expect(planChecks([file]).filter(row => row.component === 'brain-unit')).toHaveLength(6);
  });
});
