import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('两个端点用途与 Bearer 鉴权说明完整', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
  });

  it('角色白名单恰为生产代码定义的九项封闭集合', () => {
    const text = readGuide();
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    const section = text.match(/## 角色白名单([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    expect(roles.every((role) => section.includes(`\`${role}\``))).toBe(true);
    expect((section.match(/^\d+\. `/gm) ?? [])).toHaveLength(9);
    expect(section).not.toMatch(/`(?:critic|merger|reporter)`/);
  });

  it('payload 必填字段与 base_sha 省略语义完整', () => {
    const section = readGuide().match(/## payload 字段([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    for (const field of ['sprint_dir', 'base_repo', 'branch']) expect(section).toContain(`\`${field}\``);
    expect(section).toContain('`base_sha` 可省略');
    expect(section).toContain('生产 Brain 自解析');
  });

  it('派发失败回滚三项终态完整', () => {
    const section = readGuide().match(/## 派发失败自动回滚([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    expect(section).toContain('run → failed');
    expect(section).toContain('session → closed');
    expect(section).toContain('task → cancelled');
  });
});
