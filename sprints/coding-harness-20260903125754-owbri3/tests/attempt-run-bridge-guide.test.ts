import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ROLES } from '../../../packages/brain/src/routes/harness-attempt-run.js';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const BASE_SHA = 'b99c580d7fe8ca4cbf0ee834e13c91df02b57369';
const SPRINT_DIR = 'sprints/coding-harness-20260903125754-owbri3/';

function guide(): string {
  return readFileSync(DOC, 'utf8');
}

function section(markdown: string, heading: string): string {
  const match = markdown.match(new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  return match?.[1] ?? '';
}

function roles(markdown: string): string[] {
  return [...section(markdown, '角色白名单').matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((m) => m[1]);
}

function endpointAuthValid(markdown: string): boolean {
  const value = section(markdown, '端点与鉴权');
  return value.includes('POST /api/brain/harness/attempt-run')
    && value.includes('GET /api/brain/harness/attempt-run/:id')
    && value.includes('internalAuthOrLoopback')
    && value.includes('Bearer CECELIA_INTERNAL_TOKEN')
    && /宿主|远端/.test(value)
    && !/宿主[^。\n]*(免鉴权|无需鉴权)|远端[^。\n]*(免鉴权|无需鉴权)/.test(value);
}

function payloadValid(markdown: string): boolean {
  const value = section(markdown, 'payload 字段');
  const required = [...value.matchAll(/^\s*-\s+`([^`]+)`：必填\s*$/gm)].map((m) => m[1]).sort();
  return JSON.stringify(required) === JSON.stringify(['base_repo', 'branch', 'sprint_dir'])
    && /`base_sha`：可省略/.test(value)
    && /生产 Brain[^。\n]*自解析/.test(value)
    && !/`base_sha`：必填/.test(value);
}

function rollbackValid(markdown: string): boolean {
  const value = section(markdown, '派发失败自动回滚');
  return value.includes('run→failed/session→closed/task→cancelled')
    && !value.includes('run→completed')
    && !value.includes('session→open')
    && !value.includes('task→completed');
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('端点与鉴权正负 oracle', () => {
    const markdown = guide();
    expect(endpointAuthValid(markdown)).toBe(true);
    expect(endpointAuthValid(markdown.replace('Bearer CECELIA_INTERNAL_TOKEN', 'Bearer OTHER_TOKEN'))).toBe(false);
    expect(endpointAuthValid(markdown.replace('宿主或远端必须', '宿主或远端无需鉴权，且'))).toBe(false);
  });

  it('九项角色封闭集合正负 oracle', () => {
    const actual = roles(guide());
    expect(actual).toHaveLength(9);
    expect(new Set(actual).size).toBe(9);
    expect([...actual].sort()).toEqual([...ALLOWED_ROLES].sort());
    expect([...actual, 'commander'].sort()).not.toEqual([...ALLOWED_ROLES].sort());
    expect(actual.filter((role) => role !== 'judge').sort()).not.toEqual([...ALLOWED_ROLES].sort());
  });

  it('payload 字段正负 oracle', () => {
    const markdown = guide();
    expect(payloadValid(markdown)).toBe(true);
    expect(payloadValid(markdown.replace('`base_sha`：可省略', '`base_sha`：必填'))).toBe(false);
    expect(payloadValid(markdown.replace('- `branch`：必填', '- `branch`：可省略'))).toBe(false);
  });

  it('失败回滚正负 oracle', () => {
    const markdown = guide();
    expect(rollbackValid(markdown)).toBe(true);
    expect(rollbackValid(markdown.replace('task→cancelled', 'task→completed'))).toBe(false);
    expect(rollbackValid(markdown.replace('session→closed', 'session→open'))).toBe(false);
  });

  it('中文文档与四节正负 oracle', () => {
    const markdown = guide();
    expect(markdown).toMatch(/^# attempt-run 桥接使用说明\s*$/m);
    expect(markdown).toMatch(/[\u4e00-\u9fff]/);
    for (const heading of ['端点与鉴权', '角色白名单', 'payload 字段', '派发失败自动回滚']) {
      expect(section(markdown, heading)).not.toBe('');
    }
    expect(section(markdown.replace('## payload 字段', '## 请求参数'), 'payload 字段')).toBe('');
  });

  it('实现 diff 仅有一页文档正负 oracle', () => {
    const changed = execFileSync('git', ['diff', '--name-only', `${BASE_SHA}...HEAD`, '--'], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).filter((path) => !path.startsWith(SPRINT_DIR)).sort();
    expect(changed).toEqual([DOC]);
    expect([...changed, 'packages/brain/src/server.js']).not.toEqual([DOC]);
    expect([]).not.toEqual([DOC]);
  });
});
