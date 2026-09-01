import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOC_PATH = 'docs/current/attempt-run-bridge-guide.md';
const BASE_SHA = 'd4ae8c6d2b777f5762c4cd88a8e8d56004c66750';

function readGuide(): string {
  return readFileSync(DOC_PATH, 'utf8');
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('分别说明两个端点用途', () => {
    const guide = readGuide();
    expect(guide).toMatch(/POST \/api\/brain\/harness\/attempt-run[\s\S]{0,240}(创建|发起)[\s\S]{0,80}派发/);
    expect(guide).toMatch(/GET \/api\/brain\/harness\/attempt-run\/:id[\s\S]{0,240}(按|通过)[\s\S]{0,80}id[\s\S]{0,80}查询/);
  });

  it('说明 internalAuthOrLoopback 与远端 Bearer 鉴权', () => {
    const guide = readGuide();
    expect(guide).toContain('internalAuthOrLoopback');
    expect(guide).toMatch(/宿主|远端/);
    expect(guide).toMatch(/Authorization:\s*Bearer\s+\$CECELIA_INTERNAL_TOKEN/);
    expect(guide).toMatch(/(必须|需要).{0,30}(携带|提供)/);
    expect(guide).toMatch(/(不得|禁止).{0,30}(真实|实际).{0,10}(token|Token)/);
  });

  it('列出九项角色白名单', () => {
    const guide = readGuide();
    expect(guide).toMatch(/角色白名单/);
    for (const role of [
      'planner', 'proposer', 'critic', 'generator', 'generator-fix',
      'evaluator', 'evaluator-fix', 'judge', 'reporter',
    ]) {
      expect(guide).toContain(`\`${role}\``);
    }
  });

  it('说明 payload 必填字段与 base_sha 省略语义', () => {
    const guide = readGuide();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(guide).toMatch(new RegExp(`(?:${field}.{0,40}必填|必填.{0,80}${field})`));
    }
    expect(guide).toMatch(/base_sha.{0,60}(可省略|选填)/);
    expect(guide).toMatch(/base_sha[\s\S]{0,160}生产 Brain.{0,30}(自解析|解析)/);
  });

  it('完整说明派发失败自动回滚状态', () => {
    const guide = readGuide();
    expect(guide).toMatch(/派发失败.{0,80}(自动)?回滚/);
    expect(guide).toMatch(/run\s*(?:→|->)\s*failed/);
    expect(guide).toMatch(/session\s*(?:→|->)\s*closed/);
    expect(guide).toMatch(/task\s*(?:→|->)\s*cancelled/);
  });

  it('产品交付只新增目标文档且不改代码', () => {
    const changed = execFileSync(
      'git',
      ['diff', '--name-only', `${BASE_SHA}...HEAD`, '--', 'docs/current', 'packages', 'apps', 'scripts', '.github'],
      { encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean).sort();
    expect(changed).toEqual([DOC_PATH]);
  });
});
