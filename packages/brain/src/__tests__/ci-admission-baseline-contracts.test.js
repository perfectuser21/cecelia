import {expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const contractCount = 148;

function verifyAdmissionContracts(result) {
  const evidence = `${result.stdout || ''}\n${result.stderr || ''}`;
  expect(result.error, evidence).toBeUndefined();
  expect(result.signal, evidence).toBeNull();
  expect(result.status, evidence).toBe(0);
  for (const field of ['tests', 'pass']) {
    expect(evidence).toMatch(new RegExp(`^# ${field} ${contractCount}$`, 'm'));
  }
  for (const field of ['fail', 'cancelled', 'skipped', 'todo']) {
    expect(evidence).toMatch(new RegExp(`^# ${field} 0$`, 'm'));
  }
}

it('默认Brain真实执行148项CI基线合同，不在旧Node作业重复运行', () => {
  const result = spawnSync(process.execPath, [
    '--test', 'scripts/ci/__tests__/ci-admission-mechanisms.test.mjs',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    env: {...process.env, POSTGRES_INTEGRATION: '0'},
  });
  verifyAdmissionContracts(result);
}, 210000);

it('基线合同分母拒绝TODO、取消、不足通过及子进程失败', () => {
  const output = `# tests ${contractCount}\n# pass ${contractCount}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;
  const result = {status: 0, signal: null, stdout: output, stderr: ''};
  expect(() => verifyAdmissionContracts(result)).not.toThrow();
  for (const field of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const stdout = output.replace(new RegExp(`# ${field} \\d+`), `# ${field} ${field === 'tests' || field === 'pass' ? contractCount - 1 : 1}`);
    expect(() => verifyAdmissionContracts({...result, stdout})).toThrow();
  }
  expect(() => verifyAdmissionContracts({...result, status: 1})).toThrow();
});
