import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOC = 'docs/current/attempt-run-bridge-usage.md';
const readDoc = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('区分创建与查询端点并说明 internalAuthOrLoopback 鉴权', () => {
    const text = readDoc();
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/宿主|远端/);
  });

  it('角色白名单完整列出九项生产角色', () => {
    const text = readDoc();
    for (const role of ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge']) {
      expect(text).toContain(`\`${role}\``);
    }
  });

  it('payload 必填字段与 base_sha 可省略语义准确', () => {
    const text = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(text).toMatch(new RegExp('`' + field + '`[^\\n]{0,40}必填'));
    }
    expect(text).toMatch(/`base_sha`[^\n]{0,50}可省略/);
    expect(text).toMatch(/生产 Brain[^\n]{0,40}自解析/);
  });

  it('派发失败自动回滚写明三个终态', () => {
    const text = readDoc();
    expect(text).toContain('run→failed');
    expect(text).toContain('session→closed');
    expect(text).toContain('task→cancelled');
  });
});
