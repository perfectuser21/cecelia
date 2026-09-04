import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DOCS_DIR = join(process.cwd(), 'docs/current');
const GUIDE_NAME = 'attempt-run-bridge-guide.md';
const GUIDE_PATH = join(DOCS_DIR, GUIDE_NAME);
const EXPECTED_ROLES = [
  'planner', 'proposer', 'proposer-critic', 'generator', 'generator-critic',
  'evaluator', 'evaluator-critic', 'reporter', 'reporter-critic',
] as const;

function guide(): string {
  return readFileSync(GUIDE_PATH, 'utf8');
}

function section(body: string, heading: string): string {
  const match = body.match(new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  expect(match, `缺少章节：${heading}`).not.toBeNull();
  return match![1];
}

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('文档存在于 docs/current 且是唯一新增交付页', () => {
    expect(readdirSync(DOCS_DIR)).toContain(GUIDE_NAME);
    expect(guide()).toMatch(/[\u4e00-\u9fff]/);
  });

  it('端点与鉴权章节同时说明创建查询用途和远端 Bearer 要求', () => {
    const text = section(guide(), '端点与鉴权');
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/POST[^\n]*(创建|派发)/);
    expect(text).toMatch(/GET[^\n]*(查询|轮询)/);
    expect(text).not.toMatch(/宿主|远端[^\n]*(免鉴权|无需鉴权)/);
  });

  it('角色白名单章节是恰好九项的封闭集合且拒绝额外角色', () => {
    const text = section(guide(), '角色白名单');
    const listed = [...text.matchAll(/^\s*[-*]\s+`([^`]+)`\s*$/gm)].map((m) => m[1]);
    expect(listed).toHaveLength(9);
    expect(new Set(listed)).toEqual(new Set(EXPECTED_ROLES));
    expect(listed.every((role) => EXPECTED_ROLES.includes(role as typeof EXPECTED_ROLES[number]))).toBe(true);
  });

  it('payload 章节限定三个必填字段并说明 base_sha 省略与冻结基线', () => {
    const text = section(guide(), 'payload 与实现基线');
    const required = [...text.matchAll(/^\s*[-*]\s+`([^`]+)`：必填/gm)].map((m) => m[1]);
    expect(required).toEqual(['sprint_dir', 'base_repo', 'branch']);
    expect(text).toMatch(/`base_sha`[^\n]*(可省略|非必填)/);
    expect(text).toMatch(/生产 Brain[^\n]*自解析/);
    expect(text).toMatch(/实现基线[^\n]*(保持不变|不可变)/);
    expect(text).toMatch(/workspace[^\n]*`base_sha`[^\n]*(不得|不能)[^\n]*(替代|覆盖)/);
    expect(text).not.toMatch(/`base_sha`：必填/);
  });

  it('派发失败自动回滚章节声明三个且仅三个关联终态', () => {
    const text = section(guide(), '派发失败自动回滚');
    const transitions = [...text.matchAll(/`(run|session|task)\s*→\s*(failed|closed|cancelled)`/g)]
      .map((m) => `${m[1]}→${m[2]}`);
    expect(transitions).toEqual(['run→failed', 'session→closed', 'task→cancelled']);
    expect(text).not.toMatch(/部分成功|继续运行|保持打开/);
  });
});
