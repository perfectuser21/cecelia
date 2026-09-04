import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const BASE_SHA = 'bdaca81b5cbf78929fa3d8eeac2a24cae6113b98';
const EXPECTED_ROLES = [
  'planner',
  'proposer',
  'proposer-critic',
  'generator',
  'generator-critic',
  'evaluator',
  'evaluator-critic',
  'reporter',
  'reporter-critic',
].sort();

function documentText(): string {
  return readFileSync(DOC, 'utf8');
}

function section(text: string, heading: string): string {
  const match = text.match(new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  expect(match, `缺少章节：${heading}`).not.toBeNull();
  return match![1];
}

describe('attempt-run 桥接使用说明合同', () => {
  it('文档存在且标题和正文为中文', () => {
    const text = documentText();
    expect(text).toMatch(/^# attempt-run 桥接使用说明$/m);
    expect(text).toMatch(/[\u4e00-\u9fff]{20,}/);
    expect(text).not.toMatch(/^#\s+Attempt Run Bridge Guide$/m);
  });

  it('创建与查询端点用途明确且不可互换', () => {
    const text = section(documentText(), '端点与鉴权');
    expect(text).toMatch(/POST `?\/api\/brain\/harness\/attempt-run`?[\s\S]{0,120}(创建|派发)/);
    expect(text).toMatch(/GET `?\/api\/brain\/harness\/attempt-run\/:id`?[\s\S]{0,120}(查询|轮询)/);
    expect(text).not.toMatch(/POST[^\n]{0,100}(仅用于查询|只用于查询)|GET[^\n]{0,100}(创建 attempt|创建运行)/);
  });

  it('鉴权区分 loopback 与宿主远端且不可宣称远端免鉴权', () => {
    const text = section(documentText(), '端点与鉴权');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/(宿主|远端)[\s\S]{0,120}Bearer CECELIA_INTERNAL_TOKEN/);
    expect(text).not.toMatch(/(宿主|远端)[^\n]{0,100}(免鉴权|无需鉴权)|所有请求[^\n]{0,100}(免鉴权|无需鉴权)/);
  });

  it('角色白名单恰好九项并拒绝任何额外角色', () => {
    const text = section(documentText(), '角色白名单');
    const extracted = [...text.matchAll(/`([a-z]+(?:-[a-z]+)*)`/g)].map((match) => match[1]).sort();
    expect(extracted).toEqual(EXPECTED_ROLES);
    expect(new Set(extracted).size).toBe(9);
    expect(extracted.some((role) => !EXPECTED_ROLES.includes(role))).toBe(false);
    expect(text).not.toMatch(/`(?:canary|reviewer|generator-fix|judge|commander|publisher)`/);
  });

  it('payload 三个字段必填且 base_sha 不可写成必填', () => {
    const text = section(documentText(), 'payload 与实现基线');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(text).toMatch(new RegExp('`' + field + '`[^\\n]{0,80}必填|必填[^\\n]{0,80}`' + field + '`'));
    }
    expect(text).toMatch(/`base_sha`[^\n]{0,100}(可省略|非必填)/);
    expect(text).toMatch(/生产 Brain[^\n]{0,100}(自解析|自动解析)/);
    expect(text).not.toMatch(/`base_sha`[^\n]{0,80}(必须提供|必填)|必填[^\n]{0,80}`base_sha`/);
  });

  it('实现基线保持不变且 workspace base_sha 不得替代', () => {
    const text = section(documentText(), 'payload 与实现基线');
    expect(text).toMatch(/实现基线[^\n]{0,120}(角色|GAN)[^\n]{0,120}(保持不变|不得改变)/);
    expect(text).toMatch(/workspace[^\n]{0,80}`?base_sha`?[^\n]{0,100}(不得替代|不能替代)/i);
    expect(text).not.toMatch(/workspace[^\n]{0,100}`?base_sha`?[^\n]{0,100}(替换|重置)实现基线/iu);
  });

  it('派发失败回滚三个对象到唯一终态且不可描述为部分成功', () => {
    const text = section(documentText(), '派发失败自动回滚');
    expect(text).toContain('run→failed');
    expect(text).toContain('session→closed');
    expect(text).toContain('task→cancelled');
    expect(text).not.toMatch(/(部分成功|保留成功)|run→(?:done|completed)|session→active|task→(?:queued|completed)/);
  });

  it('四个必需章节完整且没有人工确认占位', () => {
    const text = documentText();
    for (const heading of ['端点与鉴权', '角色白名单', 'payload 与实现基线', '派发失败自动回滚']) {
      expect(text).toMatch(new RegExp(`^## ${heading}\\s*$`, 'm'));
    }
    expect(text).not.toMatch(/TODO|TBD|待补充|人工确认|手工确认/iu);
  });

  it('交付范围相对冻结基线恰好只有 docs/current 下一页说明文档', () => {
    const files = execFileSync('git', ['diff', '--name-only', BASE_SHA, '--', '.', ':(exclude)sprints/**'], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).sort();
    expect(files).toEqual([DOC]);
    expect(files.some((file) => !file.startsWith('docs/current/') || file !== DOC)).toBe(false);
  });
});
