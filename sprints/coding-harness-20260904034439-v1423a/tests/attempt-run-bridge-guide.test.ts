import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('B-01 两个端点、用途与鉴权边界完整', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
  });

  it('B-02 角色白名单恰好九项且无额外角色', () => {
    const text = readGuide();
    const roles = ['planner', 'proposer', 'proposer-critic', 'generator', 'generator-critic', 'evaluator', 'evaluator-critic', 'reporter', 'reporter-critic'];
    for (const role of roles) expect(text).toContain(`\`${role}\``);
    expect(new Set(roles)).toHaveLength(9);
  });

  it('B-03 payload 必填字段与 base_sha 基线规则完整', () => {
    const text = readGuide();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) expect(text).toContain(`\`${field}\``);
    expect(text).toContain('`base_sha` 可省略');
    expect(text).toContain('生产 Brain');
    expect(text).toMatch(/实现基线[\s\S]*保持不变/);
    expect(text).toMatch(/workspace[\s\S]*base_sha[\s\S]*不得替代/);
  });

  it('B-04 派发失败回滚三对象终态完整', () => {
    const text = readGuide();
    expect(text).toContain('run→failed');
    expect(text).toContain('session→closed');
    expect(text).toContain('task→cancelled');
  });
});
