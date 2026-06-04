import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SKILL_PATH = path.join(REPO_ROOT, 'packages/workflows/skills/harness-report/SKILL.md');

describe('Reporter Step 6 引用 initiative_run_events [BEHAVIOR]', () => {
  it("harness-report SKILL.md 含 'initiative_run_events' 字面 + 三列关键字", async () => {
    const content = await fs.promises.readFile(SKILL_PATH, 'utf8');
    expect(content).toMatch(/initiative_run_events/);
    expect(content).toMatch(/ts_end|耗时/);
    expect(content).toMatch(/cost_usd|成本/);
    expect(content).toMatch(/\bmodel\b|模型/);
    expect(content).toMatch(/ts_end\s*\/\s*1000|\/1000/);
  });
});
