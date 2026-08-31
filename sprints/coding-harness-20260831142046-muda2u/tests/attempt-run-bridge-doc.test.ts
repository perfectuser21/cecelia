import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');
const docPath = resolve(repoRoot, 'docs/current/attempt-run-bridge-guide.md');

function readDoc(): string {
  return readFileSync(docPath, 'utf8');
}

describe('attempt-run 桥接使用说明合同', () => {
  it('目标中文文档存在且包含两个端点用途与鉴权', () => {
    const doc = readDoc();
    expect(doc).toContain('# attempt-run 桥接使用说明');
    expect(doc).toContain('POST /api/brain/harness/attempt-run');
    expect(doc).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(doc).toContain('internalAuthOrLoopback');
    expect(doc).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
  });

  it('完整列出九项角色白名单', () => {
    const doc = readDoc();
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    for (const role of roles) expect(doc).toContain(`\`${role}\``);
  });

  it('说明 payload 必填字段及 base_sha 省略语义', () => {
    const doc = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) expect(doc).toContain(`\`${field}\``);
    expect(doc).toContain('`base_sha`');
    expect(doc).toMatch(/base_sha.{0,40}可省略/s);
    expect(doc).toMatch(/生产 Brain.{0,40}解析/s);
  });

  it('说明派发失败自动回滚的三组终态', () => {
    const doc = readDoc();
    expect(doc).toContain('run → failed');
    expect(doc).toContain('session → closed');
    expect(doc).toContain('task → cancelled');
    expect(doc).toContain('LAUNCHED');
  });

  it('实现范围不包含代码改动', () => {
    const files = execFileSync('git', ['diff', '--name-only', '5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD'], { cwd: repoRoot, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    expect(files.every((file) => file === 'docs/current/attempt-run-bridge-guide.md' || file.startsWith('sprints/coding-harness-20260831142046-muda2u/'))).toBe(true);
  });
});
