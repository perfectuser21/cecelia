import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('说明两个端点用途与远端 Bearer 鉴权', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/Bearer/);
  });

  it('逐项列出九个允许角色', () => {
    const text = readGuide();
    const roles = [
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ];
    for (const role of roles) expect(text).toContain(`\`${role}\``);
  });

  it('区分三个 payload 必填字段与可省略 base_sha', () => {
    const text = readGuide();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(text).toMatch(new RegExp(`\\b${field}\\b[^\\n]*(?:必填|必须)`));
    }
    expect(text).toMatch(/base_sha[^\n]*可省略/);
    expect(text).toMatch(/生产 Brain[^\n]*(?:解析|解析出)/);
    expect(text).not.toMatch(/base_sha[^\n]{0,20}(?:必填|必须)/);
  });

  it('说明派发失败的三个资源回滚终态', () => {
    const text = readGuide();
    expect(text).toContain('run → failed');
    expect(text).toContain('session → closed');
    expect(text).toContain('task → cancelled');
    expect(text).toContain('LAUNCHED');
  });
});

