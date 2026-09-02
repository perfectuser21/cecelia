import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const path = 'docs/current/attempt-run-bridge-guide.md';
const read = () => fs.readFileSync(path, 'utf8');
const section = (text: string, title: string) => {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  expect(match, `缺少独立章节：${title}`).not.toBeNull();
  return match![1];
};

describe('attempt-run 桥接使用说明合同', () => {
  it('端点用途的正向与负向 oracle', () => {
    const s = section(read(), '端点');
    expect(s).toMatch(/POST `?\/api\/brain\/harness\/attempt-run`?[\s\S]*创建并派发/);
    expect(s).toMatch(/GET `?\/api\/brain\/harness\/attempt-run\/:id`?[\s\S]*按.*id.*查询/);
    expect(s).not.toMatch(/POST[^\n]*(查询)|GET[^\n]*(创建|派发)/);
  });

  it('鉴权的正向与负向 oracle', () => {
    const s = section(read(), '鉴权');
    expect(s).toContain('internalAuthOrLoopback');
    expect(s).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
    expect(s).toMatch(/宿主[\s\S]*远端[\s\S]*(必须|均须).*Bearer/);
    expect(s).not.toMatch(/(匿名|错误 token|错误的 token)[^。\n]*(可访问|允许|放行)/);
    expect(s).not.toMatch(/Authorization: Bearer (?!<CECELIA_INTERNAL_TOKEN>)[A-Za-z0-9._-]{12,}/);
  });

  it('角色白名单恰好九项', () => {
    const s = section(read(), '角色白名单');
    const roles = [...s.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map(m => m[1]);
    const expected = ['planner', 'proposer', 'critic', 'generator', 'generator-fix', 'evaluator', 'evaluator-fix', 'merger', 'reporter'];
    expect(roles).toHaveLength(9);
    expect(roles).toEqual(expected);
    expect(new Set(roles).size).toBe(9);
  });

  it('payload 与 base_sha 的正向与负向 oracle', () => {
    const s = section(read(), 'payload');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(s).toMatch(new RegExp(`\\b${field}\\b[^\\n]*(必填|required)`));
    }
    expect(s).toMatch(/base_sha[^\n]*(可省略|非必填)/);
    expect(s).toMatch(/base_sha[^\n]*生产 Brain[^\n]*自解析/);
    expect(s).not.toMatch(/base_sha[^\n]*(必填|required|缺失[^\n]*(报错|失败|拒绝))/);
  });

  it('回滚状态的正向与负向 oracle', () => {
    const s = section(read(), '失败回滚');
    expect(s).toContain('run → failed');
    expect(s).toContain('session → closed');
    expect(s).toContain('task → cancelled');
    expect(s).not.toMatch(/run\s*→\s*(queued|running)|session\s*→\s*(open|running)|task\s*→\s*(queued|pending|running)/);
  });
});

