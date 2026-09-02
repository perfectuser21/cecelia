import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const baseline = 'd32b864de5adf8d3083c91f31ed3f5f7f58be985';
const roles = [
  'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
  'evaluator', 'evaluator-evidence-repair', 'judge',
];

function guide() {
  return readFileSync(guidePath, 'utf8');
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('两个端点用途', () => {
    const text = guide();
    expect(text).toMatch(/POST \/api\/brain\/harness\/attempt-run[\s\S]*异步派发/);
    expect(text).toMatch(/GET \/api\/brain\/harness\/attempt-run\/:id[\s\S]*轮询/);
  });

  it('鉴权与九项角色白名单', () => {
    const text = guide();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer CECELIA_INTERNAL_TOKEN');
    const section = text.match(/## 角色白名单([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    const listed = section.match(/^- `([^`]+)`$/gm)?.map((line) => line.slice(3, -1)) ?? [];
    expect(listed).toEqual(roles);
    expect(section).toMatch(/封闭集合|仅支持/);
    expect(section).not.toMatch(/等角色|例如|以及其他/);
  });

  it('payload 必填字段', () => {
    const section = guide().match(/## payload 字段([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(section).toMatch(new RegExp(`\\b${field}\\b[^\\n]*必填`));
    }
    expect(section).toMatch(/base_sha[^\n]*(可省略|非必填)[^\n]*生产 Brain[^\n]*自解析/);
  });

  it('派发失败自动回滚', () => {
    const section = guide().match(/## 派发失败自动回滚([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    expect(section).toContain('run→failed');
    expect(section).toContain('session→closed');
    expect(section).toContain('task→cancelled');
  });

  it('范围严格限于文档', () => {
    const changed = execFileSync('git', ['diff', '--name-only', `${baseline}...HEAD`], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    const allowed = new Set([
      guidePath,
      'sprints/coding-harness-20260902140724-6b5mog/contract-draft.md',
      'sprints/coding-harness-20260902140724-6b5mog/contract-dod.md',
      'sprints/coding-harness-20260902140724-6b5mog/task-plan.json',
      'sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts',
    ]);
    expect(changed.filter((path) => !allowed.has(path))).toEqual([]);
  });
});
