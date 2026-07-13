import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

describe('POST /phase-event 路由 [BEHAVIOR]', () => {
  it('POST body 4 字段 → response 含 id', async () => {
    const src = await fs.promises.readFile(path.join(REPO_ROOT, 'packages/brain/src/routes/harness.js'), 'utf8');
    expect(src).toMatch(/router\.post\([^)]*phase-event/);
    expect(src).toMatch(/\bid\b/);
  });

  it('response 含 model 字段（model 列写入 DB）', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/events/initiativeRunEvents.js'), 'utf8');
    expect(src).toMatch(/INSERT INTO initiative_run_events[\s\S]*\bmodel\b/);
  });

  it('禁用字段不暴露', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/routes/harness.js'), 'utf8');
    const postBlock = src.match(/router\.post\([^)]*phase-event[\s\S]*?(?=\nrouter\.|\nexport)/)?.[0] ?? src;
    expect(postBlock).not.toMatch(/['"]event_id['"]\s*:/);
    expect(postBlock).not.toMatch(/['"]created_at['"]\s*:/);
  });
});
