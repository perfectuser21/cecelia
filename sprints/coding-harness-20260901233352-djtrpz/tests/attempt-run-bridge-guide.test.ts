import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const BASE = '37fc357d927b1429de59e1b50e4de762c5e7ea18';
const expectedRoles = [
  'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
  'evaluator', 'evaluator-evidence-repair', 'judge',
];

function documentText() {
  return readFileSync(DOC, 'utf8');
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('文档包含端点用途与鉴权边界', () => {
    const text = documentText();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
  });

  it('角色白名单恰好九项并与实现一致', () => {
    const text = documentText();
    const section = text.match(/## 角色白名单([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    const documented = [...section.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
    expect(documented).toEqual(expectedRoles);
  });

  it('payload 区分必填字段与可省略 base_sha', () => {
    const text = documentText();
    expect(text).toMatch(/sprint_dir.*必填/);
    expect(text).toMatch(/base_repo.*必填/);
    expect(text).toMatch(/branch.*必填/);
    expect(text).toMatch(/base_sha.*(?:可省略|选填).*生产 Brain.*自解析/);
  });

  it('派发失败包含三个回滚终态', () => {
    const text = documentText();
    expect(text).toContain('run→failed');
    expect(text).toContain('session→closed');
    expect(text).toContain('task→cancelled');
  });

  it('canonical 基线范围只允许新增目标文档', () => {
    const output = execFileSync('git', ['diff', '--name-status', `${BASE}...HEAD`], { encoding: 'utf8' }).trim();
    expect(output).toBe('A\tdocs/current/attempt-run-bridge-guide.md');
  });
});

