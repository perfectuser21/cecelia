import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('POST /api/brain/harness/attempt-run 用于创建运行', () => {
    const text = readGuide();
    const section = text.match(/## 端点用途与鉴权\s*([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    expect(section).toMatch(/POST `?\/api\/brain\/harness\/attempt-run`?[^\n]*(创建|新建)[^\n]*运行/);
  });

  it('GET /api/brain/harness/attempt-run/:id 用于查询状态', () => {
    const text = readGuide();
    const section = text.match(/## 端点用途与鉴权\s*([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    expect(section).toMatch(/GET `?\/api\/brain\/harness\/attempt-run\/:id`?[^\n]*(查询|获取)[^\n]*状态/);
  });

  it('两个端点说明 internalAuthOrLoopback 鉴权边界', () => {
    const text = readGuide();
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
