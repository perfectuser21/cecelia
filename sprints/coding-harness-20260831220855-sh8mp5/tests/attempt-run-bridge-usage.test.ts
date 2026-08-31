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

  it('角色白名单恰好列出九项生产角色', () => {
    const text = readDoc();
    const expected = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    const section = text.match(/^## 角色白名单\s*$([\s\S]*?)(?=^## |\s*$)/m);
    expect(section).not.toBeNull();
    const actual = [...section![1].matchAll(/^- `([^`]+)`\s*$/gm)].map((match) => match[1]);
    expect(actual).toEqual(expected);
  });

  it('产品 diff 过滤器不吞掉 sprint 目录任意额外文件', () => {
    const sprintPath = 'sprints/coding-harness-20260831220855-sh8mp5';
    const frozen = new Set([
      `${sprintPath}/contract-draft.md`, `${sprintPath}/contract-dod.md`,
      `${sprintPath}/tests/attempt-run-bridge-usage.test.ts`, `${sprintPath}/task-plan.json`,
      `${sprintPath}/.brain-result.json`, '.brain-result.json',
    ]);
    const filtered = [`${sprintPath}/contract-draft.md`, `${sprintPath}/arbitrary-extra.txt`].filter((path) => !frozen.has(path));
    expect(filtered).toEqual([`${sprintPath}/arbitrary-extra.txt`]);
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
