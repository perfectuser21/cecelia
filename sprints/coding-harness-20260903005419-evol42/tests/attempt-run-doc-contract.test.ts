import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALLOWED_ROLES } from '../../../packages/brain/src/routes/harness-attempt-run.js';

// task_request_hash=1838c4d9069d5b08f980716d3d248df5f1cd7a8d03b585d3c89b8195798071dc
const DOC_PATH = 'docs/current/attempt-run-桥接使用说明.md';
const EXPECTED_ROLES = [
  'canary',
  'planner',
  'proposer',
  'reviewer',
  'generator',
  'generator-fix',
  'evaluator',
  'evaluator-evidence-repair',
  'judge',
];

function documentText(): string {
  return readFileSync(DOC_PATH, 'utf8');
}

function section(text: string, heading: string): string {
  const match = text.match(new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  expect(match, `缺少章节：${heading}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('attempt-run 桥接使用说明文档合同', () => {
  it('端点用途与鉴权说明完整', () => {
    const text = documentText();
    const endpoints = section(text, '端点用途');
    const auth = section(text, '鉴权');
    expect(endpoints).toContain('POST /api/brain/harness/attempt-run');
    expect(endpoints).toMatch(/创建.*派发.*attempt/);
    expect(endpoints).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(endpoints).toMatch(/按.*(?:id|标识).*查询/);
    expect(auth).toContain('internalAuthOrLoopback');
    expect(auth).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
    expect(auth).toMatch(/宿主|远端/);
    expect(auth).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{24,}(?!>)/);
  });

  it('角色白名单是恰好九项的封闭集合', () => {
    const roles = section(documentText(), '角色白名单');
    const listed = [...roles.matchAll(/^- `([^`]+)`\s*$/gm)].map((match) => match[1]);
    expect(listed).toHaveLength(9);
    expect(new Set(listed)).toEqual(new Set(EXPECTED_ROLES));
    expect(new Set(listed)).toEqual(new Set(ALLOWED_ROLES));
    expect(roles).toMatch(/白名单外.*拒绝/);
    expect(roles).not.toMatch(/^- `(commander|publisher)`\s*$/m);
    expect(roles).not.toMatch(/等(?:角色|项|权限)?/);
  });

  it('payload 必填与可省略字段无歧义', () => {
    const payload = section(documentText(), 'POST payload');
    const required = [...payload.matchAll(/^- `([^`]+)`：必填/g)].map((match) => match[1]);
    expect(required).toEqual(['sprint_dir', 'base_repo', 'branch']);
    expect(required).not.toContain('base_sha');
    expect(payload).toMatch(/`base_sha`：可省略/);
    expect(payload).toMatch(/省略时.*生产 Brain 自解析/);
  });

  it('派发失败完整回滚且不是半成功', () => {
    const rollback = section(documentText(), '派发失败自动回滚');
    expect(rollback).toContain('run → failed');
    expect(rollback).toContain('session → closed');
    expect(rollback).toContain('task → cancelled');
    expect(rollback).toMatch(/不是半成功/);
    expect(rollback).toMatch(/GET \/api\/brain\/harness\/attempt-run\/:id/);
  });
});
