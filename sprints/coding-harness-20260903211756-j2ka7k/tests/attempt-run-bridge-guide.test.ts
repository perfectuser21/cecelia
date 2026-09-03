import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ALLOWED_ROLES } from '../../../packages/brain/src/routes/harness-attempt-run.js';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const BASE_SHA = 'a3639b56c04e7ced8fa1c1d623efa51ea25666a7';
const EXPECTED_ROLES = [
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

function documentText() {
  return readFileSync(DOC, 'utf8');
}

function sectionItems(text: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^## ${escaped}\\n([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  expect(match, `缺少章节：${heading}`).not.toBeNull();
  return [...match![1].matchAll(/^- `([^`]+)`/gm)].map((item) => item[1]);
}

describe('attempt-run 桥接使用说明', () => {
  it('中文标题与四个主题章节完整，且不接受英文标题或合并章节', () => {
    const text = documentText();
    expect(text).toMatch(/^# attempt-run 桥接使用说明$/m);
    for (const heading of ['端点与用途', '鉴权', '角色白名单', 'payload 与失败回滚']) {
      expect(text).toContain(`## ${heading}`);
    }
    expect(text).not.toMatch(/^# Attempt[- ]Run Bridge Guide$/m);
  });

  it('POST 与 GET 用途和 attempt-run id 正确，且不接受 task/session id', () => {
    const text = documentText();
    expect(text).toMatch(/`POST \/api\/brain\/harness\/attempt-run`[^\n]*派发/);
    expect(text).toMatch(/`GET \/api\/brain\/harness\/attempt-run\/:id`[^\n]*(查询|轮询)/);
    expect(text).toMatch(/`:id`[^\n]*attempt-run[^\n]*标识/);
    expect(text).not.toMatch(/`:id`[^\n]*(task|session)[^\n]*标识/);
  });

  it('鉴权说明包含安全占位符，且不把远端匿名请求描述为成功', () => {
    const text = documentText();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toMatch(/宿主\/远端[^\n]*`Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`/);
    expect(text).not.toMatch(/宿主\/远端[^\n]*(无需|不需要)[^\n]*(Bearer|令牌|鉴权)/);
    expect(text).not.toMatch(/Authorization: Bearer (?!<CECELIA_INTERNAL_TOKEN>)[A-Za-z0-9_.-]{16,}/);
  });

  it('角色白名单现场列举恰好九项并与生产封闭集合相等，且无别名重复', () => {
    const roles = sectionItems(documentText(), '角色白名单');
    expect(roles).toHaveLength(9);
    expect(new Set(roles).size).toBe(9);
    expect([...roles].sort()).toEqual([...EXPECTED_ROLES].sort());
    expect([...roles].sort()).toEqual([...ALLOWED_ROLES].sort());
    expect(roles).not.toEqual(expect.arrayContaining(['commander', 'publisher']));
  });

  it('payload 现场列举三项必填且 base_sha 可省略，且不接受颠倒必填性', () => {
    const text = documentText();
    const fields = sectionItems(text, 'payload 与失败回滚');
    const required = fields.filter((field) => ['sprint_dir', 'base_repo', 'branch'].includes(field));
    expect(required).toEqual(['sprint_dir', 'base_repo', 'branch']);
    expect(text).toMatch(/`base_sha`[^\n]*可省略[^\n]*生产 Brain[^\n]*自解析/);
    expect(text).not.toMatch(/`base_sha`[^\n]*(必须|必填)/);
  });

  it('派发失败现场列举三项回滚终态，且不接受遗漏或错误终态', () => {
    const text = documentText();
    const rollback = [...text.matchAll(/`(run|session|task) → (failed|closed|cancelled)`/g)]
      .map((entry) => `${entry[1]} → ${entry[2]}`);
    expect(rollback).toEqual(['run → failed', 'session → closed', 'task → cancelled']);
    expect(new Set(rollback).size).toBe(3);
    expect(text).not.toMatch(/`(?:run → (?!failed)|session → (?!closed)|task → (?!cancelled))[^`]+`/);
  });

  it('唯一产品改动是目标文档，且不接受任何代码或其他文档改动', () => {
    const changed = execFileSync('git', [
      'diff', '--name-only', `${BASE_SHA}...HEAD`, '--',
      '.', `:(exclude)sprints/coding-harness-20260903211756-j2ka7k/**`,
    ], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    expect(changed).toEqual([DOC]);
    expect(changed.some((path) => /^(packages|apps|scripts)\//.test(path))).toBe(false);
  });

  it('正负 oracle 成对且计数封闭为八对十六项', () => {
    const pairs = [
      ['中文结构正向', '英文或合并结构负向'],
      ['端点用途正向', '错误 id 语义负向'],
      ['鉴权占位正向', '匿名或真实凭据负向'],
      ['九角色集合正向', '别名或重复负向'],
      ['三必填字段正向', 'base_sha 必填负向'],
      ['三回滚终态正向', '遗漏或错态负向'],
      ['唯一文档范围正向', '代码或其他文档越界负向'],
      ['配对计数正向', '非封闭计数负向'],
    ];
    expect(pairs).toHaveLength(8);
    expect(pairs.flat()).toHaveLength(16);
    expect(pairs.every(([positive, negative]) => positive.endsWith('正向') && negative.endsWith('负向'))).toBe(true);
  });
});
