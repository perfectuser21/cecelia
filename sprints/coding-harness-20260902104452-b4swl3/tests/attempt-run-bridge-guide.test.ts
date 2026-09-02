import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const BASE_SHA = '48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3';
const SPRINT_DIR = 'sprints/coding-harness-20260902104452-b4swl3';
const readDoc = () => fs.readFileSync(DOC, 'utf8');
const section = (text: string, heading: string) => {
  const match = text.match(new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |$)`, 'm'));
  expect(match, `缺少章节：${heading}`).not.toBeNull();
  return match![1];
};
const bullets = (text: string) => [...text.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('端点与鉴权正负 oracle', () => {
    const text = readDoc();
    const s = section(text, '端点与鉴权');
    for (const literal of [
      'POST /api/brain/harness/attempt-run',
      'GET /api/brain/harness/attempt-run/:id',
      'internalAuthOrLoopback',
      'Authorization: Bearer <CECELIA_INTERNAL_TOKEN>',
    ]) expect(s).toContain(literal);
    expect(s).toMatch(/POST[\s\S]*创建[\s\S]*派发/);
    expect(s).toMatch(/GET[\s\S]*查询/);
    expect(s).toMatch(/宿主|远端/);
    expect(s).toMatch(/必须/);
    expect(s).toMatch(/匿名|错误 token/);
    expect(s).not.toMatch(/匿名(?:请求)?可访问|错误 token(?:也)?可访问/);
    const bearerValues = [...text.matchAll(/Bearer\s+([^\s`]+)/g)].map((m) => m[1]);
    expect(new Set(bearerValues)).toEqual(new Set(['<CECELIA_INTERNAL_TOKEN>']));
  });

  it('角色白名单封闭集合正负 oracle', () => {
    const s = section(readDoc(), '角色白名单');
    const actual = bullets(s);
    const expected = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    expect(actual).toHaveLength(9);
    expect(new Set(actual)).toEqual(new Set(expected));
    for (const forbidden of ['critic', 'merger', 'reporter', 'publisher', 'commander']) {
      expect(actual).not.toContain(forbidden);
    }
  });

  it('payload 必填闭集与 base_sha 负向 oracle', () => {
    const s = section(readDoc(), 'payload 字段');
    const required = bullets(s.match(/### 必填字段\n([\s\S]*?)(?=^### |$)/m)?.[1] ?? '');
    expect(new Set(required)).toEqual(new Set(['sprint_dir', 'base_repo', 'branch']));
    expect(required).toHaveLength(3);
    expect(required).not.toContain('base_sha');
    expect(s).toMatch(/`base_sha`[\s\S]*可省略[\s\S]*生产 Brain[\s\S]*自解析/);
  });

  it('失败回滚封闭集合正负 oracle', () => {
    const s = section(readDoc(), '派发失败自动回滚');
    const actual = [...s.matchAll(/^- `([^`]+)`\s*→\s*`([^`]+)`/gm)].map((m) => `${m[1]}→${m[2]}`);
    expect(actual).toEqual(['run→failed', 'session→closed', 'task→cancelled']);
    expect(s).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(s).toMatch(/不会|不得|不应/);
    expect(s).not.toMatch(/session\s*→\s*`?active|task\s*→\s*`?queued/);
  });

  it('交付范围 canonical diff 正负 oracle', () => {
    const changed = execFileSync('git', ['diff', '--name-only', `${BASE_SHA}...HEAD`], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    const contractArtifact = new RegExp(`^${SPRINT_DIR}/(?:contract-draft\\.md|contract-dod\\.md|task-plan\\.json|tests/.*\\.test\\.ts)$`);
    const implementationChanged = changed.filter((file) => !contractArtifact.test(file));
    expect(implementationChanged).toEqual([DOC]);
    const added = execFileSync('git', ['diff', '--diff-filter=A', '--name-only', `${BASE_SHA}...HEAD`, '--', DOC], { encoding: 'utf8' }).trim();
    expect(added).toBe(DOC);
    expect(changed.filter((file) => /\.(?:js|cjs|mjs|ts|tsx|jsx|py|sh)$/.test(file) && !contractArtifact.test(file))).toEqual([]);
  });
});
