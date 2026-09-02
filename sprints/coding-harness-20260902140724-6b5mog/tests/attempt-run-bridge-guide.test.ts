import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const BASE_SHA = 'd32b864de5adf8d3083c91f31ed3f5f7f58be985';
const SPRINT_PREFIX = 'sprints/coding-harness-20260902140724-6b5mog/';
const expectedRoles = [
  'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
  'evaluator', 'evaluator-evidence-repair', 'judge',
].sort();

function doc(): string {
  expect(existsSync(DOC), `${DOC} 必须存在`).toBe(true);
  return readFileSync(DOC, 'utf8');
}

function section(source: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |$)`, 'm'));
  expect(match, `缺少章节 ## ${heading}`).not.toBeNull();
  return match![1];
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('包含两个端点及各自用途', () => {
    const source = doc();
    expect(source).toMatch(/[一-龥]/);
    const endpoints = section(source, '端点用途');
    expect(endpoints).toContain('POST /api/brain/harness/attempt-run');
    expect(endpoints).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(endpoints).toMatch(/POST[\s\S]*(异步派发|创建)/);
    expect(endpoints).toMatch(/GET[\s\S]*(轮询|查询)/);
  });

  it('角色白名单恰好是九项封闭集合', () => {
    const source = doc();
    const auth = section(source, '鉴权');
    expect(auth).toContain('internalAuthOrLoopback');
    expect(auth).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(auth).toMatch(/宿主|远端/);
    expect(auth).not.toMatch(/(宿主|远端)[^。\n]*(免鉴权|无需[^。\n]*token|不需要[^。\n]*token)/i);
    const roles = [...section(source, '角色白名单').matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]).sort();
    expect(roles).toEqual(expectedRoles);
    expect(roles).not.toContain('commander');
    expect(roles).not.toContain('publisher');
  });

  it('payload 必填字段且 base_sha 可省略', () => {
    const payload = section(doc(), 'Payload');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(payload).toMatch(new RegExp(`(${field}[^\\n]*必填|必填[^\\n]*${field})`));
    }
    expect(payload).toMatch(/base_sha[^\n]*(可省略|非必填)|(可省略|非必填)[^\n]*base_sha/);
    expect(payload).toContain('生产 Brain');
    expect(payload).not.toMatch(/base_sha[^\n]*必填|必填[^\n]*base_sha/);
  });

  it('派发失败自动回滚三个对象', () => {
    const rollback = section(doc(), '派发失败自动回滚');
    expect(rollback).toMatch(/run\s*(→|->)\s*failed/);
    expect(rollback).toMatch(/session\s*(→|->)\s*closed/);
    expect(rollback).toMatch(/task\s*(→|->)\s*cancelled/);
    expect(rollback).toContain('自动');
  });

  it('实现范围只有目标说明文档', () => {
    const changed = execFileSync('git', ['diff', '--name-only', `${BASE_SHA}...HEAD`], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).filter((path) => !path.startsWith(SPRINT_PREFIX));
    expect(changed).toEqual([DOC]);
  });
});

