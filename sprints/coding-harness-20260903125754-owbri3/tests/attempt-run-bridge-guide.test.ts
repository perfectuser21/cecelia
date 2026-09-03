import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const BASE_SHA = 'b99c580d7fe8ca4cbf0ee834e13c91df02b57369';
const SPRINT_PREFIX = 'sprints/coding-harness-20260903125754-owbri3/';
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

function documentText() {
  return readFileSync(DOC, 'utf8');
}

function section(text: string, title: string) {
  const match = text.match(new RegExp(`^## ${title}\\s*$([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  if (!match) throw new Error(`缺少章节：${title}`);
  return match[1];
}

function assertEndpointAndAuth(text: string) {
  const endpointSection = section(text, '端点用途');
  expect(endpointSection).toContain('POST /api/brain/harness/attempt-run');
  expect(endpointSection).toContain('GET /api/brain/harness/attempt-run/:id');
  expect(endpointSection).toMatch(/POST[\s\S]*创建/);
  expect(endpointSection).toMatch(/GET[\s\S]*查询/);
  const auth = section(text, '鉴权');
  expect(auth).toContain('internalAuthOrLoopback');
  expect(auth).toContain('Bearer CECELIA_INTERNAL_TOKEN');
  expect(auth).toMatch(/回环/);
  expect(auth).toMatch(/宿主|远端/);
}

function assertRoleSet(text: string) {
  const roles = [...section(text, '角色白名单').matchAll(/^- `([^`]+)`\s*$/gm)].map((m) => m[1]);
  expect(roles).toEqual(EXPECTED_ROLES);
  expect(new Set(roles).size).toBe(9);
}

function assertPayload(text: string) {
  const payload = section(text, 'payload 字段');
  for (const field of ['sprint_dir', 'base_repo', 'branch']) {
    expect(payload).toMatch(new RegExp('`' + field + '`[^\\n]*必填'));
  }
  expect(payload).toMatch(/`base_sha`[^\n]*可省略/);
  expect(payload).toMatch(/生产 Brain[^\n]*自解析/);
  expect(payload).not.toMatch(/`base_sha`[^\n]*必填/);
}

function assertRollback(text: string) {
  const rollback = section(text, '派发失败自动回滚');
  expect(rollback).toContain('run→failed/session→closed/task→cancelled');
}

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('端点用途与鉴权正负 oracle', () => {
    const text = documentText();
    assertEndpointAndAuth(text);
    expect(() => assertEndpointAndAuth(text.replace('Bearer CECELIA_INTERNAL_TOKEN', '无需鉴权'))).toThrow();
  });

  it('角色白名单恰好九项封闭集合正负 oracle', () => {
    const text = documentText();
    assertRoleSet(text);
    expect(() => assertRoleSet(text.replace('- `judge`', '- `judge`\n- `publisher`'))).toThrow();
    expect(() => assertRoleSet(text.replace('- `reviewer`\n', ''))).toThrow();
  });

  it('payload 必填与 base_sha 可省略正负 oracle', () => {
    const text = documentText();
    assertPayload(text);
    expect(() => assertPayload(text.replace(/`base_sha`[^\n]*可省略[^\n]*/, '`base_sha`：必填'))).toThrow();
  });

  it('派发失败回滚链正负 oracle', () => {
    const text = documentText();
    assertRollback(text);
    expect(() => assertRollback(text.replace('task→cancelled', 'task→completed'))).toThrow();
  });

  it('范围仅新增一份 docs/current 中文文档正负 oracle', () => {
    const text = documentText();
    expect(text).toMatch(/[\u4e00-\u9fff]/);
    const changed = execFileSync('git', ['diff', '--name-only', `${BASE_SHA}...HEAD`], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).filter((path) => !path.startsWith(SPRINT_PREFIX));
    expect(changed).toEqual([DOC]);
    expect([...changed, 'packages/brain/src/server.js']).not.toEqual([DOC]);
  });
});
