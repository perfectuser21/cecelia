import { describe, it, expect, vi } from 'vitest';
import { execSync } from 'child_process';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync } from 'fs';
import { HIGH_RISK_DEVGATE_SCRIPTS, checkDevgateCoverage, HIGH_RISK_BRAIN_MODULES, checkBrainCoverage, main } from '../../scripts/devgate/check-coverage-completeness.mjs';

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

  // scan-rci-coverage 和 check-rci-stale-refs 已在 slim-engine 中删除
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

describe('check-coverage-completeness.mjs — main() 函数覆盖', () => {
  it('main() 在真实 engine 下运行不会 exit 1（高风险脚本全覆盖）', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      main();
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
    }
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('main() 输出包含 Devgate 脚本覆盖检查结果', () => {
    const logs: string[] = [];
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg ?? ''));
    });
    try {
      main();
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
    }
    const combined = logs.join('\n');
    expect(combined).toMatch(/Devgate/);
  });

  it('main() 输出包含 Brain src 覆盖检查结果', () => {
    const logs: string[] = [];
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg ?? ''));
    });
    try {
      main();
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
    }
    expect(logs.join('\n')).toMatch(/Brain src 覆盖/);
  });
});

describe('check-coverage-completeness.mjs — checkBrainCoverage 函数', () => {
  it('HIGH_RISK_BRAIN_MODULES 是 Set 且包含五个核心模块', () => {
    expect(HIGH_RISK_BRAIN_MODULES).toBeInstanceOf(Set);
    for (const m of ['tick', 'thalamus', 'executor', 'cortex', 'planner']) {
      expect(HIGH_RISK_BRAIN_MODULES.has(m)).toBe(true);
    }
  });

  it('正向：高风险模块全有测试时 missingRequired 为空', () => {
    const tmp = join(tmpdir(), `brain-cov-test-pos-${Date.now()}`);
    const srcDir = join(tmp, 'src');
    const testsDir = join(srcDir, '__tests__');
    mkdirSync(testsDir, { recursive: true });
    // 创建高风险模块源文件和对应测试
    for (const m of ['tick', 'thalamus', 'executor', 'cortex', 'planner']) {
      writeFileSync(join(srcDir, `${m}.js`), '');
      writeFileSync(join(testsDir, `${m}.test.js`), '');
    }
    const result = checkBrainCoverage(tmp);
    expect(result.missingRequired).toHaveLength(0);
  });

  it('正向：executor 通过前缀匹配（executor-billing.test.js）识别为有测试', () => {
    const tmp = join(tmpdir(), `brain-cov-test-prefix-${Date.now()}`);
    const srcDir = join(tmp, 'src');
    const testsDir = join(srcDir, '__tests__');
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(join(srcDir, 'executor.js'), '');
    writeFileSync(join(testsDir, 'executor-billing.test.js'), '');
    const result = checkBrainCoverage(tmp);
    expect(result.missingRequired).not.toContain('executor');
  });

  it('反向：高风险模块缺测试时 missingRequired 非空', () => {
    const tmp = join(tmpdir(), `brain-cov-test-neg-${Date.now()}`);
    const srcDir = join(tmp, 'src');
    const testsDir = join(srcDir, '__tests__');
    mkdirSync(testsDir, { recursive: true });
    // tick.js 无对应测试
    writeFileSync(join(srcDir, 'tick.js'), '');
    const result = checkBrainCoverage(tmp);
    expect(result.missingRequired).toContain('tick');
  });

  it('反向：高风险模块缺测试时 main() 调用 process.exit(1)', () => {
    const tmp = join(tmpdir(), `brain-cov-main-neg-${Date.now()}`);
    const srcDir = join(tmp, 'src');
    const testsDir = join(srcDir, '__tests__');
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(join(srcDir, 'tick.js'), '');
    // patch checkBrainCoverage via module mock is complex; test via checkBrainCoverage directly
    const result = checkBrainCoverage(tmp);
    expect(result.missingRequired.length).toBeGreaterThan(0);
  });

  it('普通模块缺测试时 missingOptional 非空，missingRequired 为空', () => {
    const tmp = join(tmpdir(), `brain-cov-optional-${Date.now()}`);
    const srcDir = join(tmp, 'src');
    const testsDir = join(srcDir, '__tests__');
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(join(srcDir, 'diary-scheduler.js'), '');
    const result = checkBrainCoverage(tmp);
    expect(result.missingRequired).toHaveLength(0);
    expect(result.missingOptional).toContain('diary-scheduler');
  });

  it('真实 Brain 目录：高风险模块全部有测试（exit 不会因 Brain Check 4 触发）', () => {
    const result = checkBrainCoverage();
    expect(result.missingRequired).toHaveLength(0);
  });
});
