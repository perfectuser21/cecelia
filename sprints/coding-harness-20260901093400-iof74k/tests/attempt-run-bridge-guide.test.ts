import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => fs.readFileSync(DOC, 'utf8');
const section = (body: string, title: string) => {
  const marker = `## ${title}`;
  const start = body.indexOf(marker);
  expect(start, `缺少章节：${title}`).toBeGreaterThanOrEqual(0);
  const contentStart = start + marker.length;
  const next = body.indexOf('\n## ', contentStart);
  return body.slice(contentStart, next < 0 ? body.length : next);
};

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('两个端点用途与远端 Bearer 缺失负向约束', () => {
    const text = section(readGuide(), '端点用途与鉴权');
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toMatch(/创建.{0,12}派发/);
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toMatch(/按.{0,8}id.{0,12}查询/);
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/远端[^。\n]*(缺少|未携带|无效)[^。\n]*Bearer[^。\n]*(拒绝|401)/);
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{24,}/);
  });

  it('九项角色白名单恰好列全', () => {
    const text = section(readGuide(), '角色白名单');
    const roles = [...text.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((m) => m[1]);
    expect(roles).toEqual(['planner', 'proposer', 'critic', 'generator', 'generator-fix', 'evaluator', 'evaluator-fix', 'judge', 'reporter']);
    expect(text).not.toMatch(/(?:等|等等)\s*[。；,，]?/);
  });

  it('payload 必填字段与 base_sha 省略语义', () => {
    const text = section(readGuide(), 'payload 字段');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(text).toMatch(new RegExp(`\\b${field}\\b[^。\\n]*必填`));
    }
    expect(text).toMatch(/base_sha[^。\n]*(可省略|可以省略)/);
    expect(text).toMatch(/生产 Brain[^。\n]*自解析/);
    expect(text).not.toMatch(/base_sha[^。\n]*必填/);
  });

  it('派发失败三对象终态且不保留 running', () => {
    const text = section(readGuide(), '派发失败自动回滚');
    expect(text).toContain('run→failed');
    expect(text).toContain('session→closed');
    expect(text).toContain('task→cancelled');
    expect(text).toMatch(/派发失败[^。\n]*(不会|不得)[^。\n]*(running|in_progress)/);
  });
});
