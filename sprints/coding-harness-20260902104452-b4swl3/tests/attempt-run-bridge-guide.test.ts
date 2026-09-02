import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const readDoc = () => readFileSync(DOC, 'utf8');
const section = (doc: string, heading: string) => {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = doc.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  expect(match, `缺少独立章节：${heading}`).not.toBeNull();
  return match![1];
};

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('包含两个端点用途与鉴权要求，并拒绝匿名远端表述', () => {
    const body = section(readDoc(), '端点用途与鉴权');
    for (const value of ['POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id', 'internalAuthOrLoopback', 'Authorization: Bearer $CECELIA_INTERNAL_TOKEN']) expect(body).toContain(value);
    expect(body).toMatch(/POST[^。\n]*创建[^。\n]*派发/);
    expect(body).toMatch(/GET[^。\n]*查询/);
    expect(body).toMatch(/宿主[^。\n]*远端[^。\n]*必须[^。\n]*Bearer/);
    expect(body).not.toMatch(/宿主|远端[^。\n]*(无需鉴权|匿名访问)/);
    expect(body).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{32,}/);
  });

  it('包含且仅声明权威实现的九项角色白名单，并排除白名单外角色', () => {
    const body = section(readDoc(), '角色白名单');
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    const listed = [...body.matchAll(/^- `([a-z-]+)`\s*$/gm)].map((match) => match[1]);
    expect(listed).toEqual(roles);
    expect(new Set(listed).size).toBe(9);
    for (const forbidden of ['critic', 'evaluator-fix', 'merger', 'reporter']) expect(listed).not.toContain(forbidden);
    expect(body).toMatch(/白名单外[^。\n]*不被接受/);
  });

  it('包含 payload 必填字段与 base_sha 省略语义，并拒绝错误必填表述', () => {
    const body = section(readDoc(), 'payload 字段');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) expect(body).toMatch(new RegExp('`' + field + '`[^。\\n]*必填'));
    expect(body).toMatch(/`base_sha`[^。\n]*可省略/);
    expect(body).toMatch(/省略[^。\n]*生产 Brain[^。\n]*自解析/);
    expect(body).not.toMatch(/`base_sha`[^。\n]*必填/);
  });

  it('包含派发失败的三类回滚终态，并排除活跃残留', () => {
    const body = section(readDoc(), '派发失败自动回滚');
    for (const value of ['run→failed', 'session→closed', 'task→cancelled']) expect(body).toContain(value);
    expect(body).toMatch(/不得[^。\n]*(运行中 session|待执行 task)/);
    expect(body).not.toMatch(/派发失败[^。\n]*(run→running|session→active|task→queued)/);
  });
});
