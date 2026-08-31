import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const docPath = 'docs/current/attempt-run-bridge-guide.md';
const routePath = 'packages/brain/src/routes/harness-attempt-run.js';

function readDoc(): string {
  expect(fs.existsSync(docPath), `${docPath} 应存在`).toBe(true);
  return fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('说明两个端点属于同一 attempt-run 流程', () => {
    const doc = readDoc();
    expect(doc).toContain('## 端点用途');
    expect(doc).toContain('POST /api/brain/harness/attempt-run');
    expect(doc).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(doc).toMatch(/同一.{0,30}(attempt-run|run)|(?:attempt-run|run).{0,30}同一/);
  });

  it('鉴权与 payload 字段字面准确', () => {
    const doc = readDoc();
    expect(doc).toContain('## 鉴权方式');
    expect(doc).toContain('internalAuthOrLoopback');
    expect(doc).toContain('Bearer CECELIA_INTERNAL_TOKEN');
    expect(doc).toMatch(/sprint_dir.{0,80}必填|必填.{0,80}sprint_dir/s);
    expect(doc).toMatch(/base_repo.{0,80}必填|必填.{0,80}base_repo/s);
    expect(doc).toMatch(/branch.{0,80}必填|必填.{0,80}branch/s);
    expect(doc).toMatch(/base_sha.{0,40}(可省略|非必填)/);
    expect(doc).toMatch(/生产 Brain.{0,40}(自解析|自动解析)/);
  });

  it('角色白名单恰为生产 SSOT 的九项精确集合', () => {
    const doc = readDoc();
    expect(doc).toContain('## 角色白名单');
    const route = fs.readFileSync(routePath, 'utf8');
    const ssotBlock = route.match(/export const ALLOWED_ROLES = Object\.freeze\(\[([\s\S]*?)\]\);/);
    expect(ssotBlock, '生产路由应包含 ALLOWED_ROLES').not.toBeNull();
    const ssotRoles = [...(ssotBlock?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    const section = doc.split('## 角色白名单')[1]?.split('\n## ')[0] ?? '';
    const documentedRoles = [...section.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((m) => m[1]).sort();
    expect(ssotRoles).toHaveLength(9);
    expect(documentedRoles).toEqual(ssotRoles);
  });

  it('派发失败回滚三对象终态完整', () => {
    const doc = readDoc();
    expect(doc).toContain('## payload 与失败自动回滚');
    expect(doc).toContain('run→failed');
    expect(doc).toContain('session→closed');
    expect(doc).toContain('task→cancelled');
  });
});

