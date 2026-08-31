import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const BASE_SHA = '5c12d2af68e2b2e4b8dcaaa2c87e50efab743291';

function readGuide() {
  return readFileSync(DOC, 'utf8');
}

describe('attempt-run 桥接使用说明', () => {
  it('端点用途与鉴权', () => {
    const doc = readGuide();
    expect(doc).toContain('POST /api/brain/harness/attempt-run');
    expect(doc).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(doc).toContain('internalAuthOrLoopback');
    expect(doc).toMatch(/宿主|远端/);
    expect(doc).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
  });

  it('九项角色白名单', () => {
    const doc = readGuide();
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    expect(doc).toMatch(/九项|9 项|9项/);
    for (const role of roles) expect(doc).toContain(`\`${role}\``);
    expect(doc).toMatch(/白名单外.*拒绝/);
  });

  it('payload 必填字段', () => {
    const doc = readGuide();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(doc).toMatch(new RegExp(`\\b${field}\\b[^\\n]{0,80}必填|必填[^\\n]{0,80}\\b${field}\\b`));
    }
    expect(doc).toMatch(/base_sha[^\n]{0,80}(可省略|无需提供)/);
    expect(doc).toMatch(/生产 Brain[^\n]{0,80}(自解析|自动解析)/);
  });

  it('派发失败自动回滚', () => {
    const doc = readGuide();
    expect(doc).toMatch(/run[^\n]{0,40}failed/);
    expect(doc).toMatch(/session[^\n]{0,40}closed/);
    expect(doc).toMatch(/task[^\n]{0,40}cancelled/);
    expect(doc).toMatch(/本次|本调用/);
  });

  it('实现范围只允许目标文档', () => {
    const files = execFileSync('git', ['diff', '--name-only', `${BASE_SHA}...HEAD`, '--', 'docs/current', 'packages'], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    expect(files).toEqual([DOC]);
  });
});
