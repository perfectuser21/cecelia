import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { resolve, join } from 'path';

const SCRIPT = resolve(__dirname, '../../scripts/devgate/check-dod-mapping.cjs');
const ENGINE_ROOT = resolve(__dirname, '../..');

// 直接 import 函数以获取 vitest 覆盖率追踪
const req = createRequire(import.meta.url);
const { validateAssertionStrength, validateBehaviorTestStrength, detectFakeTest } = req(SCRIPT);

function writeDodInsideRepo(content: string): string {
  const dir = mkdtempSync(join(ENGINE_ROOT, '.tmp-dod-'));
  const dodFile = join(dir, '.dod.md');
  writeFileSync(dodFile, content, 'utf8');
  return dodFile;
}

function runScript(dodFile: string): { code: number; stdout: string } {
  const env = { ...process.env, GITHUB_ACTIONS: '' };
  try {
    const stdout = execSync(`node "${SCRIPT}" "${dodFile}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    return { code: 0, stdout };
  } catch (err: any) {
    return { code: err.status ?? 1, stdout: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

describe('断言强度检查 — 弱测试拦截', () => {
  it('manual:node 无断言逻辑（console.log）→ exit 1', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物
  Test: manual:node -e "console.log('ok')"
- [x] [BEHAVIOR] 行为
  Test: manual:node -e "console.log('behavior')"
- [x] [GATE] CI
  Test: manual:npm test
`.trim());
    try {
      const { code, stdout } = runScript(dodFile);
      expect(code).toBe(1);
      expect(stdout).toContain('断言');
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });

  it('manual:node 只有 require 无断言 → exit 1', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物
  Test: manual:node -e "require('fs').readFileSync('x','utf8')"
- [x] [BEHAVIOR] 行为
  Test: manual:node -e "const x = require('path').resolve('.')"
- [x] [GATE] CI
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

describe('断言强度检查 — 强测试放行', () => {
  it('manual:node 含 process.exit 断言 → exit 0', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物
  Test: manual:node -e "if(!require('fs').existsSync('package.json'))process.exit(1)"
- [x] [BEHAVIOR] 行为
  Test: manual:node -e "const{execSync}=require('child_process');try{execSync('echo ok')}catch(e){process.exit(1)}"
- [x] [GATE] CI
  Test: manual:node -e "if(!require('fs').existsSync('package.json'))process.exit(1)"
`.trim());
    try {
      const { code } = runScript(dodFile);
      expect(code).toBe(0);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });

  it('manual:node 含 if/throw 断言 → exit 0', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物
  Test: manual:node -e "const c=require('fs').readFileSync('package.json','utf8');if(!c.includes('name'))throw new Error('missing')"
- [x] [BEHAVIOR] 行为
  Test: manual:node -e "const r=JSON.parse(require('fs').readFileSync('package.json','utf8'));if(!r.name)process.exit(1)"
- [x] [GATE] CI
  Test: manual:node -e "if(!require('fs').existsSync('package.json'))process.exit(1)"
`.trim());
    try {
      const { code } = runScript(dodFile);
      expect(code).toBe(0);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });

  it('manual:bash 含 || exit 断言 → exit 0', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物
  Test: manual:bash -c 'node -e "process.exit(0)" || exit 1'
- [x] [BEHAVIOR] 行为
  Test: manual:bash -c 'R=$(node -e "console.log(1)"); [[ "$R" == "1" ]] || exit 1'
- [x] [GATE] CI
  Test: manual:node -e "if(!require('fs').existsSync('package.json'))process.exit(1)"
`.trim());
    try {
      const { code } = runScript(dodFile);
      expect(code).toBe(0);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });
});

describe('断言强度检查 — 错误提示包含示例', () => {
  it('失败输出包含 node -e 示例模板', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物
  Test: manual:node -e "console.log('ok')"
- [x] [BEHAVIOR] 行为
  Test: manual:node -e "console.log('ok')"
- [x] [GATE] CI
  Test: manual:npm test
`.trim());
    try {
      const { stdout } = runScript(dodFile);
      expect(stdout).toContain('node -e');
      expect(stdout).toContain('process.exit');
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });
});

