import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const integrationTest = path.join(
  repoRoot,
  'packages/brain/src/__tests__/integration/pr4372-current-main-equivalence.integration.test.js'
);
const smokeScript = path.join(
  repoRoot,
  'packages/brain/scripts/smoke/pr4372-current-main-equivalence-smoke.sh'
);

describe('PR4372 Draft SHA binding contract [BEHAVIOR]', () => {
  it('PR4372 Draft 与 autoMergeRequest null 必须绑定同一最终 head SHA', () => {
    expect(
      fs.existsSync(integrationTest),
      'RED: PR4372 current-main 等价 integration test 尚未实现'
    ).toBe(true);

    const src = fs.readFileSync(integrationTest, 'utf8');
    expect(src).toContain('4372');
    expect(src).toMatch(/isDraft|draft/i);
    expect(src).toContain('autoMergeRequest');
    expect(src).toContain('pr_head_sha');
  });

  it('F1 当前主线等价 smoke 同时声明 S0-S12 143 11 8 7 五组基线', () => {
    expect(
      fs.existsSync(smokeScript),
      'RED: PR4372 current-main equivalence smoke 脚本尚未实现'
    ).toBe(true);

    const src = fs.readFileSync(smokeScript, 'utf8');
    for (const token of ['S0-S12', '143', '11', '8', '7']) {
      expect(src).toContain(token);
    }
    expect(src).toContain('required checks');
    expect(src).toContain('DevGate');
  });
});
