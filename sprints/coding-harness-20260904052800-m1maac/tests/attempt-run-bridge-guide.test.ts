import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');
const roles = [
  'canary', 'planner', 'proposer', 'reviewer', 'generator',
  'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
];

function listedCodeItems(text: string, heading: string): string[] {
  const section = text.split(heading)[1]?.split('\n## ')[0] ?? '';
  return [...section.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1]);
}

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('中文文档包含两个端点用途，且错误端点不能通过', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('创建并派发');
    expect(text).toContain('按 id 查询');
    expect(text).not.toContain('GET /api/brain/harness/attempt-runs/:id');
  });

  it('鉴权区分 loopback 与宿主远端，且远端免鉴权不能通过', () => {
    const text = readGuide();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/宿主|远端/);
    expect(text).not.toMatch(/(?:宿主|远端)[^。\n]{0,30}(?:免鉴权|无需鉴权)/);
  });

  it('角色白名单逐项列出且恰好九项，增删角色不能通过', () => {
    const listed = listedCodeItems(readGuide(), '## 角色白名单');
    for (const role of roles) expect(listed).toContain(role);
    expect(listed).toHaveLength(9);
    expect(listed).toEqual(roles);
    expect(listed).not.toContain('commander');
  });

  it('payload 必填项逐项列出且恰好三项，base_sha 列为可省略', () => {
    const text = readGuide();
    const required = listedCodeItems(text, '### 必填字段');
    expect(required).toEqual(['sprint_dir', 'base_repo', 'branch']);
    expect(required).toHaveLength(3);
    expect(required).not.toContain('base_sha');
    expect(text).toMatch(/`base_sha`[^。\n]{0,40}可省略/);
    expect(text).toMatch(/生产 Brain[^。\n]{0,40}自解析/);
  });

  it('派发失败回滚逐项列出且恰好三个终态，缺项或错态不能通过', () => {
    const rollback = listedCodeItems(readGuide(), '## 派发失败自动回滚');
    expect(rollback).toEqual(['run→failed', 'session→closed', 'task→cancelled']);
    expect(rollback).toHaveLength(3);
    expect(rollback).not.toContain('task→completed');
  });
});
