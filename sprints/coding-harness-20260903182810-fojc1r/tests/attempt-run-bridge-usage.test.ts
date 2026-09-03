import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOC_PATH = 'docs/current/attempt-run-bridge-usage.md';
const BASE_SHA = process.env.BASE_SHA ?? '565796b924487f6d5c4314703c757b32b788fdac';
const ALLOWED_ROLES = [
  'canary',
  'planner',
  'proposer',
  'reviewer',
  'generator',
  'generator-fix',
  'evaluator',
  'evaluator-evidence-repair',
  'judge',
] as const;

function readDoc(): string {
  return readFileSync(DOC_PATH, 'utf8');
}

function roleItems(markdown: string): string[] {
  const section = markdown.match(/## 角色白名单[^]*?(?=\n## |$)/)?.[0] ?? '';
  return [...section.matchAll(/^- `([^`]+)`\s*$/gm)].map((match) => match[1]);
}

function validatesAuth(markdown: string): boolean {
  return markdown.includes('internalAuthOrLoopback')
    && markdown.includes('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>')
    && /宿主|远端/.test(markdown)
    && /必须/.test(markdown);
}

function validatesPayload(markdown: string): boolean {
  return ['sprint_dir', 'base_repo', 'branch'].every((field) => markdown.includes(`\`${field}\``))
    && markdown.includes('`base_sha`')
    && /base_sha[^。\n]*(可省略|省略)[^。\n]*生产 Brain[^。\n]*自解析/.test(markdown);
}

describe('attempt-run 桥接使用说明合同', () => {
  it('文档包含创建与查询端点的准确用途', () => {
    const doc = readDoc();
    expect(doc).toContain('POST /api/brain/harness/attempt-run');
    expect(doc).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(doc).toMatch(/POST[^。\n]*(创建|派发)/);
    expect(doc).toMatch(/GET[^。\n]*(查询|状态)/);

    const incomplete = doc.replace('GET /api/brain/harness/attempt-run/:id', 'GET /api/brain/harness/attempt-run');
    expect(incomplete).not.toContain('GET /api/brain/harness/attempt-run/:id');
  });

  it('鉴权说明要求宿主或远端使用 Bearer token', () => {
    const doc = readDoc();
    expect(validatesAuth(doc)).toBe(true);

    const anonymousRemote = doc.replace('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>', '匿名访问');
    expect(validatesAuth(anonymousRemote)).toBe(false);
  });

  it('角色白名单是九项封闭集合且拒绝别名和遗漏', () => {
    const doc = readDoc();
    expect(roleItems(doc)).toEqual(ALLOWED_ROLES);

    expect(roleItems(doc.replace('- `judge`', '- `arbiter`'))).not.toEqual(ALLOWED_ROLES);
    expect(roleItems(doc.replace('- `judge`', ''))).not.toEqual(ALLOWED_ROLES);
  });

  it('payload 明确三个必填字段与 base_sha 省略语义', () => {
    const doc = readDoc();
    expect(validatesPayload(doc)).toBe(true);

    const wrongDefault = doc.replace(/生产 Brain[^。\n]*自解析/, '调用方猜测固定值');
    expect(validatesPayload(wrongDefault)).toBe(false);
  });

  it('派发失败回滚完整列出三个资源终态', () => {
    const doc = readDoc();
    const terminalStates = ['run→failed', 'session→closed', 'task→cancelled'];
    expect(terminalStates.every((state) => doc.includes(state))).toBe(true);

    expect(terminalStates.every((state) => doc.replace('task→cancelled', '').includes(state))).toBe(false);
  });

  it('范围 oracle 仅允许新增目标文档且拒绝代码变化', () => {
    const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${BASE_SHA}...HEAD`], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .filter((path) => !path.startsWith('sprints/coding-harness-20260903182810-fojc1r/'));
    expect(changed).toEqual([DOC_PATH]);

    const forbidden = [...changed, 'packages/brain/src/server.js'];
    expect(forbidden).not.toEqual([DOC_PATH]);
  });
});
