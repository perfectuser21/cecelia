import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('公司 KR 采集和现场快照', () => {
  it('运行 Python 行为回归，保留原观测算法与 Brain 单一写口', () => {
    const test = fileURLToPath(new URL('../../../../tests/ops/test_opc_company_kr.py', import.meta.url));
    const result = spawnSync('python3', [test], { encoding: 'utf8', timeout: 20_000 });
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
