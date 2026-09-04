import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const BASE = 'bdaca81b5cbf78929fa3d8eeac2a24cae6113b98';
const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
const load = () => readFileSync(DOC, 'utf8');
const section = (text: string, heading: string) => text.split(`## ${heading}`)[1]?.split('\n## ')[0] ?? '';

describe('attempt-run 桥接使用说明合同', () => {
  it('文档为 docs/current 下唯一交付文件且内容为中文', () => {
    const changed = execFileSync('git', ['diff', '--name-only', BASE, '--', '.', ':(exclude)sprints/**'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    expect(changed).toEqual([DOC]);
    const text = load();
    expect(text).toMatch(/[\u4e00-\u9fff]/);
    expect(() => expect(text.replace(/[\u4e00-\u9fff]/g, '')).toMatch(/[\u4e00-\u9fff]/)).toThrow();
  });

  it('创建与查询端点及鉴权说明完整', () => {
    const text = section(load(), '端点与鉴权');
    for (const token of ['POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id', 'internalAuthOrLoopback', 'Bearer CECELIA_INTERNAL_TOKEN']) expect(text).toContain(token);
    expect(text).toMatch(/loopback[^。\n]*(免|无需)[^。\n]*Bearer/);
    expect(text).toMatch(/宿主|远端/);
    for (const token of ['POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id', 'internalAuthOrLoopback', 'Bearer CECELIA_INTERNAL_TOKEN']) expect(text.replace(token, '')).not.toSatisfy((v: string) => v.includes(token));
  });

  it('角色白名单是恰好九项的封闭集合', () => {
    const text = section(load(), '角色白名单');
    const actual = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(actual).toEqual(roles);
    expect(new Set(actual).size).toBe(9);
    expect([...actual, 'reporter']).not.toEqual(roles);
  });

  it('payload 必填字段与 base_sha 规则完整', () => {
    const text = section(load(), 'payload 与实现基线');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) expect(text).toContain(`\`${field}\``);
    expect(text).toMatch(/`base_sha`[^。\n]*可省略/);
    expect(text).toMatch(/生产 Brain[^。\n]*自解析/);
    expect(text).toMatch(/实现基线[^。\n]*保持不变/);
    expect(text).toMatch(/workspace[^。\n]*`base_sha`[^。\n]*不得替代/);
    expect(text.replace('可省略', '必填')).not.toMatch(/`base_sha`[^。\n]*可省略/);
  });

  it('派发失败自动回滚的三个终态完整', () => {
    const text = section(load(), '派发失败自动回滚');
    for (const state of ['run→failed', 'session→closed', 'task→cancelled']) expect(text).toContain(state);
    expect(text.replace('task→cancelled', '')).not.toContain('task→cancelled');
  });

  it('四个必需章节均存在且不接受同义标题', () => {
    const text = load();
    const headings = ['端点与鉴权', '角色白名单', 'payload 与实现基线', '派发失败自动回滚'];
    for (const heading of headings) expect(text).toContain(`## ${heading}`);
    expect(text.replace('## 角色白名单', '## 支持角色')).not.toContain('## 角色白名单');
  });
});
