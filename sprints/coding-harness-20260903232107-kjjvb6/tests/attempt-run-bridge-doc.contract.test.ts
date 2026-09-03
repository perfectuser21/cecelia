import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const readDoc = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('文档准确说明两个端点用途且不存在额外主端点', () => {
    const text = readDoc();
    const endpoints = [...text.matchAll(/`(POST|GET) (\/api\/brain\/harness\/attempt-run(?::\/?:id|\/:id)?)`/g)]
      .map((match) => `${match[1]} ${match[2]}`);
    expect([...new Set(endpoints)].sort()).toEqual([
      'GET /api/brain/harness/attempt-run/:id',
      'POST /api/brain/harness/attempt-run',
    ]);
    expect(text).toContain('创建并异步派发');
    expect(text).toContain('按 attempt id 查询');
  });

  it('鉴权正向说明 Bearer 占位符且负向排除真实令牌和远端免鉴权', () => {
    const text = readDoc();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
    expect(text).toMatch(/宿主|远端/);
    expect(text).not.toMatch(/Authorization: Bearer (?!<CECELIA_INTERNAL_TOKEN>)[A-Za-z0-9._~+\/-]{16,}/);
    expect(text).not.toMatch(/(?:宿主|远端).{0,20}(?:免鉴权|无需鉴权)/);
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
