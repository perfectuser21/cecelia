import {expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

it('真实执行36项验证输入退休合同，保持非数据库验收边界', () => {
  const result = spawnSync(process.execPath, [
    '--test', 'scripts/ci/__tests__/basic-verification-retirements.test.mjs',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    env: {...process.env, POSTGRES_INTEGRATION: '0'},
  });
  const evidence = `${result.stdout || ''}\n${result.stderr || ''}`;
  expect(result.error, evidence).toBeUndefined();
  expect(result.signal, evidence).toBeNull();
  expect(result.status, evidence).toBe(0);
  expect(evidence).toMatch(/# tests 36\b/);
  expect(evidence).toMatch(/# fail 0\b/);
  expect(evidence).toMatch(/# skipped 0\b/);
}, 150000);
