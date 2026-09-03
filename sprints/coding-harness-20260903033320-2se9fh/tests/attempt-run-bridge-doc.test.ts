import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge.md';
const HASH = 'aecb99079a0f3f82a833c6ff55d42e5903af6050d73033b574511db5dfd00e4f';
const ROLES = [
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

function section(markdown: string, heading: string): string {
  const match = markdown.match(new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## \\S|\\Z)`, 'm'));
  if (!match) throw new Error(`缺少章节: ${heading}`);
  return match[1];
}

function parseRoles(markdown: string): string[] {
  return [...section(markdown, '角色白名单').matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((m) => m[1]);
}

function endpointAuthValid(markdown: string): boolean {
  const body = section(markdown, '端点与鉴权');
  return body.includes('POST /api/brain/harness/attempt-run')
    && body.includes('GET /api/brain/harness/attempt-run/:id')
    && body.includes('internalAuthOrLoopback')
    && body.includes('Bearer CECELIA_INTERNAL_TOKEN')
    && !body.includes('Bearer CECELIA_TOKEN')
    && !/宿主或远端[^。\n]*(免鉴权|无需[^。\n]*Bearer|省略[^。\n]*Bearer)/.test(body);
}

function payloadValid(markdown: string): boolean {
  const body = section(markdown, 'payload 字段');
  return ['sprint_dir', 'base_repo', 'branch'].every((name) => body.includes(`| \`${name}\` | 必填 |`))
    && /\| `base_sha` \| 可省略 \|/.test(body)
    && body.includes('由生产 Brain 自解析');
}

function rollbackValid(markdown: string): boolean {
  const body = section(markdown, '派发失败自动回滚');
  return ['run→failed', 'session→closed', 'task→cancelled'].every((state) => body.includes(state));
}

describe('attempt-run 桥接使用说明', () => {
  const markdown = readFileSync(DOC, 'utf8');

  it('端点与鉴权正负 oracle', () => {
    expect(endpointAuthValid(markdown)).toBe(true);
    expect(endpointAuthValid(markdown.replace('Bearer CECELIA_INTERNAL_TOKEN', 'Bearer CECELIA_TOKEN'))).toBe(false);
    expect(endpointAuthValid(markdown.replace('宿主或远端必须', '宿主或远端免鉴权并可'))).toBe(false);
  });

  it('九项角色封闭集合正负 oracle', () => {
    const actual = parseRoles(markdown);
    expect(actual).toHaveLength(9);
    expect(new Set(actual).size).toBe(9);
    expect([...actual].sort()).toEqual([...ROLES].sort());
    expect([...actual, 'operator'].sort()).not.toEqual([...ROLES].sort());
    expect(actual.slice(0, -1).sort()).not.toEqual([...ROLES].sort());
  });

  it('payload 字段正负 oracle', () => {
    expect(payloadValid(markdown)).toBe(true);
    expect(payloadValid(markdown.replace('| `base_sha` | 可省略 |', '| `base_sha` | 必填 |'))).toBe(false);
    expect(payloadValid(markdown.replace('由生产 Brain 自解析', '由调用方提供'))).toBe(false);
  });

  it('失败回滚正负 oracle', () => {
    expect(rollbackValid(markdown)).toBe(true);
    expect(rollbackValid(markdown.replace('task→cancelled', 'task→completed'))).toBe(false);
  });

  it('中文与冻结哈希 oracle', () => {
    expect(markdown).toMatch(/[\u4e00-\u9fff]/);
    expect(markdown).toContain(HASH);
    expect(markdown).not.toMatch(/Authorization:\s*Bearer\s+(?!\$?CECELIA_INTERNAL_TOKEN(?:\b|`))[A-Za-z0-9._~-]{16,}/);
    expect(markdown.replace(HASH, 'hash-missing')).not.toContain(HASH);
  });
});
