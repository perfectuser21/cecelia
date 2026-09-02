import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DOC_PATH = 'docs/current/attempt-run-bridge-guide.md';
const SPRINT_PREFIX = 'sprints/coding-harness-20260902104452-b4swl3/';
const FROZEN_BASE_SHA = '48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3';

function readGuide(): string {
  return readFileSync(DOC_PATH, 'utf8');
}

function section(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markdown.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  expect(match, `缺少独立章节：${heading}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('说明创建与查询端点用途', () => {
    const body = section(readGuide(), '端点用途');
    expect(body).toContain('POST /api/brain/harness/attempt-run');
    expect(body).toMatch(/创建.{0,12}派发/);
    expect(body).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(body).toMatch(/按.{0,6}id.{0,12}查询.{0,12}(运行)?状态/);
  });

  it('说明鉴权且不泄露凭据', () => {
    const body = section(readGuide(), '鉴权方式');
    expect(body).toContain('internalAuthOrLoopback');
    expect(body).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
    expect(body).toMatch(/宿主.{0,12}远端.{0,24}必须/);
    expect(body).not.toMatch(/Bearer\s+(?!<CECELIA_INTERNAL_TOKEN>)[A-Za-z0-9_.-]{16,}/);
  });

  it('角色白名单是封闭九项', () => {
    const body = section(readGuide(), '角色白名单');
    const roles = [...body.matchAll(/^- `([^`]+)`\s*$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
  });

  it('说明 payload 必填与可省略字段', () => {
    const body = section(readGuide(), 'payload 与失败回滚');
    expect(body).toMatch(/`sprint_dir`、`base_repo`、`branch`.{0,16}必填/);
    expect(body).toMatch(/`base_sha`.{0,16}可省略/);
    expect(body).toMatch(/生产 Brain.{0,12}自解析/);
  });

  it('说明派发失败自动回滚', () => {
    const body = section(readGuide(), 'payload 与失败回滚');
    expect(body).toContain('run → failed');
    expect(body).toContain('session → closed');
    expect(body).toContain('task → cancelled');
    expect(body).toMatch(/查询端点.{0,18}(观察|查询)/);
  });

  it('canonical 全仓 diff 仅包含目标文档', () => {
    const changed = execFileSync(
      'git', ['diff', '--name-only', `${FROZEN_BASE_SHA}...HEAD`, '--', '.'],
      { encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
    const implementationFiles = changed.filter((path) => !path.startsWith(SPRINT_PREFIX));
    expect(implementationFiles).toEqual([DOC_PATH]);
  });
});
