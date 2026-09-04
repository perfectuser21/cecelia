import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TASK_REQUEST_HASH = '0207fb013c7d30227edea6e345a287b4561ac99dd9406c7b38d5501d1b078d37';
const DOC = path.resolve('docs/current/attempt-run-bridge-usage.md');
const SOURCE = path.resolve('packages/brain/src/routes/harness-attempt-run.js');
const BASE = 'e0a56e2efaa96a5e9b1759f6b1086282121454dd';

function text() { return fs.readFileSync(DOC, 'utf8'); }
function section(body: string, title: string) {
  const match = body.match(new RegExp(`^## ${title}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  expect(match, `缺少章节：${title}`).not.toBeNull();
  return match![1];
}
function roleList(body: string) {
  return [...section(body, '角色白名单').matchAll(/^- `([^`]+)`\s*$/gm)].map((m) => m[1]);
}
function sourceRoles() {
  const source = fs.readFileSync(SOURCE, 'utf8');
  const block = source.match(/export const ALLOWED_ROLES = Object\.freeze\(\[([\s\S]*?)\]\);/);
  expect(block).not.toBeNull();
  return [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('文档范围、中文四节与 task_request_hash 绑定', () => {
    expect(TASK_REQUEST_HASH).toHaveLength(64);
    const changed = execFileSync('git', ['diff', '--name-status', BASE, 'HEAD'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    expect(changed).toEqual(['A\tdocs/current/attempt-run-bridge-usage.md']);
    const body = text();
    expect(body).toMatch(/[\u4e00-\u9fff]/);
    for (const title of ['端点用途与鉴权', '角色白名单', 'payload 必填字段', '派发失败自动回滚']) section(body, title);
  });

  it('端点用途与鉴权精确且拒绝远端匿名表述', () => {
    const s = section(text(), '端点用途与鉴权');
    for (const literal of ['POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id', 'internalAuthOrLoopback', 'Authorization: Bearer $CECELIA_INTERNAL_TOKEN']) expect(s).toContain(literal);
    expect(s).toMatch(/宿主|远端/);
    expect(s).toMatch(/必须/);
    expect(s).toMatch(/回环/);
    expect(s).not.toMatch(/远端.{0,20}(无需|不需要).{0,10}(token|Token)/i);
  });

  it('角色白名单恰好九项并与生产权威集合精确相等', () => {
    const actual = roleList(text());
    const expected = sourceRoles();
    expect(actual).toHaveLength(9);
    expect(new Set(actual).size).toBe(9);
    expect([...actual].sort()).toEqual([...expected].sort());
    expect(actual).not.toContain('commander');
    expect(actual).not.toContain('publisher');
  });

  it('payload 必填性与三对象回滚终态完整且无反向歧义', () => {
    const payload = section(text(), 'payload 必填字段');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) expect(payload).toMatch(new RegExp(`\\b${field}\\b.{0,40}必填`));
    expect(payload).toMatch(/\bbase_sha\b.{0,40}(可省略|选填)/);
    expect(payload).toMatch(/base_sha[\s\S]{0,80}生产 Brain.{0,30}(自解析|解析)/);
    expect(payload).not.toMatch(/(sprint_dir|base_repo|branch).{0,40}(可省略|选填)/);
    const rollback = section(text(), '派发失败自动回滚');
    for (const mapping of ['run → failed', 'session → closed', 'task → cancelled']) expect(rollback).toContain(mapping);
    expect(rollback).not.toMatch(/(run → (done|completed)|session → active|task → completed)/);
  });
});
