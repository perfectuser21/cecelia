import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const readDoc = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('说明两个端点用途与鉴权', () => {
    const text = readDoc();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer');
    expect(text).toContain('CECELIA_INTERNAL_TOKEN');
  });

  it('完整列出九项角色白名单', () => {
    const text = readDoc();
    const roles = [
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ];
    for (const role of roles) expect(text).toContain(`\`${role}\``);
  });

  it('说明 payload 必填字段与 base_sha 省略规则', () => {
    const text = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch', 'base_sha']) {
      expect(text).toContain(`\`${field}\``);
    }
    expect(text).toContain('可省略');
    expect(text).toContain('生产 Brain');
  });

  it('说明派发失败的三资源回滚终态', () => {
    const text = readDoc();
    for (const value of ['run', '`failed`', 'session', '`closed`', 'task', '`cancelled`']) {
      expect(text).toContain(value);
    }
  });
});
