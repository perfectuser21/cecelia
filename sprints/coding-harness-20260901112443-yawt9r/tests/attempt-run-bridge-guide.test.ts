import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(guidePath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('两个端点用途与 internalAuthOrLoopback 鉴权说明完整', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('创建并派发');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('按 id 查询');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toMatch(/宿主机|宿主/);
    expect(text).toContain('远端');
    expect(text).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
  });

  it('九项角色白名单逐项列全且无缺项', () => {
    const text = readGuide();
    const roles = ['planner', 'proposer', 'critic', 'generator', 'generator-fix', 'evaluator', 'evaluator-fix', 'judge', 'reporter'];
    expect(text).toContain('角色白名单');
    for (const role of roles) expect(text).toMatch(new RegExp('`' + role + '`'));
  });

  it('payload 必填字段与 base_sha 可省略语义完整', () => {
    const text = readGuide();
    expect(text).toMatch(/payload[\s\S]*必填/);
    for (const field of ['sprint_dir', 'base_repo', 'branch']) expect(text).toMatch(new RegExp('`' + field + '`'));
    expect(text).toMatch(/`base_sha`[\s\S]{0,100}可省略/);
    expect(text).toMatch(/生产 Brain[\s\S]{0,40}自解析/);
  });

  it('派发失败自动回滚三对象最终状态完整', () => {
    const text = readGuide();
    expect(text).toContain('派发失败');
    expect(text).toMatch(/run\s*(?:→|->)\s*`?failed`?/);
    expect(text).toMatch(/session\s*(?:→|->)\s*`?closed`?/);
    expect(text).toMatch(/task\s*(?:→|->)\s*`?cancelled`?/);
  });
});
