import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { HIGH_RISK_DEVGATE_SCRIPTS } from '../../scripts/devgate/check-coverage-completeness.mjs';

const SCRIPT = resolve(__dirname, '../../scripts/devgate/check-dod-mapping.cjs');
// ENGINE_ROOT: packages/engine/（vitest 运行目录）
const ENGINE_ROOT = resolve(__dirname, '../..');

// check-dod-mapping.cjs 要求：
// - 至少 3 条 DoD 条目（含 ARTIFACT + BEHAVIOR + GATE）
// - 所有条目已勾选（[x]）才视为"已验证"
// - 每条条目的 Test 字段格式合规（manual:/tests:/contract:）

// DoD 文件需要在 git repo 内，以便脚本找到 projectRoot
function writeDodInsideRepo(content: string): string {
  const dir = mkdtempSync(join(ENGINE_ROOT, '.tmp-dod-'));
  const dodFile = join(dir, '.dod.md');
  writeFileSync(dodFile, content, 'utf8');
  return dodFile;
}

function runScript(dodFile: string): { code: number; stdout: string } {
  try {
    const stdout = execSync(`node "${SCRIPT}" "${dodFile}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (err: any) {
    return { code: err.status ?? 1, stdout: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

describe('check-dod-mapping.cjs — 高风险白名单注册验证', () => {
  it('check-dod-mapping 在 HIGH_RISK_DEVGATE_SCRIPTS 中（覆盖率白名单）', () => {
    expect(HIGH_RISK_DEVGATE_SCRIPTS.has('check-dod-mapping')).toBe(true);
  });
});

describe('check-dod-mapping.cjs — 脚本源码格式支持断言', () => {
  it('支持 tests/ 格式 Test 字段', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('tests/');
  });

  it('支持 contract: 格式 Test 字段', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('contract:');
  });

  it('支持 manual: 格式 Test 字段', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('manual:');
  });
});

describe('check-dod-mapping.cjs — 有效 DoD（exit 0）', () => {
  it('ARTIFACT+BEHAVIOR+GATE 全含 manual: Test 且已勾选 → exit 0', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物已创建
  Test: manual:node -e "console.log('ok')"
- [x] [BEHAVIOR] 行为符合预期
  Test: manual:node -e "console.log('behavior')"
- [x] [GATE] CI 全部通过
  Test: manual:node -e "process.exit(0)"
`.trim());
    try {
      const { code } = runScript(dodFile);
      expect(code).toBe(0);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });
});

describe('check-dod-mapping.cjs — 无效 DoD（exit 1）', () => {
  it('条目缺少 Test 字段 → exit 1', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物已创建
- [x] [BEHAVIOR] 行为符合预期
  Test: manual:node -e "console.log('ok')"
- [x] [GATE] CI 全部通过
  Test: manual:npm test
`.trim());
    try {
      const { code } = runScript(dodFile);
      expect(code).toBe(1);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });

  it('Test 字段格式不合规 → exit 1', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物已创建
  Test: echo "bad format"
- [x] [BEHAVIOR] 行为符合预期
  Test: manual:node -e "ok"
- [x] [GATE] CI 通过
  Test: manual:npm test
`.trim());
    try {
      const { code } = runScript(dodFile);
      expect(code).toBe(1);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });

  it('条目数不足 3 条 → exit 1', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物已创建
  Test: manual:node -e "ok"
- [x] [GATE] CI 全部通过
  Test: manual:npm test
`.trim());
    try {
      const { code } = runScript(dodFile);
      expect(code).toBe(1);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });
});

describe('check-dod-mapping.cjs — 边界条件', () => {
  it('不存在的 DoD 文件 → exit 1（hard gate 失败）', () => {
    try {
      execSync(`node "${SCRIPT}" "/nonexistent/path/.dod.md"`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(true).toBe(false); // should not reach here
    } catch (err: any) {
      expect(err.status).toBe(1);
    }
  });
});
