import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-usage.md';
const readDoc = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('包含两个端点用途与鉴权规则', () => {
    const text = readDoc();
    for (const value of [
      'POST /api/brain/harness/attempt-run',
      'GET /api/brain/harness/attempt-run/:id',
      '创建',
      '查询',
      'internalAuthOrLoopback',
      'Bearer',
      'CECELIA_INTERNAL_TOKEN',
      '宿主',
      '远端',
    ]) expect(text).toContain(value);
  });

  it('角色白名单恰为生产九项', () => {
    const block = readDoc().match(/<!-- ROLE_LIST_START -->([\s\S]*?)<!-- ROLE_LIST_END -->/);
    expect(block).not.toBeNull();
    const roles = [...block![1].matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
  });

  it('说明 payload 必填字段和 base_sha 自解析', () => {
    const text = readDoc();
    for (const value of [
      'sprint_dir', 'base_repo', 'branch', '必填',
      'base_sha', '可省略', '生产 Brain', '自解析',
    ]) expect(text).toContain(value);
  });

  it('说明派发失败的三个回滚终态', () => {
    const text = readDoc();
    expect(text).toContain('run→failed');
    expect(text).toContain('session→closed');
    expect(text).toContain('task→cancelled');
  });

  it('固定精确 task_request_hash', () => {
    expect(readDoc()).toContain('fb7e86a156d48c9d342f74c8feee26cf570d7fed705eb39c86b41cd320c73050');
  });
});
