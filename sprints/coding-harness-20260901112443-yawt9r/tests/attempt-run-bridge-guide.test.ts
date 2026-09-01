import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const readGuide = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('说明两个端点的用途', () => {
    const text = readGuide();
    expect(text).toMatch(/[一-龥]/);
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toMatch(/创建.*派发|派发.*创建/s);
    expect(text).toMatch(/按.*id.*查询|查询.*状态/s);
  });

  it('说明宿主或远端 Bearer 鉴权', () => {
    const text = readGuide();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/宿主.*远端|远端.*宿主/s);
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{24,}/);
  });

  it('列出九项角色白名单', () => {
    const text = readGuide();
    const roles = ['planner', 'proposer', 'critic', 'generator', 'generator-fix', 'evaluator', 'evaluator-fix', 'judge', 'reporter'];
    for (const role of roles) expect(text).toContain(`\`${role}\``);
  });

  it('说明 payload 必填字段和 base_sha 省略语义', () => {
    const text = readGuide();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(text).toMatch(new RegExp(`(?:${field}.{0,40}必填|必填.{0,80}${field})`, 's'));
    }
    expect(text).toMatch(/base_sha.{0,40}(可省略|可选)/s);
    expect(text).toMatch(/生产 Brain.{0,40}自解析/s);
  });

  it('说明派发失败自动回滚三对象终态', () => {
    const text = readGuide();
    expect(text).toMatch(/派发失败.{0,160}自动回滚|自动回滚.{0,160}派发失败/s);
    expect(text).toMatch(/run\s*(?:→|->)\s*failed/);
    expect(text).toMatch(/session\s*(?:→|->)\s*closed/);
    expect(text).toMatch(/task\s*(?:→|->)\s*cancelled/);
  });
});
