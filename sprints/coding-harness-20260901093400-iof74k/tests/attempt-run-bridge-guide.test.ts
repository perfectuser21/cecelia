import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('两个端点用途', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toMatch(/POST[^\n]*创建并派发 attempt/);
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toMatch(/GET[^\n]*按 id 查询 attempt 状态/);
  });

  it('鉴权与九项角色白名单', () => {
    const text = readGuide();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
    const section = text.match(/## 角色白名单([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    const roles = [...section.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    expect(roles).toEqual([
      'planner', 'proposer', 'critic', 'generator', 'generator-fix',
      'evaluator', 'evaluator-fix', 'judge', 'reporter',
    ]);
  });

  it('payload 必填字段与 base_sha 省略语义', () => {
    const text = readGuide();
    expect(text).toMatch(/sprint_dir[^\n]*必填/);
    expect(text).toMatch(/base_repo[^\n]*必填/);
    expect(text).toMatch(/branch[^\n]*必填/);
    expect(text).toMatch(/base_sha[^\n]*(可省略|省略)[^\n]*生产 Brain[^\n]*自解析/);
  });

  it('派发失败自动回滚三类终态', () => {
    const text = readGuide();
    expect(text).toContain('run→failed');
    expect(text).toContain('session→closed');
    expect(text).toContain('task→cancelled');
  });
});

