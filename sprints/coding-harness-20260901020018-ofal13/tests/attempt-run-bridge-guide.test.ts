import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';

function documentText(): string {
  return readFileSync(DOC, 'utf8');
}

function section(text: string, heading: string): string {
  const after = text.split(heading)[1];
  if (!after) return '';
  return after.split('\n## ')[0];
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('包含两个端点用途与严格鉴权语义', () => {
    const text = section(documentText(), '## 端点用途与鉴权');
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('创建');
    expect(text).toContain('派发');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('按 id 查询');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('宿主或远端');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
  });

  it('角色白名单恰为九项且字面匹配', () => {
    const text = section(documentText(), '## 角色白名单');
    const roles = [...text.matchAll(/^[-*] `([^`]+)`$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
  });

  it('payload 仅三项必填且 base_sha 可省略', () => {
    const text = section(documentText(), '## payload 字段');
    const required = [...text.matchAll(/^[-*] `([^`]+)`：必填$/gm)].map((match) => match[1]);
    expect(required).toEqual(['sprint_dir', 'base_repo', 'branch']);
    expect(text).toContain('`base_sha`：可省略');
    expect(text).toContain('由生产 Brain 自解析');
  });

  it('派发失败回滚三元组完整', () => {
    const text = section(documentText(), '## 派发失败自动回滚');
    expect(text).toContain('run→failed');
    expect(text).toContain('session→closed');
    expect(text).toContain('task→cancelled');
  });
});

