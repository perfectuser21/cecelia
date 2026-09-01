import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const GUIDE = 'docs/current/attempt-run-bridge-guide.md';
const EXPECTED_ROLES = [
  'planner', 'proposer', 'skeptic', 'generator', 'generator-fix',
  'evaluator', 'judge', 'reporter', 'controller',
];

function guide(): string {
  expect(existsSync(GUIDE), `${GUIDE} 必须存在`).toBe(true);
  return readFileSync(GUIDE, 'utf8');
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('文档为中文并说明 POST 派发与 GET 状态查询用途', () => {
    const text = guide();
    expect(text).toMatch(/[\u4e00-\u9fff]/);
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toMatch(/派发/);
    expect(text).toMatch(/查询|轮询/);
  });

  it('文档说明 internalAuthOrLoopback 与远端 Bearer CECELIA_INTERNAL_TOKEN', () => {
    const text = guide();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/宿主|远端/);
  });

  it('文档角色白名单恰好列出九个 PRD 角色', () => {
    const text = guide();
    const section = text.match(/## 角色白名单([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    const listed = [...section.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((match) => match[1]);
    expect(listed).toEqual(EXPECTED_ROLES);
  });

  it('文档区分三个 payload 必填字段与可省略的 base_sha', () => {
    const text = guide();
    const section = text.match(/## Payload 字段([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(section).toMatch(new RegExp(`\\b${field}\\b[^\\n]*必填`));
    }
    expect(section).toMatch(/\bbase_sha\b[^\n]*(可省略|可选)/);
    expect(section).toMatch(/base_sha[^\n]*生产 Brain[^\n]*自解析/);
  });

  it('文档说明派发失败的 run session task 完整回滚终态', () => {
    const text = guide();
    expect(text).toMatch(/run\s*(?:→|->)\s*`?failed`?/);
    expect(text).toMatch(/session\s*(?:→|->)\s*`?closed`?/);
    expect(text).toMatch(/task\s*(?:→|->)\s*`?cancelled`?/);
  });
});
