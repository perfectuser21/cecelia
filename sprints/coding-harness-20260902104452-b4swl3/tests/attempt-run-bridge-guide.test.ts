import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const read = () => readFileSync(DOC, 'utf8');
const section = (text: string, title: string) => {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  expect(match, `缺少独立章节：${title}`).not.toBeNull();
  return match?.[1] ?? '';
};

describe('attempt-run 桥接使用说明合同', () => {
  it('端点用途逐项正向并拒绝反向描述', () => {
    const s = section(read(), '端点');
    expect(s).toMatch(/POST `?\/api\/brain\/harness\/attempt-run`?[^\n]*(创建|新建)[^\n]*派发/);
    expect(s).toMatch(/GET `?\/api\/brain\/harness\/attempt-run\/:id`?[^\n]*按[^\n]*id[^\n]*查询[^\n]*状态/);
    expect(s).not.toMatch(/POST[^\n]*(按[^\n]*id[^\n]*查询|只用于查询)/);
    expect(s).not.toMatch(/GET[^\n]*(创建|新建|派发)/);
  });

  it('鉴权逐项正向并拒绝匿名错误 token 与真实凭据', () => {
    const s = section(read(), '鉴权');
    expect(s).toContain('internalAuthOrLoopback');
    expect(s).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
    expect(s).toMatch(/宿主[^\n]*远端[^\n]*(必须|均须)[^\n]*Bearer/);
    expect(s).not.toMatch(/(匿名|无 token|错误 token|错误的 token)[^。\n]*(可访问|允许|放行)/);
    expect(s).not.toMatch(/Authorization: Bearer (?!<CECELIA_INTERNAL_TOKEN>)[A-Za-z0-9._-]{12,}/);
  });

  it('角色白名单九项逐项正向并拒绝重复遗漏与额外项', () => {
    const s = section(read(), '角色白名单');
    const roles = [...s.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((m) => m[1]);
    const expected = ['planner', 'proposer', 'critic', 'generator', 'generator-fix', 'evaluator', 'evaluator-fix', 'merger', 'reporter'];
    expect(roles).toHaveLength(9);
    expect(roles).toEqual(expected);
    expect(new Set(roles).size).toBe(9);
  });

  it('payload 每个字段逐项正向并拒绝 base_sha 必填语义', () => {
    const s = section(read(), 'payload');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(s).toMatch(new RegExp(`(?:\\x60${field}\\x60|\\b${field}\\b)[^\\n]*(必填|required)`));
    }
    expect(s).toMatch(/`?base_sha`?[^\n]*(可省略|非必填)/);
    expect(s).toMatch(/`?base_sha`?[^\n]*生产 Brain[^\n]*自解析/);
    expect(s).not.toMatch(/`?base_sha`?[^\n]*(必须提供|必填|required|缺失[^\n]*(报错|失败|拒绝))/);
  });

  it('回滚三状态逐项正向并拒绝非终态残留', () => {
    const s = section(read(), '失败回滚');
    expect(s).toContain('run → failed');
    expect(s).toContain('session → closed');
    expect(s).toContain('task → cancelled');
    expect(s).not.toMatch(/run\s*→\s*(queued|running|in_progress)/);
    expect(s).not.toMatch(/session\s*→\s*(open|active|running)/);
    expect(s).not.toMatch(/task\s*→\s*(queued|pending|running|in_progress)/);
  });
});
