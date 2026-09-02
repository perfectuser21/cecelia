import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOC = 'docs/current/attempt-run-bridge-usage.md';
const readDoc = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('说明两个端点及鉴权方式', () => {
    const text = readDoc();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toMatch(/Authorization:\s*Bearer\s+\$CECELIA_INTERNAL_TOKEN/);
    expect(text).toMatch(/宿主|远端/);
  });

  it('列出九项角色白名单', () => {
    const text = readDoc();
    const roles = ['planner', 'proposer', 'challenger', 'generator', 'evaluator', 'judge', 'fixer', 'reporter', 'merger'];
    for (const role of roles) expect(text).toMatch(new RegExp(`\\b${role}\\b`));
    expect(text).toMatch(/白名单外.{0,12}(不接受|拒绝)/);
  });

  it('区分 payload 必填字段与可省略 base_sha', () => {
    const text = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(text).toMatch(new RegExp(`${field}.{0,24}必填`));
    }
    expect(text).toMatch(/base_sha.{0,24}(可省略|省略)/);
    expect(text).toMatch(/base_sha.{0,80}生产 Brain.{0,24}(自解析|解析)/s);
  });

  it('说明派发失败的三对象回滚状态', () => {
    const text = readDoc();
    expect(text).toMatch(/run\s*(?:→|->)\s*failed/);
    expect(text).toMatch(/session\s*(?:→|->)\s*closed/);
    expect(text).toMatch(/task\s*(?:→|->)\s*cancelled/);
  });
});
