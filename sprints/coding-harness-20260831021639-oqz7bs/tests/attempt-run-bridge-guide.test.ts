import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('覆盖两个端点的用途与鉴权方式', () => {
    const text = readGuide();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('异步派发');
    expect(text).toContain('轮询');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/宿主.*远端|远端.*宿主/s);
  });

  it('完整列出九项角色白名单', () => {
    const text = readGuide();
    const roles = [
      'canary', 'planner', 'proposer', 'reviewer', 'generator',
      'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
    ];
    for (const role of roles) expect(text).toContain(`\`${role}\``);
    expect(text).toMatch(/九(?:项|个)角色/);
  });

  it('说明 payload 必填字段与 base_sha 省略语义', () => {
    const text = readGuide();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(text).toMatch(new RegExp(`payload\\.${field}[^\\n]{0,40}必填`));
    }
    expect(text).toMatch(/payload\.base_sha[^\n]{0,40}可省略/);
    expect(text).toMatch(/base_sha[^\n]{0,80}生产 Brain[^\n]{0,40}(自解析|解析)/);
  });

  it('说明派发失败自动回滚的三个终态', () => {
    const text = readGuide();
    expect(text).toMatch(/派发.*(?:失败|抛错|未.*LAUNCHED)/s);
    expect(text).toContain('run → failed');
    expect(text).toContain('session → closed');
    expect(text).toContain('task → cancelled');
  });
});
