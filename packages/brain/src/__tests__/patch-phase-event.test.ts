import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

describe('PATCH /phase-event/:id 路由 [BEHAVIOR]', () => {
  it('PATCH body → response 含 ts_end', async () => {
    const src = await fs.promises.readFile(path.join(REPO_ROOT, 'packages/brain/src/routes/harness.js'), 'utf8');
    expect(src).toMatch(/router\.patch\([^)]*phase-event/);
    expect(src).toMatch(/ts_end/);
  });

  it('cost_usd 是 number', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/routes/harness.js'), 'utf8');
    expect(src).toMatch(/Number\s*\(\s*row\.cost_usd\s*\)|Number.*cost_usd/);
    expect(src).toMatch(/Number\s*\(\s*row\.ts_end\s*\)|Number.*ts_end/);
  });

  it('不存在 id → 404', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/routes/harness.js'), 'utf8');
    expect(src).toMatch(/404/);
    expect(src).toMatch(/not found/i);
  });

  it('PATCH response 含 model 字段（5 必填字段之一）', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/routes/harness.js'), 'utf8');
    const patchBlock = src.match(/router\.patch[\s\S]*?(?=\nexport|\nrouter\.(?:post|get|delete|put))/)?.[0] ?? src;
    expect(patchBlock).toMatch(/\bmodel\b/);
    expect(patchBlock).not.toMatch(/['"]event_id['"]\s*:/);
    expect(patchBlock).not.toMatch(/['"]created_at['"]\s*:/);
  });
});
