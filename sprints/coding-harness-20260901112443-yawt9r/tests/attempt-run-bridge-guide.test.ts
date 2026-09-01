import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const path = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(path, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('中文文档且位于唯一允许路径', () => {
    expect(readGuide()).toMatch(/[\u4e00-\u9fff]/);
  });

  it('两个端点用途与鉴权合同完整', () => {
    const text = readGuide();
    for (const value of [
      'POST /api/brain/harness/attempt-run', '创建', '派发',
      'GET /api/brain/harness/attempt-run/:id', '查询',
      'internalAuthOrLoopback', 'Authorization: Bearer $CECELIA_INTERNAL_TOKEN',
      '宿主', '远端',
    ]) expect(text).toContain(value);
  });

  it('九项角色白名单逐项出现', () => {
    const text = readGuide();
    expect(text).toContain('白名单');
    for (const role of [
      'planner', 'proposer', 'critic', 'generator', 'generator-fix',
      'evaluator', 'evaluator-fix', 'judge', 'reporter',
    ]) expect(text).toContain(role);
  });

  it('payload 必填字段与 base_sha 省略语义', () => {
    const text = readGuide();
    for (const value of [
      'sprint_dir', 'base_repo', 'branch', '必填',
      'base_sha', '可省略', '生产 Brain', '自解析',
    ]) expect(text).toContain(value);
  });

  it('派发失败三对象自动回滚状态完整', () => {
    const text = readGuide().replace(/`/g, '').replace(/\s+/g, ' ');
    expect(text).toMatch(/自动回滚/);
    expect(text).toMatch(/run\s*(?:→|->)\s*failed/);
    expect(text).toMatch(/session\s*(?:→|->)\s*closed/);
    expect(text).toMatch(/task\s*(?:→|->)\s*cancelled/);
  });
});

