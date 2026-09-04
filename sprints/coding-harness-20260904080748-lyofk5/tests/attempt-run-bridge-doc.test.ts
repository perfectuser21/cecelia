import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const docPath = 'docs/current/attempt-run-bridge.md';
const readDoc = () => readFileSync(docPath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('两个端点用途与 internalAuthOrLoopback 鉴权说明完整', () => {
    const text = readDoc();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
  });

  it('角色白名单恰好等于生产九项封闭集合', () => {
    const text = readDoc();
    const block = text.match(/<!-- roles:start -->([\s\S]*?)<!-- roles:end -->/)?.[1] ?? '';
    const roles = [...block.matchAll(/^\s*- `([^`]+)`\s*$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
    expect(roles).not.toContain('reporter');
  });

  it('payload 必填字段与 base_sha 可省略规则完整且无反向误述', () => {
    const text = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(text).toMatch(new RegExp(`\\b${field}\\b[^\\n]*(必填|必须)`));
    }
    expect(text).toMatch(/base_sha[^\n]*(可省略|非必填)/);
    expect(text).toMatch(/base_sha[^\n]*生产 Brain[^\n]*自解析/);
    expect(text).not.toMatch(/base_sha[^\n]*(必须提供|必填)/);
  });

  it('派发失败回滚终态等于 run failed session closed task cancelled', () => {
    const text = readDoc();
    const block = text.match(/<!-- rollback:start -->([\s\S]*?)<!-- rollback:end -->/)?.[1] ?? '';
    expect(block).toMatch(/run\s*(?:→|->)\s*`?failed`?/);
    expect(block).toMatch(/session\s*(?:→|->)\s*`?closed`?/);
    expect(block).toMatch(/task\s*(?:→|->)\s*`?cancelled`?/);
    expect(block).not.toMatch(/run\s*(?:→|->)\s*`?(?:done|completed)`?/);
    expect(block).not.toMatch(/session\s*(?:→|->)\s*`?active`?/);
    expect(block).not.toMatch(/task\s*(?:→|->)\s*`?(?:queued|in_progress|completed)`?/);
  });
});
