import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DOC = 'docs/current/attempt-run-bridge-usage.md';
const BASE_SHA = '7404b42722835094b457b55f092cd76139ce131e';
const ROLES = [
  'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
  'evaluator', 'evaluator-evidence-repair', 'judge',
];

function documentText(): string {
  expect(existsSync(DOC), `${DOC} 必须存在`).toBe(true);
  return readFileSync(DOC, 'utf8');
}

function fencedItems(text: string, heading: string): string[] {
  const match = text.match(new RegExp(`^## ${heading}\\n+` + '```text\\n([\\s\\S]*?)\\n```', 'm'));
  expect(match, `${heading} 必须使用 text fenced block 声明封闭集合`).not.toBeNull();
  return match![1].split('\n').map((line) => line.trim()).filter(Boolean);
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('中文文档存在且四节齐全', () => {
    const text = documentText();
    const sections = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(sections).toEqual(['端点与鉴权', '角色白名单', 'payload 字段', '派发失败自动回滚']);
    expect(text).toMatch(/[\u4e00-\u9fff]/);
    expect('placeholder only').not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('两个端点用途与鉴权边界', () => {
    const text = documentText();
    for (const required of [
      'POST /api/brain/harness/attempt-run', '创建并派发一个角色 attempt-run',
      'GET /api/brain/harness/attempt-run/:id', '按 id 查询 attempt-run 状态',
      'internalAuthOrLoopback', '宿主/远端必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`',
      'loopback 请求可由中间件按本机规则放行',
    ]) expect(text).toContain(required);
    expect(text).not.toContain('宿主/远端可以免鉴权');
    expect(text).not.toMatch(/Bearer\s+(?!\$CECELIA_INTERNAL_TOKEN)[A-Za-z0-9_-]{16,}/);
  });

  it('九项角色是封闭集合且 payload 必填集合准确', () => {
    const text = documentText();
    expect(fencedItems(text, '角色白名单')).toEqual(ROLES);
    expect(new Set(fencedItems(text, '角色白名单')).size).toBe(9);
    expect(fencedItems(text, 'payload 必填字段')).toEqual(['sprint_dir', 'base_repo', 'branch']);
    expect(text).toContain('`base_sha` 可省略，由生产 Brain 自解析');
    expect(fencedItems(text.replace('branch\n```', 'branch\nbase_sha\n```'), 'payload 必填字段')).not.toEqual(['sprint_dir', 'base_repo', 'branch']);
  });

  it('派发失败三段回滚终态完整', () => {
    const text = documentText();
    const expected = ['run→failed', 'session→closed', 'task→cancelled'];
    expect(fencedItems(text, '回滚终态')).toEqual(expected);
    expect(fencedItems(text, '回滚终态').slice(0, 2)).not.toEqual(expected);
    expect([...fencedItems(text, '回滚终态'), 'attempt→completed']).not.toEqual(expected);
  });

  it('实现范围仅允许指定文档', () => {
    const changed = execFileSync('git', [
      'diff', '--name-only', `${BASE_SHA}...HEAD`, '--', '.', ':(exclude)sprints/**',
    ], { encoding: 'utf8' }).trim();
    expect(changed).toBe(DOC);
    expect(`${changed}\npackages/brain/src/forbidden.js`).not.toBe(DOC);
  });
});
