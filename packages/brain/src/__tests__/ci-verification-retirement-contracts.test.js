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

it('合同执行分母拒绝todo、取消或不足36个真实通过', () => {
  expect(typeof verifyRetirementContracts).toBe('function');
  const output = '# tests 36\n# pass 36\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  const result = {status: 0, signal: null, stdout: output, stderr: ''};
  expect(() => verifyRetirementContracts(result)).not.toThrow();
  for (const stdout of [
    output.replace('# pass 36', '# pass 35').replace('# todo 0', '# todo 1'),
    output.replace('# pass 36', '# pass 35').replace('# cancelled 0', '# cancelled 1'),
    output.replace('# pass 36', '# pass 0'),
  ]) expect(() => verifyRetirementContracts({...result, stdout})).toThrow();
});
