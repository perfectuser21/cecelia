import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge.md';
const readDoc = () => readFileSync(DOC, 'utf8');
const section = (text: string, heading: string) => {
  const match = text.match(new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |$)`, 'm'));
  expect(match, `缺少章节：${heading}`).not.toBeNull();
  return match![1];
};

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('两个端点用途与 Bearer 鉴权正反边界', () => {
    const text = section(readDoc(), '端点用途与鉴权');
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toMatch(/POST[\s\S]*(创建|派发)/);
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toMatch(/GET[\s\S]*(查询|轮询)/);
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/宿主|远端/);
    expect(text).not.toMatch(/宿主或远端.{0,20}(无需|不需要|可以不).{0,10}(Bearer|Token)/);
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{24,}/);
  });

  it('角色白名单恰好九项且拒绝白名单外角色', () => {
    const text = section(readDoc(), '角色白名单');
    const roles = [...text.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
    expect(new Set(roles).size).toBe(9);
    expect(text).toMatch(/白名单外.{0,20}(拒绝|role_not_allowed)/);
    expect(roles).not.toContain('commander');
    expect(roles).not.toContain('publisher');
  });

  it('payload 必填集合恰好三项且 base_sha 可省略', () => {
    const text = section(readDoc(), 'payload 字段');
    const required = [...text.matchAll(/^- `([^`]+)`：必填/gm)].map((match) => match[1]);
    expect(required).toEqual(['sprint_dir', 'base_repo', 'branch']);
    expect(new Set(required).size).toBe(3);
    expect(text).toMatch(/`base_sha`：可省略/);
    expect(text).toMatch(/生产 Brain.{0,20}自解析/);
    expect(text).not.toMatch(/`base_sha`：必填/);
    expect(text).not.toMatch(/调用方.{0,20}(固定|解析).{0,10}`base_sha`/);
  });

  it('派发失败回滚三项终态完整且没有错误终态', () => {
    const text = section(readDoc(), '派发失败自动回滚');
    const transitions = [...text.matchAll(/^- `(run|session|task)→([^`]+)`$/gm)]
      .map((match) => `${match[1]}→${match[2]}`);
    expect(transitions).toEqual(['run→failed', 'session→closed', 'task→cancelled']);
    expect(new Set(transitions).size).toBe(3);
    expect(text).not.toMatch(/run→(done|completed)|session→active|task→(queued|completed)/);
    expect(text).not.toContain('部分成功');
  });
});
