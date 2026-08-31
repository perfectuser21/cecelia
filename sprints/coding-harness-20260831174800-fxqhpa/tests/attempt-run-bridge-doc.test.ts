import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
].sort();

function documentText(): string {
  return readFileSync(DOC_PATH, 'utf8');
}

function section(text: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, 'm'));
  expect(match, `缺少章节：${heading}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('两个端点用途完整', () => {
    const text = documentText();
    expect(text).toMatch(/POST `?\/api\/brain\/harness\/attempt-run`?[\s\S]{0,160}(创建|派发)/);
    expect(text).toMatch(/GET `?\/api\/brain\/harness\/attempt-run\/:id`?[\s\S]{0,160}(查询|状态)/);
  });

  it('远端必须 Bearer 且没有免鉴权误述', () => {
    const auth = section(documentText(), '鉴权方式');
    expect(auth).toContain('internalAuthOrLoopback');
    expect(auth).toMatch(/宿主[\s\S]{0,80}远端[\s\S]{0,160}必须[\s\S]{0,80}Bearer[\s$]CECELIA_INTERNAL_TOKEN/);
    expect(auth).not.toMatch(/(宿主|远端)[^。\n]{0,40}(免鉴权|无需鉴权|无需令牌|不需要令牌)/);
    expect(auth).not.toMatch(/(免鉴权|无需鉴权|无需令牌|不需要令牌)[^。\n]{0,40}(宿主|远端)/);
  });

  it('角色章节集合恰等于九项白名单', () => {
    const roles = section(documentText(), '角色白名单');
    const listed = [...roles.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((m) => m[1]).sort();
    expect(listed).toEqual(EXPECTED_ROLES);
  });

  it('payload 必填与 base_sha 省略语义', () => {
    const payload = section(documentText(), 'Payload 字段');
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(payload).toMatch(new RegExp(`\\b${field}\\b[^\\n]{0,60}必填`));
    }
    expect(payload).toMatch(/\bbase_sha\b[^\n]{0,100}可省略/);
    expect(payload).toMatch(/生产 Brain[^\n]{0,80}(自动|自行)解析/);
    expect(payload).toMatch(/base_sha[^。\n]{0,120}不(?:得|能)[^。\n]{0,80}(替代|取代)[^。\n]{0,80}(权威|冻结)实现基线/);
  });

  it('派发失败三对象自动回滚', () => {
    const rollback = section(documentText(), '派发失败自动回滚');
    expect(rollback).toContain('run→failed');
    expect(rollback).toContain('session→closed');
    expect(rollback).toContain('task→cancelled');
  });
});
