import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';

function guide(): string {
  return readFileSync(DOC, 'utf8');
}

function section(markdown: string, heading: RegExp): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) throw new Error(`缺少章节: ${heading}`);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
}

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('POST 明确用于创建且 GET 明确用于查询', () => {
    const endpoints = section(guide(), /^##\s+.*(?:端点|创建.*查询)/);
    expect(endpoints).toMatch(/POST `?\/api\/brain\/harness\/attempt-run`?[^\n]*(创建|派发)/);
    expect(endpoints).toMatch(/GET `?\/api\/brain\/harness\/attempt-run\/:id`?[^\n]*(查询|轮询)/);
  });

  it('鉴权明确要求宿主和远端分别携带 Bearer token', () => {
    const auth = section(guide(), /^##\s+.*鉴权/);
    expect(auth).toContain('internalAuthOrLoopback');
    expect(auth).toMatch(/宿主[^\n]*Authorization: Bearer CECELIA_INTERNAL_TOKEN/);
    expect(auth).toMatch(/远端[^\n]*Authorization: Bearer CECELIA_INTERNAL_TOKEN/);
    expect(auth).not.toMatch(/宿主[^\n]*(免鉴权|无需[^\n]*token)/);
    expect(auth).not.toMatch(/远端[^\n]*(免鉴权|无需[^\n]*token)/);
  });

  it('角色白名单恰好列出生产实现中的九项', () => {
    const roles = section(guide(), /^##\s+.*角色白名单/);
    const listed = [...roles.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
    expect(listed).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
  });

  it('payload 区分三个必填字段与 Brain 自解析的可省略 base_sha', () => {
    const payload = section(guide(), /^##\s+.*payload/i);
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(payload).toMatch(new RegExp(`\\b${field}\\b[^\\n]*必填`));
    }
    expect(payload).toMatch(/\bbase_sha\b[^\n]*(可省略|非必填)/);
    expect(payload).toMatch(/生产 Brain[^\n]*自解析/);
  });

  it('派发失败章节同时定义 run session task 的回滚终态', () => {
    const rollback = section(guide(), /^##\s+.*(?:派发失败|自动回滚)/);
    expect(rollback).toMatch(/run\s*(?:→|->)\s*failed/);
    expect(rollback).toMatch(/session\s*(?:→|->)\s*closed/);
    expect(rollback).toMatch(/task\s*(?:→|->)\s*cancelled/);
  });
});
