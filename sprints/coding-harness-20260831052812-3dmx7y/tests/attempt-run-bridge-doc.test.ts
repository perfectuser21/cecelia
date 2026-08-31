import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const docPath = 'docs/current/attempt-run-bridge.md';
const readDoc = () => readFileSync(docPath, 'utf8');

describe('attempt-run 桥接使用说明文档', () => {
  it('说明两个端点及鉴权方式', () => {
    const text = readDoc();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer');
    expect(text).toContain('CECELIA_INTERNAL_TOKEN');
  });

  it('完整列出九项角色白名单', () => {
    const text = readDoc();
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    for (const role of roles) expect(text).toContain(role);
  });

  it('说明 payload 必填字段与 base_sha 省略语义', () => {
    const text = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) expect(text).toContain(field);
    expect(text).toMatch(/base_sha[^\n]*(可省略|非必填)/);
    expect(text).toMatch(/生产 Brain[^\n]*(解析|解析基线)/);
  });

  it('说明派发失败自动回滚状态', () => {
    const text = readDoc();
    expect(text).toContain('run → failed');
    expect(text).toContain('session → closed');
    expect(text).toContain('task → cancelled');
  });
});
