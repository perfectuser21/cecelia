import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';

function documentText(): string {
  return readFileSync(DOC, 'utf8');
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('文档说明 POST 与 GET 端点用途和 internalAuthOrLoopback 鉴权', () => {
    const text = documentText();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
  });

  it('文档逐项列出九个角色白名单', () => {
    const text = documentText();
    for (const role of ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge']) {
      expect(text).toContain(`\`${role}\``);
    }
  });

  it('文档说明 payload 三个必填字段和 base_sha 省略语义', () => {
    const text = documentText();
    expect(text).toMatch(/payload[\s\S]*sprint_dir[\s\S]*base_repo[\s\S]*branch/);
    expect(text).toMatch(/base_sha[\s\S]*(可省略|省略)/);
    expect(text).toMatch(/生产 Brain[\s\S]*(自行|自动)解析/);
  });

  it('文档说明派发失败自动回滚 run session task', () => {
    const text = documentText();
    expect(text).toContain('run → `failed`');
    expect(text).toContain('session → `closed`');
    expect(text).toContain('task → `cancelled`');
  });
});
