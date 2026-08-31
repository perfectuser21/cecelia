import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOC = 'docs/current/attempt-run-bridge-guide.md';

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('文档覆盖端点、鉴权、九项角色、payload 与失败回滚', () => {
    const content = readFileSync(DOC, 'utf8');

    expect(content).toMatch(/[\u4e00-\u9fff]/);
    expect(content).toContain('POST /api/brain/harness/attempt-run');
    expect(content).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(content).toContain('internalAuthOrLoopback');
    expect(content).toContain('Authorization: Bearer');
    expect(content).toContain('CECELIA_INTERNAL_TOKEN');

    const roles = [
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ];
    for (const role of roles) expect(content).toContain(role);

    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(content).toMatch(new RegExp(`${field}[^\\n]{0,40}必填`));
    }
    expect(content).toMatch(/base_sha[^\n]{0,60}可省略/);
    expect(content).toContain('生产 Brain 自解析');
    expect(content).toContain('run → failed');
    expect(content).toContain('session → closed');
    expect(content).toContain('task → cancelled');
  });
});
