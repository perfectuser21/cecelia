import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

describe('B31: harness-evaluator SKILL.md 含 cookie 隔离规则', () => {
  const skillPath = resolve(__dirname, '../../../../../packages/workflows/skills/harness-evaluator/SKILL.md');
  const src = readFileSync(skillPath, 'utf8');

  it('含 cookie / session 隔离段', () => {
    expect(src).toMatch(/cookie.*隔离|session.*隔离|fresh.*context|新.*context.*每次/i);
  });

  it('提到 Playwright newContext / storageState undefined', () => {
    expect(src).toMatch(/newContext|storageState.*undefined|user-data-dir.*tmp/i);
  });

  it('明文说每次 evaluator 跑必须新干净环境', () => {
    expect(src).toMatch(/每次.*evaluator.*新.*干净|每.*evaluator.*独立.*环境/i);
  });
});
