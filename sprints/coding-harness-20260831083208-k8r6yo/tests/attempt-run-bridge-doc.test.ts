import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const docPath = 'docs/current/attempt-run-bridge.md';
const readDoc = () => readFileSync(docPath, 'utf8');

describe('attempt-run 桥接使用说明', () => {
  it('说明创建与查询端点用途和鉴权边界', () => {
    const text = readDoc();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9._~-]{24,}/);
  });

  it('逐项列出生产角色白名单九项且不多不少', () => {
    const text = readDoc();
    const section = text.match(/## 角色白名单\s*([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    const roles = [...section.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
  });

  it('说明 payload 必填字段与 base_sha 省略语义', () => {
    const text = readDoc();
    expect(text).toMatch(/sprint_dir[\s\S]*必填/);
    expect(text).toMatch(/base_repo[\s\S]*必填/);
    expect(text).toMatch(/branch[\s\S]*必填/);
    expect(text).toMatch(/base_sha[\s\S]*(可省略|非必填)[\s\S]*生产 Brain[\s\S]*解析/);
  });

  it('说明派发失败自动回滚的三个终态', () => {
    const text = readDoc();
    expect(text).toMatch(/run[^\n]*failed/);
    expect(text).toMatch(/session[^\n]*closed/);
    expect(text).toMatch(/task[^\n]*cancelled/);
  });
});
