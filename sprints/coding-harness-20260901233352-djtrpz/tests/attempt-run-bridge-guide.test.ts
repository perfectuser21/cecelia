import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('文档包含两个端点用途与远端鉴权约束', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
  });

  it('文档逐项列出恰好九项角色白名单', () => {
    const text = readGuide();
    const section = text.match(/## 角色白名单([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    const roles = [...section.matchAll(/^\s*[-*]\s+`([^`]+)`\s*$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
  });

  it('文档区分 payload 必填字段与可省略 base_sha', () => {
    const text = readGuide();
    expect(text).toMatch(/sprint_dir[\s\S]*base_repo[\s\S]*branch[\s\S]*必填/);
    expect(text).toMatch(/base_sha[\s\S]{0,80}(可省略|非必填)/);
    expect(text).toContain('生产 Brain 自解析');
  });

  it('文档完整说明派发失败自动回滚的三个终态', () => {
    const text = readGuide();
    expect(text).toContain('run→failed');
    expect(text).toContain('session→closed');
    expect(text).toContain('task→cancelled');
  });
});
