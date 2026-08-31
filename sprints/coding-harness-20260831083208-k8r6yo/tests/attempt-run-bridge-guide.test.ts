import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明合同', () => {
  it('两个端点用途与鉴权说明完整', () => {
    const text = readGuide();
    for (const value of [
      'POST /api/brain/harness/attempt-run',
      'GET /api/brain/harness/attempt-run/:id',
      'internalAuthOrLoopback',
      'Authorization: Bearer $CECELIA_INTERNAL_TOKEN',
      '宿主',
      '远端',
    ]) expect(text).toContain(value);
  });

  it('九项角色白名单完整且没有越权角色', () => {
    const text = readGuide();
    const roles = [
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ];
    for (const role of roles) expect(text).toContain(role);
    expect(text).not.toMatch(/允许角色[^#]*(commander|publisher)/s);
  });

  it('payload 必填字段与 base_sha 省略语义完整', () => {
    const text = readGuide();
    for (const field of ['payload.sprint_dir', 'payload.base_repo', 'payload.branch']) {
      expect(text).toContain(field);
    }
    expect(text).toContain('payload.base_sha');
    expect(text).toMatch(/base_sha[\s\S]{0,80}可省略[\s\S]{0,80}生产 Brain/);
  });

  it('派发失败自动回滚映射完整', () => {
    const text = readGuide();
    expect(text).toMatch(/run[^\n]*failed/);
    expect(text).toMatch(/session[^\n]*closed/);
    expect(text).toMatch(/task[^\n]*cancelled/);
  });
});
