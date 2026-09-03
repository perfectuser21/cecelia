import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-桥接使用说明.md';
const BASE_SHA = '6230da4a13fad9e43d6316b70914b5b69033ef37';
const ROLES = [
  'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
  'evaluator', 'evaluator-evidence-repair', 'judge',
];

function readDoc() {
  return readFileSync(DOC, 'utf8');
}

function section(body: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.match(new RegExp(`^## ${escaped}\\n([\\s\\S]*?)(?=^## |\\Z)`, 'm'))?.[1] ?? '';
}

function listItems(body: string) {
  return [...body.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
}

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('两个端点用途与鉴权正反向 oracle 完整', () => {
    const body = readDoc();
    expect(body).toContain('POST /api/brain/harness/attempt-run');
    expect(body).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(body).toContain('internalAuthOrLoopback');
    expect(body).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
    expect(body).toMatch(/缺少|无效/);
    expect(body).toMatch(/拒绝|不能成功/);
    expect(body).not.toMatch(/Authorization: Bearer (?!<CECELIA_INTERNAL_TOKEN>)[A-Za-z0-9_.-]{12,}/);
  });

  it('角色白名单是逐项列名的封闭九项集合且含越界拒绝', () => {
    const roles = listItems(section(readDoc(), '角色白名单'));
    expect(roles).toHaveLength(9);
    expect(new Set(roles)).toEqual(new Set(ROLES));
    expect(section(readDoc(), '角色白名单')).toMatch(/白名单外.*拒绝/);
    expect(roles).not.toContain('publisher');
  });

  it('payload 必填与可选语义均有对应负向 oracle', () => {
    const payload = section(readDoc(), 'POST payload');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(payload).toMatch(new RegExp(`\\b${field}\\b[^\\n]*必填`));
    }
    expect(payload).toMatch(/`base_sha`[^\n]*可省略/);
    expect(payload).toMatch(/省略[^\n]*生产 Brain[^\n]*自解析/);
    expect(payload).toMatch(/任一缺失[^\n]*(拒绝|不满足)/);
    expect(payload).not.toMatch(/调用方[^\n]*(猜测|自行解析)[^\n]*base_sha/);
  });

  it('派发失败回滚封闭覆盖三个资源且否定半成功', () => {
    const rollback = section(readDoc(), '派发失败自动回滚');
    expect(rollback).toContain('run → failed');
    expect(rollback).toContain('session → closed');
    expect(rollback).toContain('task → cancelled');
    expect(rollback).toMatch(/不是半成功|三项.*完整/);
    expect(listItems(rollback)).toEqual(['run → failed', 'session → closed', 'task → cancelled']);
  });

  it('范围 oracle 只允许唯一 docs 产品文件且冻结基线不漂移', () => {
    const changed = execFileSync('git', ['diff', '--name-only', `${BASE_SHA}...HEAD`], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .filter((path) => !path.startsWith('sprints/coding-harness-20260903005419-evol42/'));
    expect(changed).toEqual([DOC]);
    expect(changed.some((path) => /(^|\/)(src|scripts|packages|apps)\//.test(path))).toBe(false);
  });
});