describe('断言强度检查 — detectFakeTest 向后兼容', () => {
  it('echo 假测试仍被拦截', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物
  Test: echo "pass"
- [x] [BEHAVIOR] 行为
  Test: manual:node -e "if(!true)process.exit(1)"
- [x] [GATE] CI
  Test: manual:npm test
`.trim());
    try {
      const { code } = runScript(dodFile);
      expect(code).toBe(1);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });

  it('grep|wc -l 假测试仍被拦截', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物
  Test: manual:node -e "if(!true)process.exit(1)"
- [x] [BEHAVIOR] 行为
  Test: manual:bash -c "grep pattern file | wc -l"
- [x] [GATE] CI
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

// ─── 直接函数调用的单元测试（覆盖率追踪） ───

describe('validateAssertionStrength — 单元测试', () => {
  it('npm 命令自动放行', () => {
    expect(validateAssertionStrength('npm test').valid).toBe(true);
    expect(validateAssertionStrength('npx vitest').valid).toBe(true);
  });

  it('curl 命令自动放行', () => {
    expect(validateAssertionStrength('curl -f http://localhost').valid).toBe(true);
  });

  it('psql 命令自动放行', () => {
    expect(validateAssertionStrength('psql -c "SELECT 1"').valid).toBe(true);
  });

  it('node -e 无断言 → invalid', () => {
    const result = validateAssertionStrength('node -e "console.log(1)"');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('断言');
  });

  it('node -e 有 process.exit → valid', () => {
    expect(validateAssertionStrength('node -e "if(!true)process.exit(1)"').valid).toBe(true);
  });

  it('node -e 有 throw → valid', () => {
    expect(validateAssertionStrength('node -e "throw new Error()"').valid).toBe(true);
  });

  it('node -e 有 if 条件 → valid', () => {
    expect(validateAssertionStrength('node -e "if(x)y()"').valid).toBe(true);
  });

  it('bash -c 无断言 → invalid', () => {
    const result = validateAssertionStrength('bash -c "echo ok"');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('断言');
  });

  it('bash -c 有 || exit → valid', () => {
    expect(validateAssertionStrength('bash -c "test 1 || exit 1"').valid).toBe(true);
  });

  it('bash 运行 .sh 脚本 → valid', () => {
    expect(validateAssertionStrength('bash -c "node script.js"').valid).toBe(true);
  });

  it('空命令 → valid', () => {
    expect(validateAssertionStrength('').valid).toBe(true);
    expect(validateAssertionStrength(null as any).valid).toBe(true);
  });
});

describe('validateBehaviorTestStrength — 单元测试', () => {
  it('非 BEHAVIOR 类型自动放行', () => {
    expect(validateBehaviorTestStrength('echo ok', 'ARTIFACT').valid).toBe(true);
    expect(validateBehaviorTestStrength('echo ok', 'GATE').valid).toBe(true);
  });

  it('BEHAVIOR 无 Test → invalid', () => {
    const result = validateBehaviorTestStrength(null, 'BEHAVIOR');
    expect(result.valid).toBe(false);
  });

  it('BEHAVIOR tests/ 引用 → valid', () => {
    expect(validateBehaviorTestStrength('tests/foo.test.ts', 'BEHAVIOR').valid).toBe(true);
  });

  it('BEHAVIOR manual:chrome: → valid', () => {
    expect(validateBehaviorTestStrength('manual:chrome:http://localhost', 'BEHAVIOR').valid).toBe(true);
  });

  it('BEHAVIOR manual:curl → valid', () => {
    expect(validateBehaviorTestStrength('manual:curl -f http://localhost/health', 'BEHAVIOR').valid).toBe(true);
  });

  it('BEHAVIOR manual:grep (弱测试) → invalid', () => {
    const result = validateBehaviorTestStrength('manual:grep pattern file', 'BEHAVIOR');
    expect(result.valid).toBe(false);
  });

  it('BEHAVIOR contract: → invalid', () => {
    const result = validateBehaviorTestStrength('contract:some-contract', 'BEHAVIOR');
    expect(result.valid).toBe(false);
  });

  it('BEHAVIOR manual:node → valid', () => {
    expect(validateBehaviorTestStrength('manual:node -e "process.exit(0)"', 'BEHAVIOR').valid).toBe(true);
  });
});

describe('detectFakeTest — 单元测试', () => {
  it('echo → fake', () => {
    expect(detectFakeTest('echo ok').valid).toBe(false);
  });

  it('grep|wc -l → fake', () => {
    expect(detectFakeTest('grep x | wc -l').valid).toBe(false);
  });

  it('node -e 含断言 → not fake', () => {
    expect(detectFakeTest('node -e "if(!x)process.exit(1)"').valid).toBe(true);
  });
});
