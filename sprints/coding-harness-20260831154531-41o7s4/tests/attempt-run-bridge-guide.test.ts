import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOC = 'docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md';
const readDoc = () => readFileSync(DOC, 'utf8');

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('端点与鉴权说明完整且远端鉴权 fail-closed', () => {
    const text = readDoc();
    expect(text).toMatch(/[\u4e00-\u9fff]/);
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toMatch(/POST[\s\S]{0,240}(创建|派发)/);
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toMatch(/GET[\s\S]{0,240}(查询|轮询)/);
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toMatch(/宿主[^\n]{0,160}远端[^\n]{0,160}必须[^\n]{0,160}Bearer[^\n]{0,160}CECELIA_INTERNAL_TOKEN/);
    expect(text).not.toMatch(/Bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  });

  it('角色白名单完整列出生产九项角色', () => {
    const text = readDoc();
    const match = text.match(/<!-- ALLOWED_ROLES_BEGIN -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- ALLOWED_ROLES_END -->/);
    expect(match, '缺少可机检的 ALLOWED_ROLES JSON 区块').not.toBeNull();
    const roles = JSON.parse(match![1]);
    expect(roles).toEqual([
      'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
      'evaluator', 'evaluator-evidence-repair', 'judge',
    ]);
    expect(new Set(roles).size).toBe(9);
  });

  it('payload 必填字段与 base_sha 省略语义准确', () => {
    const text = readDoc();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(text).toMatch(new RegExp(`\\b${field}\\b[^\\n]{0,100}必填`));
    }
    expect(text).toMatch(/\bbase_sha\b[^\n]{0,100}可省略/);
    expect(text).toMatch(/base_sha[^\n]{0,180}生产 Brain[^\n]{0,80}自解析/);
    expect(text).not.toMatch(/base_sha[^\n]{0,100}必填/);
  });

  it('派发失败回滚三个对象与终态完整', () => {
    const text = readDoc();
    expect(text).toMatch(/run\s*(?:→|->)\s*failed/);
    expect(text).toMatch(/session\s*(?:→|->)\s*closed/);
    expect(text).toMatch(/task\s*(?:→|->)\s*cancelled/);
  });
});
