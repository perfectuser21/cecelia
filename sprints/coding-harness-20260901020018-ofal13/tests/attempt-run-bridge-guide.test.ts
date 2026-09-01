import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('文档完整覆盖端点、鉴权、九角色、payload 与失败回滚', () => {
    const text = readFileSync(DOC, 'utf8');
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');

    const roles = [
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ];
    for (const role of roles) expect(text).toContain(`\`${role}\``);

    expect(text).toMatch(/sprint_dir[\s\S]*base_repo[\s\S]*branch/);
    expect(text).toMatch(/base_sha[\s\S]{0,80}(可省略|选填)/);
    expect(text).toMatch(/生产 Brain[\s\S]{0,80}(解析|补全)/);
    expect(text).toMatch(/run[\s\S]{0,40}failed[\s\S]{0,40}session[\s\S]{0,40}closed[\s\S]{0,40}task[\s\S]{0,40}cancelled/);
  });

  it('实现交付仅新增目标中文文档且不改代码', () => {
    const text = readFileSync(DOC, 'utf8');
    expect(text).toMatch(/^# .*attempt-run.*桥接使用说明/m);
    expect(text).not.toMatch(/[ぁ-んァ-ン가-힣]/);
  });
});
