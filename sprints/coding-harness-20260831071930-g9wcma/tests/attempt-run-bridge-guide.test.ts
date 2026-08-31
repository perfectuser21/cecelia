import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';

function readGuide(): string {
  return readFileSync(guidePath, 'utf8');
}

describe('attempt-run 桥接使用说明文档', () => {
  it('说明 POST 与 GET 两个端点用途和 Bearer 鉴权', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
  });

  it('逐项列出九项角色白名单', () => {
    const text = readGuide();
    const roles = [
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ];
    for (const role of roles) expect(text).toMatch(new RegExp(`\\b${role}\\b`));
  });

  it('说明 payload 三个必填字段与 base_sha 省略语义', () => {
    const text = readGuide();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(text).toMatch(new RegExp(`必填[^\\n]*${field}|${field}[^\\n]*必填`));
    }
    expect(text).toMatch(/base_sha[^\n]*(可省略|非必填)[^\n]*生产 Brain[^\n]*(解析|补全)/);
  });

  it('说明派发失败自动回滚的三项终态', () => {
    const text = readGuide();
    expect(text).toMatch(/派发失败[^\n]*自动回滚/);
    expect(text).toMatch(/run[^\n]*failed/);
    expect(text).toMatch(/session[^\n]*closed/);
    expect(text).toMatch(/task[^\n]*cancelled/);
  });
});
