import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = readFileSync(join(process.cwd(), 'features/workbench/index.ts'), 'utf8');
const featureRoot = readFileSync(join(process.cwd(), 'features/index.ts'), 'utf8');
const app = readFileSync(join(process.cwd(), '../dashboard/src/App.tsx'), 'utf8');

describe('Workbench canonical routes', () => {
  it('注册 Overview / Inbox / Tasks / Activity / Projections 五个页面', () => {
    for (const path of ['overview', 'inbox', 'tasks', 'activity', 'projections']) {
      expect(manifest).toContain(`/workbench/${path}`);
    }
  });

  it('Workbench 进入 feature registry 且使用全高布局', () => {
    expect(featureRoot).toContain("'workbench': () => import('./workbench')");
    expect(app).toContain("path.startsWith('/workbench')");
  });
});
