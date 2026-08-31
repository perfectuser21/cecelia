import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const docPath = 'docs/current/attempt-run-bridge.md';
const readDoc = () => readFileSync(docPath, 'utf8');

describe('attempt-run 桥接使用说明', () => {
  it('说明 POST 与 GET 端点及鉴权方式', () => {
    const content = readDoc();
    expect(content).toContain('POST /api/brain/harness/attempt-run');
    expect(content).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(content).toContain('internalAuthOrLoopback');
    expect(content).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
  });

  it('列出九项角色白名单', () => {
    const content = readDoc();
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    for (const role of roles) expect(content).toContain(`\`${role}\``);
  });

  it('说明 payload 必填字段与 base_sha 省略规则', () => {
    const content = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch', 'base_sha']) expect(content).toContain(`\`${field}\``);
    expect(content).toMatch(/base_sha[^。\n]*(可省略|无需提供)/);
    expect(content).toMatch(/生产 Brain[^。\n]*解析/);
  });

  it('说明派发失败的三项自动回滚', () => {
    const content = readDoc();
    expect(content).toContain('run → failed');
    expect(content).toContain('session → closed');
    expect(content).toContain('task → cancelled');
  });
});
