import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-usage.md';
const readDoc = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明合同', () => {
  it('文档包含两个端点及远端 Bearer 鉴权的正反边界', () => {
    const text = readDoc();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
    expect(text).toMatch(/宿主|远端/);
    expect(text).toMatch(/不可匿名|拒绝|不得匿名/);
  });

  it('角色白名单封闭且逐项等于九个生产角色', () => {
    const text = readDoc();
    const roles = [...text.matchAll(/^\s*- `([^`]+)`\s*$/gm)].map((m) => m[1]);
    expect(roles).toEqual(['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge']);
    expect(roles).not.toContain('commander');
    expect(roles).not.toContain('publisher');
  });

  it('最小 payload 只要求三个字段并明确 base_sha 省略语义', () => {
    const text = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) expect(text).toContain(`\`${field}\``);
    expect(text).toContain('`base_sha`');
    expect(text).toMatch(/base_sha.{0,40}可省略|`base_sha`.{0,40}可省略/s);
    expect(text).toMatch(/生产 Brain.{0,20}自解析/);
    expect(text).not.toMatch(/base_sha.{0,30}(固定|调用方猜测)/s);
  });

  it('派发失败回滚完整列出三个资源终态且不称为部分成功', () => {
    const text = readDoc();
    expect(text).toContain('run→failed');
    expect(text).toContain('session→closed');
    expect(text).toContain('task→cancelled');
    expect(text).not.toMatch(/部分成功/);
  });
});
