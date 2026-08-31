import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('文档位于 docs/current 且为中文说明', () => {
    const guide = readGuide();
    expect(guide).toContain('# attempt-run 桥接使用说明');
    expect(guide).toMatch(/[\u4e00-\u9fff]/);
  });

  it('两个端点用途与 internalAuthOrLoopback 鉴权说明完整', () => {
    const guide = readGuide();
    expect(guide).toContain('POST /api/brain/harness/attempt-run');
    expect(guide).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(guide).toContain('internalAuthOrLoopback');
    expect(guide).toContain('Authorization: Bearer CECELIA_INTERNAL_TOKEN');
  });

  it('角色白名单完整列出九项且没有额外角色', () => {
    const guide = readGuide();
    const section = guide.match(/## 角色白名单([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    const roles = [...section.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
  });

  it('payload 必填字段与 base_sha 省略语义完整', () => {
    const guide = readGuide();
    const section = guide.match(/## payload 字段([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(section).toMatch(new RegExp(`\\b${field}\\b[^\\n]*必填`));
    }
    expect(section).toMatch(/base_sha[^\n]*(可省略|选填)/);
    expect(section).toMatch(/生产 Brain[^\n]*自解析/);
  });

  it('派发失败自动回滚三层状态完整', () => {
    const guide = readGuide();
    expect(guide).toContain('run→failed');
    expect(guide).toContain('session→closed');
    expect(guide).toContain('task→cancelled');
  });
});
