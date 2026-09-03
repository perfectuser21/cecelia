import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const DOC = 'docs/current/attempt-run-bridge.md';
const BASE_SHA = '6a9030e27b6f1c7c9ab328c9c90ba08cbb74eebb';
const TASK_REQUEST_HASH = 'aecb99079a0f3f82a833c6ff55d42e5903af6050d73033b574511db5dfd00e4f';
const EXPECTED_ROLES = [
  'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
  'evaluator', 'evaluator-evidence-repair', 'judge',
];

function readDoc() {
  return fs.readFileSync(DOC, 'utf8');
}

function section(text: string, name: string) {
  return text.match(new RegExp(`^## ${name}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))?.[1] ?? '';
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('包含四个独立章节', () => {
    const text = readDoc();
    expect(text).toContain(TASK_REQUEST_HASH);
    for (const name of ['端点与鉴权', '角色白名单', 'payload 字段', '派发失败自动回滚']) {
      expect(section(text, name), `缺章节 ${name}`).not.toBe('');
    }
    expect(text).toMatch(/[\u4e00-\u9fff]/);
  });

  it('端点与鉴权正负 oracle', () => {
    const value = section(readDoc(), '端点与鉴权');
    for (const required of [
      'POST /api/brain/harness/attempt-run',
      'GET /api/brain/harness/attempt-run/:id',
      'internalAuthOrLoopback',
      'Bearer $CECELIA_INTERNAL_TOKEN',
    ]) expect(value).toContain(required);
    expect(value).not.toContain('Bearer CECELIA_TOKEN');
    expect(value).not.toContain('可以省略 Bearer');
    expect(value).not.toMatch(/Bearer\s+(?!\$CECELIA_INTERNAL_TOKEN\b)[A-Za-z0-9_-]{16,}/);
  });

  it('角色白名单是恰好九项封闭集合', () => {
    const roles = [...section(readDoc(), '角色白名单').matchAll(/^- `([^`]+)`/gm)].map(m => m[1]);
    expect(roles).toEqual(EXPECTED_ROLES);
    expect(new Set(roles).size).toBe(9);
    expect(roles.filter(role => !EXPECTED_ROLES.includes(role))).toEqual([]);
  });

  it('payload 必填与可省略规则正负 oracle', () => {
    const value = section(readDoc(), 'payload 字段');
    const required = [...value.matchAll(/^\| `([^`]+)` \| 必填 \|/gm)].map(m => m[1]);
    expect(required).toEqual(['sprint_dir', 'base_repo', 'branch']);
    expect(required).not.toContain('base_sha');
    expect(value).toMatch(/`base_sha` \| 可省略 \|[^\n]*生产 Brain 自解析/);
    expect(value).not.toMatch(/base_sha[^\n]*必填|必填[^\n]*base_sha/);
  });

  it('失败回滚正负 oracle', () => {
    const value = section(readDoc(), '派发失败自动回滚');
    for (const required of ['run→failed', 'session→closed', 'task→cancelled']) expect(value).toContain(required);
    for (const forbidden of ['run→completed', 'session→active', 'task→in_progress']) expect(value).not.toContain(forbidden);
  });

  it('唯一交付文件范围 oracle', () => {
    const changed = execFileSync('git', ['diff', '--name-only', `${BASE_SHA}...HEAD`], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .filter(path => !path.startsWith('sprints/coding-harness-20260903033320-2se9fh/'));
    expect(changed).toEqual([DOC]);
    expect(DOC).toBe('docs/current/attempt-run-bridge.md');
  });
});
