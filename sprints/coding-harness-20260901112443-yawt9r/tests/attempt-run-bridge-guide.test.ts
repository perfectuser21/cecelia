import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('B-01 两个端点及用途完整', () => {
    const guide = readGuide();
    expect(guide).toContain('POST /api/brain/harness/attempt-run');
    expect(guide).toMatch(/创建并派发/);
    expect(guide).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(guide).toMatch(/按 id 查询|按 `id` 查询/);
  });

  it('B-02 鉴权与九项角色白名单完整', () => {
    const guide = readGuide();
    expect(guide).toContain('internalAuthOrLoopback');
    expect(guide).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
    expect(guide).toMatch(/宿主.*远端|远端.*宿主/s);
    expect(guide).toMatch(/九项角色白名单/);
    for (const role of [
      'planner', 'proposer', 'critic', 'generator', 'generator-fix',
      'evaluator', 'evaluator-fix', 'judge', 'reporter',
    ]) expect(guide).toContain(`\`${role}\``);
  });

  it('B-03 payload 必填与 base_sha 缺省语义完整', () => {
    const guide = readGuide();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(guide).toMatch(new RegExp(`\\\`${field}\\\`.{0,40}必填`, 's'));
    }
    expect(guide).toMatch(/`base_sha`.{0,40}可省略.{0,80}生产 Brain.{0,30}自解析/s);
  });

  it('B-04 派发失败三对象自动回滚完整', () => {
    const compact = readGuide().replace(/\s/g, '');
    expect(compact).toContain('派发失败');
    expect(compact).toContain('自动回滚');
    expect(compact).toContain('run→failed');
    expect(compact).toContain('session→closed');
    expect(compact).toContain('task→cancelled');
  });

  it('B-05 中文文档且无真实 token', () => {
    const guide = readGuide();
    expect(guide).toMatch(/[\u4e00-\u9fff]{20}/);
    const withoutPlaceholder = guide.replaceAll('Bearer $CECELIA_INTERNAL_TOKEN', '');
    expect(withoutPlaceholder).not.toMatch(/Bearer\s+[A-Za-z0-9_.-]{24,}/);
  });
});

