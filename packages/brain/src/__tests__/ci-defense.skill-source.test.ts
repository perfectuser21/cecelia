import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const CHECKER = join(ROOT, 'packages/brain/scripts/ci/skill-contract-check.mjs');
const EVALUATOR = join(ROOT, 'packages/workflows/skills/harness-evaluator/SKILL.md');

describe('固定 evaluator 来源的篡改检出合同', () => {
  it('Step3 篡改检出: checkEvaluator 删 env_missing 后 ok=false 且 missing 含 env_missing', async () => {
    expect(existsSync(CHECKER)).toBe(true);
    const m: any = await import(CHECKER);
    const content = readFileSync(EVALUATOR, 'utf8');
    const tampered = content.replace(/env_missing/g, 'ENV_REMOVED');
    const r = m.checkEvaluator(tampered);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('env_missing');
    // 现网真实快照应全绿
    expect(m.checkEvaluator(content).ok).toBe(true);
  });

});
