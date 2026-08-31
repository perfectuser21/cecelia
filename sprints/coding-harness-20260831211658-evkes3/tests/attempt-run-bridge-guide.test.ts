import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const SPRINT_PREFIX = 'sprints/coding-harness-20260831211658-evkes3/';

function documentText() {
  return readFileSync(DOC, 'utf8');
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('说明两个端点用途与鉴权方式', () => {
    const text = documentText();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toMatch(/POST[\s\S]*异步派发/);
    expect(text).toMatch(/GET[\s\S]*轮询/);
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
  });

  it('完整列出九项角色白名单', () => {
    const text = documentText();
    const documented = [...text.matchAll(/^\d+\. `([^`]+)`$/gm)].map((match) => match[1]);
    expect(documented).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
    expect(text).toContain('role_not_allowed');
  });

  it('说明 payload 必填字段与 base_sha 省略规则', () => {
    const text = documentText();
    for (const field of ['payload.sprint_dir', 'payload.base_repo', 'payload.branch']) {
      expect(text).toMatch(new RegExp(`\\b${field.replace('.', '\\.') }\\b[\\s\\S]{0,80}必填`));
    }
    expect(text).toMatch(/payload\.base_sha[\s\S]{0,120}可省略/);
    expect(text).toMatch(/base_sha[\s\S]{0,120}生产 Brain[\s\S]{0,80}解析/);
  });

  it('说明派发失败自动回滚的三个终态', () => {
    const text = documentText();
    expect(text).toMatch(/run\s*→\s*`failed`/);
    expect(text).toMatch(/session\s*→\s*`closed`/);
    expect(text).toMatch(/task\s*→\s*`cancelled`/);
    expect(text).toMatch(/本次请求|本调用/);
  });

  it('实现范围仅含目标文档', () => {
    const base = process.env.BASE_SHA ?? '88929fa377f5bed3cd1876a575c366ff1b93c0d5';
    const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .filter((path) => !path.startsWith(SPRINT_PREFIX));
    expect(changed).toEqual([DOC]);
  });
});

