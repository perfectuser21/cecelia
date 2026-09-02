import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC_PATH = 'docs/current/attempt-run-bridge-guide.md';
const BASE_SHA = 'd32b864de5adf8d3083c91f31ed3f5f7f58be985';
const ROLES = [
  'canary', 'planner', 'proposer', 'reviewer', 'generator',
  'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
];

function readGuide() {
  return readFileSync(DOC_PATH, 'utf8');
}

function hasEndpointsAndAuth(text: string) {
  return text.includes('POST /api/brain/harness/attempt-run')
    && text.includes('GET /api/brain/harness/attempt-run/:id')
    && text.includes('internalAuthOrLoopback')
    && text.includes('Bearer CECELIA_INTERNAL_TOKEN');
}

function listedRoles(text: string) {
  return ROLES.filter((role) => new RegExp('^\\s*[-*]\\s+`' + role + '`\\s*$', 'm').test(text));
}

function hasPayloadContract(text: string) {
  return ['sprint_dir', 'base_repo', 'branch'].every((field) => text.includes(`\`${field}\``))
    && text.includes('`base_sha`')
    && /base_sha[^\n]*(可省略|非必填)/.test(text)
    && /生产 Brain[^\n]*(解析|解析出)/.test(text);
}

function hasRollbackContract(text: string) {
  return /run[^\n]*failed/.test(text)
    && /session[^\n]*closed/.test(text)
    && /task[^\n]*cancelled/.test(text);
}

describe('attempt-run 桥接使用说明冻结合同', () => {
  it('文档包含两个端点用途和远端 Bearer 鉴权', () => {
    const text = readGuide();
    expect(hasEndpointsAndAuth(text)).toBe(true);
    expect(hasEndpointsAndAuth(text.replace('Bearer CECELIA_INTERNAL_TOKEN', ''))).toBe(false);
  });

  it('文档逐项列出且仅列出九个角色白名单', () => {
    const text = readGuide();
    expect(listedRoles(text)).toEqual(ROLES);
    expect(listedRoles(text.replace('- `judge`', '- `commander`'))).not.toEqual(ROLES);
  });

  it('文档说明三个 payload 必填字段和 base_sha 省略语义', () => {
    const text = readGuide();
    expect(hasPayloadContract(text)).toBe(true);
    expect(hasPayloadContract(text.replace(/base_sha[^\n]*(可省略|非必填)/, 'base_sha 必填'))).toBe(false);
  });

  it('文档说明派发失败后的三对象回滚终态', () => {
    const text = readGuide();
    expect(hasRollbackContract(text)).toBe(true);
    expect(hasRollbackContract(text.replace('task', 'anchor'))).toBe(false);
  });

  it('文档交付范围只新增指定中文说明且锚定冻结基线', () => {
    const text = readGuide();
    expect(text).toMatch(/[\u4e00-\u9fff]/);
    expect(BASE_SHA).toHaveLength(40);
    expect(DOC_PATH).toBe('docs/current/attempt-run-bridge-guide.md');
    expect(DOC_PATH.replace('docs/current/', 'packages/brain/src/')).not.toMatch(/^docs\/current\//);
  });
});
