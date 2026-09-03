import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const readDoc = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('完整解析端点章节且主端点集合恰为 POST 与 GET 两项', () => {
    const text = readDoc();
    const section = text.match(/## 端点与用途([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    const endpoints = [...section.matchAll(/^### `([^`]+)`$/gm)].map((match) => match[1]);
    expect(endpoints.sort()).toEqual([
      'GET /api/brain/harness/attempt-run/:id',
      'POST /api/brain/harness/attempt-run',
    ]);
    expect(new Set(endpoints).size).toBe(2);
    expect(section).toContain('创建并异步派发');
    expect(section).toContain('按 attempt id 查询');
  });

  it('宿主和远端分别要求 Bearer 且负向排除泄密与免鉴权', () => {
    const text = readDoc();
    const section = text.match(/## 鉴权([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    expect(section).toContain('internalAuthOrLoopback');
    expect(section).toMatch(/^- 宿主：.*`Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`/m);
    expect(section).toMatch(/^- 远端：.*`Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`/m);
    expect(section).not.toMatch(/Authorization: Bearer (?!<CECELIA_INTERNAL_TOKEN>)[A-Za-z0-9._~+\/-]{16,}/);
    expect(section).not.toMatch(/(?:宿主|远端).{0,40}(?:免鉴权|无需鉴权)/);
  });

  it('角色白名单现场计数为九项且封闭集合无别名', () => {
    const text = readDoc();
    const section = text.match(/## 角色白名单([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    const roles = [...section.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
    expect(new Set(roles).size).toBe(9);
  });

  it('payload 必填三项可选一项并排除 base_sha 必填', () => {
    const text = readDoc();
    const section = text.match(/## payload 字段([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    const required = [...section.matchAll(/^- `([^`]+)`：必填/gm)].map((match) => match[1]);
    const optional = [...section.matchAll(/^- `([^`]+)`：可省略/gm)].map((match) => match[1]);
    expect(required).toEqual(['sprint_dir', 'base_repo', 'branch']);
    expect(optional).toEqual(['base_sha']);
    expect(section).toContain('生产 Brain 自行解析');
    expect(section).not.toMatch(/`base_sha`：必填/);
  });

  it('派发失败回滚现场计数为三个自动终态且排除调用方触发', () => {
    const text = readDoc();
    const section = text.match(/## 派发失败自动回滚([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    const transitions = [...section.matchAll(/^- `([^`]+→[^`]+)`$/gm)].map((match) => match[1]);
    expect(transitions).toEqual(['run→failed', 'session→closed', 'task→cancelled']);
    expect(new Set(transitions).size).toBe(3);
    expect(section).toMatch(/自动/);
    expect(section).not.toMatch(/调用方.{0,12}(?:触发|执行|负责).*回滚/);
  });
});
