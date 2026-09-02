import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('中文文档说明 POST 创建与 GET 查询端点及鉴权边界', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
    expect(text).toMatch(/[\u4e00-\u9fff]/);
  });

  it('角色白名单使用封闭枚举且恰好列出九项角色', () => {
    const text = readGuide();
    const section = text.match(/## 角色白名单\s*([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    const roles = [...section.matchAll(/^\d+\. `([^`]+)`$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
    expect(section).not.toMatch(/等(?:角色)?|其他角色/);
  });

  it('payload 精确区分三个必填字段与可省略 base_sha', () => {
    const text = readGuide();
    const section = text.match(/## payload 字段\s*([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    expect(section).toMatch(/`sprint_dir`[^\n]*必填/);
    expect(section).toMatch(/`base_repo`[^\n]*必填/);
    expect(section).toMatch(/`branch`[^\n]*必填/);
    expect(section).toMatch(/`base_sha`[^\n]*(可省略|选填)[^\n]*生产 Brain[^\n]*自解析/);
    expect(section).not.toMatch(/`base_sha`[^\n]*必填/);
  });

  it('派发失败回滚同时给出 run session task 三个终态', () => {
    const section = readGuide().match(/## 派发失败自动回滚\s*([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    expect(section).toContain('run→failed');
    expect(section).toContain('session→closed');
    expect(section).toContain('task→cancelled');
  });
});
