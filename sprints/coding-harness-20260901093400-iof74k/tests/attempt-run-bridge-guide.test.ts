import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明冻结文档契约', () => {
  it('文档包含两个端点用途与 Bearer 鉴权说明', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toMatch(/Authorization:\s*Bearer\s+\$CECELIA_INTERNAL_TOKEN/);
  });

  it('角色白名单恰好列出 PRD 指定的九项角色', () => {
    const text = readGuide();
    const section = text.match(/## 角色白名单([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    const roles = [...section.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    expect(roles).toEqual([
      'planner', 'proposer', 'critic', 'generator', 'generator-fix',
      'evaluator', 'evaluator-fix', 'judge', 'reporter',
    ]);
  });

  it('payload 说明三个必填字段且 base_sha 可省略并由生产 Brain 自解析', () => {
    const text = readGuide();
    const section = text.match(/## POST payload([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(section).toMatch(new RegExp(`\\b${field}\\b[^\\n]*(必填|required)`, 'i'));
    }
    expect(section).toMatch(/base_sha[^\n]*(可省略|非必填)[^\n]*生产 Brain[^\n]*自解析/);
  });

  it('派发失败说明 run session task 三类对象的自动回滚终态', () => {
    const text = readGuide();
    const section = text.match(/## 派发失败自动回滚([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    expect(section).toContain('run→failed');
    expect(section).toContain('session→closed');
    expect(section).toContain('task→cancelled');
  });
});
