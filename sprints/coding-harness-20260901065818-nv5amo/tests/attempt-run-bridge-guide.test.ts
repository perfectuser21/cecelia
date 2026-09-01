import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC_PATH = 'docs/current/attempt-run-bridge-guide.md';
const EXPECTED_ROLES = [
  'canary',
  'planner',
  'proposer',
  'reviewer',
  'generator',
  'generator-fix',
  'evaluator',
  'evaluator-evidence-repair',
  'judge',
];

let documentText = '';

function section(title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = documentText.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm'));
  expect(match, `缺少二级章节：${title}`).not.toBeNull();
  return match?.[1] ?? '';
}

beforeAll(() => {
  documentText = readFileSync(DOC_PATH, 'utf8');
});

describe('attempt-run 桥接使用说明文档合同', () => {
  it('说明两个端点的用途', () => {
    expect(documentText).toMatch(/[\u4e00-\u9fff]/);
    const text = section('端点用途');
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toMatch(/创建|派发/);
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toMatch(/查询|状态|结果/);
  });

  it('说明鉴权且不泄露凭据', () => {
    const text = section('鉴权方式');
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toMatch(/宿主[\s\S]*远端|远端[\s\S]*宿主/);
    expect(text).toMatch(/必须/);
    expect(text).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
    expect(documentText).not.toMatch(/Authorization:\s*Bearer\s+(?!<CECELIA_INTERNAL_TOKEN>)[A-Za-z0-9._~-]{16,}/);
  });

  it('角色白名单恰好九项', () => {
    const text = section('角色白名单');
    const roles = [...text.matchAll(/^\s*[-*]\s+`([^`]+)`\s*$/gm)].map((match) => match[1]);
    expect(roles).toEqual(EXPECTED_ROLES);
  });

  it('区分 payload 必填字段和 base_sha 可选语义', () => {
    const text = section('payload 字段');
    const requiredLine = text.split('\n').find((line) => /必填/.test(line)) ?? '';
    expect(requiredLine).toContain('sprint_dir');
    expect(requiredLine).toContain('base_repo');
    expect(requiredLine).toContain('branch');
    expect(requiredLine).not.toContain('base_sha');
    expect(text).toMatch(/`base_sha`[\s\S]*(可省略|可选)/);
    expect(text).toMatch(/生产 Brain[\s\S]*自行解析|由生产 Brain 自解析/);
  });

  it('说明派发失败自动回滚三类终态', () => {
    const text = section('派发失败自动回滚');
    expect(text).toMatch(/run\s*(?:→|->)\s*`?failed`?/);
    expect(text).toMatch(/session\s*(?:→|->)\s*`?closed`?/);
    expect(text).toMatch(/task\s*(?:→|->)\s*`?cancelled`?/);
    expect(text).toMatch(/孤儿|不会留下.*运行/);
  });
});
