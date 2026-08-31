import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('说明两个端点用途与鉴权', () => {
    const guide = readGuide();
    expect(guide).toContain('POST /api/brain/harness/attempt-run');
    expect(guide).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(guide).toContain('internalAuthOrLoopback');
    expect(guide).toContain('Authorization: Bearer');
    expect(guide).toContain('CECELIA_INTERNAL_TOKEN');
  });

  it('列出九项角色白名单', () => {
    const guide = readGuide();
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    for (const role of roles) expect(guide).toContain(role);
  });

  it('说明 payload 必填字段与 base_sha 省略语义', () => {
    const guide = readGuide();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) expect(guide).toContain(field);
    expect(guide).toMatch(/base_sha[^\n]*(可省略|非必填)/);
    expect(guide).toMatch(/生产 Brain[^\n]*(解析|补全)/);
  });

  it('说明派发失败的三项自动回滚', () => {
    const guide = readGuide();
    expect(guide).toMatch(/run[^\n]*failed/);
    expect(guide).toMatch(/session[^\n]*closed/);
    expect(guide).toMatch(/task[^\n]*cancelled/);
  });
});
