import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { HIGH_RISK_DEVGATE_SCRIPTS, checkDevgateCoverage } from '../../scripts/devgate/check-coverage-completeness.mjs';

const SCRIPT = resolve(__dirname, '../../scripts/devgate/check-coverage-completeness.mjs');

function runScript(extraArgs = ''): { code: number; stdout: string } {
  try {
    const stdout = execSync(`node "${SCRIPT}" --dry-run ${extraArgs}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: resolve(__dirname, '../..'),
    });
    return { code: 0, stdout };
  } catch (err: any) {
    return { code: err.status ?? 1, stdout: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

describe('check-coverage-completeness.mjs — HIGH_RISK_DEVGATE_SCRIPTS 白名单', () => {
  it('HIGH_RISK_DEVGATE_SCRIPTS 是 Set 类型', () => {
    expect(HIGH_RISK_DEVGATE_SCRIPTS).toBeInstanceOf(Set);
  });

  it('HIGH_RISK_DEVGATE_SCRIPTS 包含 check-dod-mapping', () => {
    expect(HIGH_RISK_DEVGATE_SCRIPTS.has('check-dod-mapping')).toBe(true);
  });

  it('HIGH_RISK_DEVGATE_SCRIPTS 包含 check-coverage-completeness 自身', () => {
    expect(HIGH_RISK_DEVGATE_SCRIPTS.has('check-coverage-completeness')).toBe(true);
  });

  it('HIGH_RISK_DEVGATE_SCRIPTS 包含 scan-rci-coverage', () => {
    expect(HIGH_RISK_DEVGATE_SCRIPTS.has('scan-rci-coverage')).toBe(true);
  });

  it('HIGH_RISK_DEVGATE_SCRIPTS 包含 check-rci-stale-refs', () => {
    expect(HIGH_RISK_DEVGATE_SCRIPTS.has('check-rci-stale-refs')).toBe(true);
  });
});

describe('check-coverage-completeness.mjs — checkDevgateCoverage 函数', () => {
  it('返回 missingRequired、missingOptional、total 字段', () => {
    const result = checkDevgateCoverage();
    expect(result).toHaveProperty('missingRequired');
    expect(result).toHaveProperty('missingOptional');
    expect(result).toHaveProperty('total');
    expect(Array.isArray(result.missingRequired)).toBe(true);
    expect(Array.isArray(result.missingOptional)).toBe(true);
  });

  it('missingRequired 只包含高风险脚本', () => {
    const { missingRequired } = checkDevgateCoverage();
    for (const s of missingRequired) {
      expect(HIGH_RISK_DEVGATE_SCRIPTS.has(s)).toBe(true);
    }
  });

  it('missingOptional 不包含高风险脚本', () => {
    const { missingOptional } = checkDevgateCoverage();
    for (const s of missingOptional) {
      expect(HIGH_RISK_DEVGATE_SCRIPTS.has(s)).toBe(false);
    }
  });

  it('高风险脚本均有测试（本 PR 补充后 missingRequired 为空）', () => {
    const { missingRequired } = checkDevgateCoverage();
    expect(missingRequired).toHaveLength(0);
  });
});

describe('check-coverage-completeness.mjs — dry-run 模式', () => {
  it('--dry-run 不会 exit 1', () => {
    const { code } = runScript();
    expect(code).toBe(0);
  });
});
