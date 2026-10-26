import { it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { runActivityProcess } from './helpers/run-activity.mjs';
import { managedSpecFixture } from './helpers/managed-spec.mjs';

it('真实spec活动不能接受遗漏全部旧规则的模型规格', async () => {
  const f = managedSpecFixture();
  try {
    const r = await runActivityProcess(fileURLToPath(new URL('../activities/spec.mjs', import.meta.url)), f.input, {
      CODING_WF_CLAUDE_BIN: fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url)), FAKE_CLAUDE_MODE: 'ok',
    });
    expect(r.result.reason_code, r.stderr).toBe('spec_invalid');
    expect(r.result.evidence[0].spec_errors).toContain('material_plan_missing');
  } finally { f.clean(); }
});
