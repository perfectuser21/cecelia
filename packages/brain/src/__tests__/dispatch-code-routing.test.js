import { describe, it, expect } from 'vitest';
import { classifyCodeChange, deriveGearForTask, buildHarnessRoutingPayload } from '../dispatch-code-routing.js';

describe('classifyCodeChange', () => {
  it('task_type≠dev → 不路由', () => {
    const task = { task_type: 'research', title: '调研一下X', payload: {} };
    const result = classifyCodeChange(task);
    expect(result.isCodeChange).toBe(false);
    expect(result.reason).toBe('not_dev_type');
  });

  it('纯文档标题 → 不路由', () => {
    const task = { task_type: 'dev', title: 'docs: 更新 README', payload: {} };
    const result = classifyCodeChange(task);
    expect(result.isCodeChange).toBe(false);
    expect(result.reason).toBe('doc_or_config_only');
  });

  it('纯配置标题 → 不路由', () => {
    const task = { task_type: 'dev', title: 'chore(config): 调整超时阈值', payload: {} };
    const result = classifyCodeChange(task);
    expect(result.isCodeChange).toBe(false);
    expect(result.reason).toBe('doc_or_config_only');
  });

  it('非默认仓库（v1范围限制）→ 不路由', () => {
    const task = { task_type: 'dev', title: '修一下发布器的bug', payload: { repo: 'zenithjoy' } };
    const result = classifyCodeChange(task);
    expect(result.isCodeChange).toBe(false);
    expect(result.reason).toBe('non_default_repo_v1_scope_limit');
  });

  it('repo 缺省视为 cecelia → 正常路由', () => {
    const task = { task_type: 'dev', title: '加个新接口', description: '', payload: {} };
    const result = classifyCodeChange(task);
    expect(result.isCodeChange).toBe(true);
    expect(result.reason).toBe('code_change');
  });

  it('repo=cecelia 显式给出 → 正常路由', () => {
    const task = { task_type: 'dev', title: '加个新接口', description: '', payload: { repo: 'cecelia' } };
    const result = classifyCodeChange(task);
    expect(result.isCodeChange).toBe(true);
    expect(result.reason).toBe('code_change');
  });
});

describe('deriveGearForTask', () => {
  it('标题含"修复bug" → hotfix', () => {
    const task = { title: '修复bug：派发死锁', description: '' };
    expect(deriveGearForTask(task)).toBe('hotfix');
  });

  it('标题含 fix( → hotfix', () => {
    const task = { title: 'fix(brain): 修一个空指针', description: '' };
    expect(deriveGearForTask(task)).toBe('hotfix');
  });

  it('标题含"新增能力/立项" → segmented', () => {
    const task = { title: '新增能力：多平台一键发布', description: '这是一次立项，贯穿全流程' };
    expect(deriveGearForTask(task)).toBe('segmented');
  });

  it('描述含"架构重构" → segmented', () => {
    const task = { title: '优化派发逻辑', description: '这是一次架构重构' };
    expect(deriveGearForTask(task)).toBe('segmented');
  });

  it('普通描述（无关键词）→ default', () => {
    const task = { title: '加个新接口', description: '给用户列表加分页参数' };
    expect(deriveGearForTask(task)).toBe('default');
  });

  it('bugfix 与 large 关键词同时命中 → hotfix 优先', () => {
    const task = { title: '修复bug', description: '涉及架构重构' };
    expect(deriveGearForTask(task)).toBe('hotfix');
  });
});

describe('buildHarnessRoutingPayload', () => {
  it('产出 orchestrator/code_change/gear/origin_task_type/thin_prd 五个字段', () => {
    const task = {
      task_type: 'dev',
      title: '加个新接口',
      description: '给用户列表加分页参数',
      payload: { context: '补充上下文：只加 GET /users 的分页' },
    };
    const patch = buildHarnessRoutingPayload(task, 'default');
    expect(patch.orchestrator).toBe('skill-relay');
    expect(patch.code_change).toBe(true);
    expect(patch.gear).toBe('default');
    expect(patch.origin_task_type).toBe('dev');
    expect(patch.thin_prd).toContain('加个新接口');
    expect(patch.thin_prd).toContain('给用户列表加分页参数');
    expect(patch.thin_prd).toContain('补充上下文：只加 GET /users 的分页');
  });

  it('description/context 缺省时 thin_prd 至少含 title，不抛错', () => {
    const task = { task_type: 'dev', title: '加个新接口', payload: {} };
    const patch = buildHarnessRoutingPayload(task, 'default');
    expect(patch.thin_prd).toContain('加个新接口');
  });
});
