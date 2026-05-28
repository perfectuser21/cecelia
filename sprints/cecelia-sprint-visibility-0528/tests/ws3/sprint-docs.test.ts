import { describe, it, expect } from 'vitest';

const BRAIN_URL = 'http://localhost:5221';
const EXISTING_SPRINT_DIR = 'sprints/cecelia-sprint-visibility-0528';

describe('Workstream 3 — GET /api/brain/harness/sprint-docs [BEHAVIOR]', () => {
  it('端点已注册（非 404）', async () => {
    const resp = await fetch(
      `${BRAIN_URL}/api/brain/harness/sprint-docs?sprint_dir=${EXISTING_SPRINT_DIR}`
    );
    // 404 = 端点未注册 = WS 未实现 → FAIL
    expect(resp.status).toBe(200);
  });

  it('返回含 sprint_dir 和 docs 字段', async () => {
    const resp = await fetch(
      `${BRAIN_URL}/api/brain/harness/sprint-docs?sprint_dir=${EXISTING_SPRINT_DIR}`
    );
    const data = await resp.json();
    expect(typeof data.sprint_dir).toBe('string');
    expect(typeof data.docs).toBe('object');
    expect(data.docs).not.toBeNull();
  });

  it('docs keys 完全等于 ["contract","harness_report","prep_prd","sprint_prd"]（sorted）', async () => {
    const resp = await fetch(
      `${BRAIN_URL}/api/brain/harness/sprint-docs?sprint_dir=${EXISTING_SPRINT_DIR}`
    );
    const data = await resp.json();
    const actualKeys = Object.keys(data.docs).sort();
    expect(actualKeys).toEqual(['contract', 'harness_report', 'prep_prd', 'sprint_prd']);
  });

  it('现有文件（sprint-prd.md）对应字段为 string 非 null', async () => {
    const resp = await fetch(
      `${BRAIN_URL}/api/brain/harness/sprint-docs?sprint_dir=${EXISTING_SPRINT_DIR}`
    );
    const data = await resp.json();
    expect(typeof data.docs.sprint_prd).toBe('string');
  });

  it('不存在路径下所有 docs 字段为 null（不报 404）', async () => {
    const resp = await fetch(
      `${BRAIN_URL}/api/brain/harness/sprint-docs?sprint_dir=sprints/nonexistent-xyz-12345`
    );
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.docs.prep_prd).toBeNull();
    expect(data.docs.sprint_prd).toBeNull();
    expect(data.docs.contract).toBeNull();
    expect(data.docs.harness_report).toBeNull();
  });

  it('缺 sprint_dir 参数返回 400 + {error: string}', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/harness/sprint-docs`);
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(typeof data.error).toBe('string');
  });

  it('禁用响应字段（prepPrd/sprintPrd/contractDraft/report）不出现', async () => {
    const resp = await fetch(
      `${BRAIN_URL}/api/brain/harness/sprint-docs?sprint_dir=${EXISTING_SPRINT_DIR}`
    );
    const data = await resp.json();
    expect('prepPrd' in data.docs).toBe(false);
    expect('sprintPrd' in data.docs).toBe(false);
    expect('contractDraft' in data.docs).toBe(false);
    expect('report' in data.docs).toBe(false);
    expect('prd' in data.docs).toBe(false);
  });
});
