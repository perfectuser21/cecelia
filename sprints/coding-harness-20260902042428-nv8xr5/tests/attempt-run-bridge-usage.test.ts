import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-usage.md';
const readDoc = () => readFileSync(DOC, 'utf8');
const section = (doc: string, heading: string) => {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = doc.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  expect(match, `缺少独立章节：${heading}`).not.toBeNull();
  return match![1];
};

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('包含两个端点用途与鉴权要求', () => {
    const doc = readDoc();
    const body = section(doc, '端点用途与鉴权');
    expect(body).toContain('POST /api/brain/harness/attempt-run');
    expect(body).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(body).toContain('internalAuthOrLoopback');
    expect(body).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
    expect(body).toMatch(/POST[\s\S]*创建|创建[\s\S]*POST/);
    expect(body).toMatch(/GET[\s\S]*查询|查询[\s\S]*GET/);
    expect(body).toMatch(/宿主[\s\S]*远端[\s\S]*Bearer/);
  });

  it('包含且仅声明冻结的九项角色白名单', () => {
    const doc = readDoc();
    const body = section(doc, '角色白名单');
    const roles = ['planner', 'proposer', 'challenger', 'generator', 'evaluator', 'judge', 'fixer', 'reporter', 'merger'];
    const listed = [...body.matchAll(/^- `([a-z]+)`\s*$/gm)].map((match) => match[1]);
    expect(listed).toEqual(roles);
    expect(body).toMatch(/九项/);
    expect(body).toMatch(/白名单外[^。\n]*不被接受/);
  });

  it('包含 payload 必填字段与 base_sha 省略语义', () => {
    const doc = readDoc();
    const body = section(doc, 'payload 字段');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(body).toMatch(new RegExp('`' + field + '`[^。\\n]*必填'));
    }
    expect(body).toMatch(/`base_sha`[^。\n]*可省略/);
    expect(body).toMatch(/省略[^。\n]*生产 Brain[^。\n]*自解析/);
  });

  it('包含派发失败的三类回滚终态', () => {
    const doc = readDoc();
    const body = section(doc, '派发失败自动回滚');
    expect(body).toContain('run→failed');
    expect(body).toContain('session→closed');
    expect(body).toContain('task→cancelled');
  });
});
