import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const taskRequestHash = '1838c4d9069d5b08f980716d3d248df5f1cd7a8d03b585d3c89b8195798071dc';
const baseSha = '6230da4a13fad9e43d6316b70914b5b69033ef37';
const documentPath = 'docs/current/attempt-run-桥接使用说明.md';

function document(): string {
  return readFileSync(documentPath, 'utf8');
}

function section(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markdown.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  expect(match, `缺少独立章节：${heading}`).not.toBeNull();
  return match![1];
}

function inlineCodeItems(body: string): string[] {
  return [...body.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((match) => match[1]);
}

describe('attempt-run 桥接使用说明合同', () => {
  it('文档完整描述 attempt-run 桥接合同', () => {
    const text = document();
    expect(text).toContain('# attempt-run 桥接使用说明');
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toMatch(/Authorization:\s*Bearer\s+\$\{?CECELIA_INTERNAL_TOKEN\}?/);
    expect(text).toMatch(/POST[\s\S]{0,120}创建[\s\S]{0,80}派发/);
    expect(text).toMatch(/GET[\s\S]{0,120}(查询|轮询)/);
    expect(text).not.toMatch(/Bearer\s+(?!\$\{?CECELIA_INTERNAL_TOKEN\}?)[A-Za-z0-9_\-.]{32,}/);
    expect(taskRequestHash).toHaveLength(64);
  });

  it('角色白名单是恰好九项的封闭集合', () => {
    const body = section(document(), '角色白名单');
    const expected = [
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ];
    expect(inlineCodeItems(body).sort()).toEqual([...expected].sort());
    expect(inlineCodeItems(body)).toHaveLength(9);
    expect(body).toMatch(/白名单外.*拒绝/);
    expect(body).not.toMatch(/(?:以及|等等|等角色|etc\.)/i);
  });

  it('payload 必填集合与 base_sha 可选语义准确', () => {
    const body = section(document(), 'POST payload');
    const required = [...body.matchAll(/^\s*-\s+`([^`]+)`：必填/gm)].map((match) => match[1]);
    expect(required.sort()).toEqual(['base_repo', 'branch', 'sprint_dir'].sort());
    expect(body).toMatch(/`base_sha`：可省略/);
    expect(body).toMatch(/省略.*生产 Brain.*自解析/);
    expect(body).not.toMatch(/调用方.*(?:猜测|自行解析).*base_sha/);
  });

  it('派发失败回滚是封闭三项映射', () => {
    const body = section(document(), '派发失败自动回滚');
    const states = [...body.matchAll(/^\s*-\s+`(run|session|task)\s*→\s*(failed|closed|cancelled)`\s*$/gm)]
      .map((match) => `${match[1]} → ${match[2]}`);
    expect(states).toEqual(['run → failed', 'session → closed', 'task → cancelled']);
    expect(body).toMatch(/GET.*失败终态/);
  });

  it('变更范围仅允许目标文档和本 sprint 合同产物', () => {
    const changed = execFileSync('git', ['diff', '--name-only', `${baseSha}...HEAD`], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    const allowed = /^(docs\/current\/attempt-run-桥接使用说明\.md|sprints\/coding-harness-20260903005419-evol42\/(contract-draft\.md|contract-dod\.md|task-plan\.json|tests\/attempt-run-doc-contract\.test\.ts))$/;
    expect(changed).toContain(documentPath);
    expect(changed.filter((file) => !allowed.test(file))).toEqual([]);
    expect(changed.some((file) => /\.(?:js|cjs|mjs|ts|tsx|jsx)$/.test(file) && !file.endsWith('.test.ts'))).toBe(false);
  });
});

