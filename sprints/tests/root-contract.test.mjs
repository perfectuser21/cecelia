import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
it('根合同登记通过且子Sprint孤儿仍被真实守卫拒绝', () => {
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  const result = execFileSync('bash', ['scripts/__tests__/test-pyramid-guard.test.sh'], { cwd, encoding: 'utf8', timeout: 30000 });
  expect(result).toContain('11 通过 / 0 失败');
  expect(result).toContain('根合同不吸收子 Sprint 孤儿 → 红');
}, 35000);
