import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const readDoc = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('两个端点用途完整', () => {
    const doc = readDoc();
    expect(doc).toContain('POST /api/brain/harness/attempt-run');
    expect(doc).toMatch(/POST[\s\S]{0,300}(创建|派发)/);
    expect(doc).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(doc).toMatch(/GET[\s\S]{0,300}(查询|轮询)/);
  });

  it('鉴权与九项角色白名单准确', () => {
    const doc = readDoc();
    expect(doc).toContain('internalAuthOrLoopback');
    expect(doc).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(doc).toMatch(/loopback/i);
    expect(doc).toMatch(/宿主|远端/);
    const section = doc.match(/## 角色白名单\s*([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    const roles = [...section.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((match) => match[1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
  });

  it('payload 必填项与可选 base_sha 准确', () => {
    const doc = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(doc).toMatch(new RegExp(`(?:${field}.{0,80}必填|必填.{0,80}${field})`, 's'));
    }
    expect(doc).toMatch(/base_sha[\s\S]{0,120}(可省略|非必填)/);
    expect(doc).toMatch(/base_sha[\s\S]{0,160}生产 Brain[\s\S]{0,80}(解析|获取)/);
  });

  it('派发失败三对象回滚完整', () => {
    const doc = readDoc();
    expect(doc).toContain('run→failed');
    expect(doc).toContain('session→closed');
    expect(doc).toContain('task→cancelled');
  });
});
