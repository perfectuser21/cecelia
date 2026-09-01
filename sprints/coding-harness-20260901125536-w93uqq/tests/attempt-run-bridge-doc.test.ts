import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = resolve(HERE, '../../../docs/current/attempt-run-bridge.md');

function documentText(): string {
  return readFileSync(DOC, 'utf8');
}

function section(text: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, 'm'));
  expect(match, `缺少二级章节：${heading}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('attempt-run 桥接使用说明冻结合同 [BEHAVIOR]', () => {
  it('中文说明分别解释 POST 创建派发与 GET 按 id 查询', () => {
    const text = documentText();
    expect((text.match(/[\u4e00-\u9fff]/g) ?? []).length).toBeGreaterThanOrEqual(20);
    const endpoints = section(text, '端点用途');
    expect(endpoints).toContain('POST /api/brain/harness/attempt-run');
    expect(endpoints).toMatch(/POST[\s\S]{0,160}创建[\s\S]{0,80}派发/);
    expect(endpoints).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(endpoints).toMatch(/GET[\s\S]{0,160}按[^\n]{0,30}id[^\n]{0,60}查询/);
  });

  it('鉴权章节区分 loopback 与宿主远端 Bearer 要求', () => {
    const auth = section(documentText(), '鉴权方式');
    expect(auth).toContain('internalAuthOrLoopback');
    expect(auth).toMatch(/loopback/i);
    expect(auth).toMatch(/宿主.{0,10}远端|远端.{0,10}宿主/);
    expect(auth).toMatch(/宿主[\s\S]{0,180}必须[\s\S]{0,180}Authorization:\s*Bearer\s+\$?CECELIA_INTERNAL_TOKEN/);
  });

  it('角色章节精确列出九项生产白名单', () => {
    const roles = section(documentText(), '角色白名单');
    const listed = [...roles.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((m) => m[1]).sort();
    expect(listed).toEqual([
      'canary', 'evaluator', 'evaluator-evidence-repair', 'generator', 'generator-fix',
      'judge', 'planner', 'proposer', 'reviewer',
    ]);
    expect(roles).toMatch(/白名单外.{0,30}(不合法|非法|拒绝)/);
  });

  it('payload 章节锁定三个必填字段与 base_sha 省略语义', () => {
    const payload = section(documentText(), 'payload 字段');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(payload).toMatch(new RegExp('`' + field + '`[^\\n]{0,40}必填'));
    }
    expect(payload).toMatch(/`base_sha`[^\n]{0,40}(可省略|选填)/);
    expect(payload).toMatch(/base_sha[\s\S]{0,120}生产 Brain[\s\S]{0,80}自解析/);
  });

  it('失败回滚章节同时说明三类对象终态与查询观察方式', () => {
    const rollback = section(documentText(), '派发失败自动回滚');
    expect(rollback).toContain('run → failed');
    expect(rollback).toContain('session → closed');
    expect(rollback).toContain('task → cancelled');
    expect(rollback).toMatch(/GET[\s\S]{0,160}(查询|观察)[\s\S]{0,120}(失败|终态)/);
  });
});
