import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const readDoc = () => readFileSync(DOC, 'utf8');
const section = (text: string, title: string) =>
  text.match(new RegExp(`## ${title}([\\s\\S]*?)(?=\\n## |$)`))?.[1] ?? '';

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('端点用途封闭集合为 POST 创建与 GET 查询且排除额外端点', () => {
    const body = section(readDoc(), '端点与用途');
    const endpoints = [...body.matchAll(/^### `([^`]+)`$/gm)].map((m) => m[1]);
    expect(endpoints.sort()).toEqual([
      'GET /api/brain/harness/attempt-run/:id',
      'POST /api/brain/harness/attempt-run',
    ]);
    expect(new Set(endpoints).size).toBe(2);
    expect(body).toContain('创建并异步派发');
    expect(body).toContain('按 attempt id 查询');
  });

  it('宿主和远端分别要求 Bearer 且排除泄密与免鉴权', () => {
    const body = section(readDoc(), '鉴权');
    expect(body).toContain('internalAuthOrLoopback');
    expect(body).toMatch(/^- 宿主：.*`Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`/m);
    expect(body).toMatch(/^- 远端：.*`Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`/m);
    expect(body).not.toMatch(/Authorization: Bearer (?!<CECELIA_INTERNAL_TOKEN>)[A-Za-z0-9._~+\/-]{16,}/);
    expect(body).not.toMatch(/(?:宿主|远端).{0,40}(?:免鉴权|无需鉴权)/);
  });

  it('角色白名单现场计数九项且封闭集合无额外角色', () => {
    const body = section(readDoc(), '角色白名单');
    const roles = [...body.matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]);
    expect(roles).toEqual([
      'planner', 'proposer', 'proposer-critic', 'generator', 'generator-critic',
      'evaluator', 'evaluator-critic', 'reporter', 'reporter-critic',
    ]);
    expect(new Set(roles).size).toBe(9);
  });

  it('payload 必填三项可选一项且排除 base_sha 必填', () => {
    const body = section(readDoc(), 'payload 字段与实现基线');
    const required = [...body.matchAll(/^- `([^`]+)`：必填/gm)].map((m) => m[1]);
    const optional = [...body.matchAll(/^- `([^`]+)`：可省略/gm)].map((m) => m[1]);
    expect(required).toEqual(['sprint_dir', 'base_repo', 'branch']);
    expect(optional).toEqual(['base_sha']);
    expect(body).toContain('生产 Brain 自解析');
    expect(body).toContain('各角色及 GAN 轮次间保持不变');
    expect(body).toContain('workspace_spec.base_sha');
    expect(body).not.toMatch(/`base_sha`：必填/);
  });

  it('派发失败回滚现场计数三个自动终态且排除部分成功', () => {
    const body = section(readDoc(), '派发失败自动回滚');
    const transitions = [...body.matchAll(/^- `([^`]+→[^`]+)`$/gm)].map((m) => m[1]);
    expect(transitions).toEqual(['run→failed', 'session→closed', 'task→cancelled']);
    expect(new Set(transitions).size).toBe(3);
    expect(body).toMatch(/自动/);
    expect(body).not.toMatch(/部分成功/);
    expect(body).not.toMatch(/调用方.{0,12}(?:触发|执行|负责).*回滚/);
  });
});
