import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const docPath = 'docs/current/attempt-run-bridge-guide.md';
const taskRequestHash = '36b99953756db7bbfbaa29fd6871c56a549f04acbec458352388564d4538b039';
const readDoc = () => readFileSync(docPath, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('文档存在且为中文并说明两个端点用途', () => {
    const doc = readDoc();
    expect(taskRequestHash).toHaveLength(64);
    expect(doc).toMatch(/[\u4e00-\u9fff]/);
    expect(doc).toContain('POST /api/brain/harness/attempt-run');
    expect(doc).toMatch(/POST[^\n]*(创建|派发)|创建并派发[^\n]*POST/);
    expect(doc).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(doc).toMatch(/GET[^\n]*按 id 查询|按 id 查询[^\n]*GET/);
  });

  it('鉴权说明覆盖两个端点且不泄露凭据', () => {
    const doc = readDoc();
    expect((doc.match(/internalAuthOrLoopback/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(doc).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
    expect(doc).toMatch(/宿主/);
    expect(doc).toMatch(/远端/);
    expect(doc).not.toMatch(/Authorization:\s*Bearer\s+(?!<CECELIA_INTERNAL_TOKEN>)[A-Za-z0-9_.-]{16,}/);
  });

  it('角色白名单严格等于冻结九项集合', () => {
    const doc = readDoc();
    const section = doc.match(/## 角色白名单\s*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    const roles = [...section.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((m) => m[1]);
    expect(roles).toEqual([
      'planner', 'proposer', 'critic', 'generator', 'generator-fix',
      'evaluator', 'evaluator-fix', 'merger', 'reporter',
    ]);
  });

  it('payload 字段语义完整', () => {
    const doc = readDoc();
    const section = doc.match(/## payload 字段\s*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(section).toMatch(new RegExp(`\\b${field}\\b[^\\n]*必填|必填[^\\n]*\\b${field}\\b`));
    }
    expect(section).toMatch(/base_sha[^\n]*可省略/);
    expect(section).toMatch(/base_sha[^\n]*生产 Brain[^\n]*自解析|生产 Brain[^\n]*自解析[^\n]*base_sha/);
  });

  it('派发失败回滚三项终态', () => {
    const doc = readDoc();
    expect(doc).toMatch(/run\s*→\s*failed/);
    expect(doc).toMatch(/session\s*→\s*closed/);
    expect(doc).toMatch(/task\s*→\s*cancelled/);
  });
});
