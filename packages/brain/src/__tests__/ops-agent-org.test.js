import { describe, it, expect } from 'vitest';
import { inferAgentOrg, inferAgentRoleType } from '../ops-collector.js';

describe('inferAgentOrg — 组织归属（数字员工花名册的部门列）', () => {
  it('按命名前缀推租户/客户归属', () => {
    expect(inferAgentOrg('zenithjoy-shared-social-media')).toBe('悦升');
    expect(inferAgentOrg('jinoshengyuan-social-media')).toBe('金诺盛源');
    expect(inferAgentOrg('affine-jinnuo')).toBe('金诺盛源');
    expect(inferAgentOrg('affine-yuesheng')).toBe('悦升');
  });
  it('无前缀 = 内部平台（main/dev/infra 等自家 agent）', () => {
    for (const n of ['main', 'dev', 'infra', 'work-commander', 'verifier', 'curator', 'foundry']) {
      expect(inferAgentOrg(n)).toBe('内部平台');
    }
  });
  it('未知前缀不硬猜 → 内部平台兜底（禁编造租户）', () => {
    expect(inferAgentOrg('somebody-else')).toBe('内部平台');
  });
});

describe('inferAgentRoleType — 岗位类型（同一 skill 可装在不同岗位上）', () => {
  it('router=分派、commander=总调度、worker=执行', () => {
    expect(inferAgentRoleType('zenithjoy-router')).toBe('router');
    expect(inferAgentRoleType('work-commander')).toBe('commander');
    expect(inferAgentRoleType('zenithjoy-bridge-test-worker')).toBe('worker');
  });
  it('按职能名识别专职岗', () => {
    expect(inferAgentRoleType('verifier')).toBe('verifier');
    expect(inferAgentRoleType('curator')).toBe('curator');
  });
  it('业务号（social-media/office/research）= operator', () => {
    expect(inferAgentRoleType('jinoshengyuan-social-media')).toBe('operator');
    expect(inferAgentRoleType('zenithjoy-ai-office')).toBe('operator');
    expect(inferAgentRoleType('zenithjoy-shared-research')).toBe('operator');
  });
  it('认不出 → agent（不硬套岗位）', () => {
    expect(inferAgentRoleType('main')).toBe('agent');
    expect(inferAgentRoleType('随便什么')).toBe('agent');
  });
});
