import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DOC = 'docs/current/attempt-run-bridge.md';
const BASE_SHA = '46221f91778af50e1be078f1e542ec5c17360126';
const readDoc = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('说明 POST 与 GET 用途', () => {
    const doc = readDoc();
    expect(doc).toContain('POST /api/brain/harness/attempt-run');
    expect(doc).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(doc).toContain('异步派发');
    expect(doc).toContain('轮询');
  });

  it('说明 internalAuthOrLoopback 与远端 Bearer 鉴权', () => {
    const doc = readDoc();
    expect(doc).toContain('internalAuthOrLoopback');
    expect(doc).toContain('宿主');
    expect(doc).toContain('远端');
    expect(doc).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
  });

  it('列出九项角色白名单', () => {
    const doc = readDoc();
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    for (const role of roles) expect(doc).toContain(role);
  });

  it('说明 payload 必填字段与 base_sha 省略', () => {
    const doc = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) expect(doc).toContain(field);
    expect(doc).toContain('base_sha');
    expect(doc).toContain('可省略');
    expect(doc).toContain('生产 Brain');
    expect(doc).toContain('自解析');
  });

  it('说明派发失败自动回滚终态', () => {
    const compact = readDoc().replace(/\s/g, '');
    expect(compact).toContain('run→failed');
    expect(compact).toContain('session→closed');
    expect(compact).toContain('task→cancelled');
  });

  it('只新增约定文档且不改代码', () => {
    const changed = execFileSync('git', ['diff', '--name-only', `${BASE_SHA}...HEAD`], { encoding: 'utf8' })
      .trim().split('\n').filter((path) => path && !path.startsWith('sprints/coding-harness-20260901035935-jlojco/'));
    expect(changed).toEqual([DOC]);
  });
});
