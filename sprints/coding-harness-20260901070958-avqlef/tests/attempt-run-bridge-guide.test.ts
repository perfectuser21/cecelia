import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const baseline = '5599211397c88c3827d5ce4e9c6061b3802b4fc5';

function guide() {
  return readFileSync(guidePath, 'utf8');
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('中文文档包含两个端点用途与鉴权规则', () => {
    const text = guide();
    expect(text).toMatch(/[\u4e00-\u9fff]/u);
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
  });

  it('角色白名单逐项列出九个 PRD 角色', () => {
    const text = guide();
    for (const role of ['planner', 'proposer', 'skeptic', 'generator', 'generator-fix', 'evaluator', 'judge', 'reporter', 'controller']) {
      expect(text).toContain(`\`${role}\``);
    }
  });

  it('payload 区分三个必填字段与可省略 base_sha', () => {
    const text = guide();
    expect(text).toMatch(/sprint_dir[\s\S]{0,80}必填/u);
    expect(text).toMatch(/base_repo[\s\S]{0,80}必填/u);
    expect(text).toMatch(/branch[\s\S]{0,80}必填/u);
    expect(text).toMatch(/base_sha[\s\S]{0,120}(可省略|可选)[\s\S]{0,120}生产 Brain/u);
  });

  it('派发失败说明完整回滚三个对象终态', () => {
    const text = guide();
    expect(text).toMatch(/run\s*(?:→|->)\s*`?failed`?/u);
    expect(text).toMatch(/session\s*(?:→|->)\s*`?closed`?/u);
    expect(text).toMatch(/task\s*(?:→|->)\s*`?cancelled`?/u);
  });

  it('实现基线之外的产品改动只有目标文档', () => {
    const files = execFileSync('git', ['diff', '--name-only', baseline, '--', '.', ':(exclude)sprints/coding-harness-20260901070958-avqlef/**'], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    expect(files).toEqual([guidePath]);
  });
});
