import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const docPath = 'docs/current/attempt-run-bridge-guide.md';
const readDoc = () => readFileSync(docPath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('文档说明两个端点用途与 internalAuthOrLoopback 鉴权', () => {
    const doc = readDoc();
    expect(doc).toContain('POST /api/brain/harness/attempt-run');
    expect(doc).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(doc).toContain('internalAuthOrLoopback');
    expect(doc).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
  });

  it('文档逐项列出九个角色白名单', () => {
    const doc = readDoc();
    for (const role of ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge']) {
      expect(doc).toContain(`\`${role}\``);
    }
  });

  it('文档说明 payload 三个必填字段与 base_sha 省略语义', () => {
    const doc = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch', 'base_sha']) expect(doc).toContain(`\`${field}\``);
    expect(doc).toMatch(/base_sha[^\n]*(可省略|省略)/);
    expect(doc).toMatch(/生产 Brain[^\n]*解析/);
  });

  it('文档说明派发失败后的三项自动回滚终态', () => {
    const doc = readDoc();
    expect(doc).toContain('run → failed');
    expect(doc).toContain('session → closed');
    expect(doc).toContain('task → cancelled');
  });
});
