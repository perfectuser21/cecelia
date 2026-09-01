import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
let guide: string;

beforeAll(() => {
  guide = readFileSync(DOC, 'utf8');
});

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('说明两个端点用途', () => {
    expect(guide).toContain('POST /api/brain/harness/attempt-run');
    expect(guide).toContain('创建并派发');
    expect(guide).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(guide).toMatch(/按 id 查询.*attempt-run.*状态/s);
  });

  it('说明鉴权且不泄露 token', () => {
    expect(guide).toContain('internalAuthOrLoopback');
    expect(guide).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
    expect(guide).toMatch(/宿主.*远端.*必须.*Bearer/s);
    expect(guide).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{24,}/);
  });

  it('列出九项角色白名单', () => {
    const roles = ['planner', 'proposer', 'critic', 'generator', 'generator-fix', 'evaluator', 'evaluator-fix', 'judge', 'reporter'];
    expect(guide).toMatch(/角色白名单/);
    for (const role of roles) expect(guide).toContain(`\`${role}\``);
  });

  it('说明 payload 必填与 base_sha 省略语义', () => {
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(guide).toMatch(new RegExp(`${field}.{0,40}必填`, 's'));
    }
    expect(guide).toMatch(/base_sha.{0,40}可省略.{0,80}生产 Brain.{0,20}自解析/s);
  });

  it('说明派发失败三对象回滚', () => {
    expect(guide).toMatch(/派发失败.*自动回滚/s);
    for (const state of ['run → failed', 'session → closed', 'task → cancelled']) {
      expect(guide).toContain(state);
    }
  });
});
