import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const BASE = '109d1df64cdc68fbec8852c3ad2d0e3291e648ef';

function guide(): string {
  return readFileSync(DOC, 'utf8');
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('中文说明包含四个主题节', () => {
    const text = guide();
    expect(text).toMatch(/[\u4e00-\u9fff]/);
    for (const heading of ['端点用途', '鉴权方式', '角色白名单', 'payload 与失败回滚']) {
      expect(text).toContain(heading);
    }
  });

  it('两个端点用途和远端 Bearer 鉴权', () => {
    const text = guide();
    for (const literal of [
      'POST /api/brain/harness/attempt-run',
      'GET /api/brain/harness/attempt-run/:id',
      'internalAuthOrLoopback',
      'Bearer CECELIA_INTERNAL_TOKEN',
      '派发',
      '查询',
    ]) expect(text).toContain(literal);
  });

  it('角色白名单严格等于权威九项闭集', () => {
    const roles = [...guide().matchAll(/^\s*[-*]\s+`([^`]+)`\s*$/gm)]
      .map((match) => match[1])
      .filter((item) => !['sprint_dir', 'base_repo', 'branch', 'base_sha'].includes(item));
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
  });

  it('payload 必填可选和失败回滚完整', () => {
    const text = guide();
    for (const literal of [
      '`sprint_dir`（必填）', '`base_repo`（必填）', '`branch`（必填）',
      '`base_sha`（可省略）', '生产 Brain 自解析',
      'run → `failed`', 'session → `closed`', 'task → `cancelled`',
    ]) expect(text).toContain(literal);
  });

  it('唯一产品交付文件是桥接说明', () => {
    const output = execFileSync('git', ['diff', '--name-only', `${BASE}...HEAD`], { encoding: 'utf8' });
    const productFiles = output.trim().split('\n').filter(Boolean)
      .filter((file) => !file.startsWith('sprints/coding-harness-20260901070958-avqlef/'));
    expect(productFiles).toEqual([DOC]);
  });
});

