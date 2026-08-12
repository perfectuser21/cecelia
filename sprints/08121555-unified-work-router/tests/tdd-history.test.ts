import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('RED→GREEN 提交顺序 [BEHAVIOR]', () => {
  it('七项 RED commit 均早于 GREEN 且同测试在两树分别失败和通过', () => {
    const output = execFileSync('bash', ['packages/brain/scripts/verify/unified-work-router-tdd-history.sh'], { encoding: 'utf8' });
    for (const knife of ['recovery', 'knife0', 'knife1', 'knife2', 'knife3', 'knife4', 'knife5']) expect(output).toContain(`TDD_OK ${knife}`);
  });
});
