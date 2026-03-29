import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { resolve, join } from 'path';

const SCRIPT = resolve(__dirname, '../../scripts/devgate/check-dod-mapping.cjs');
const ENGINE_ROOT = resolve(__dirname, '../..');

// 直接 import 函数以获取 V8 覆盖率追踪
const req = createRequire(import.meta.url);
const { detectCiIncompatibleCommand } = req(SCRIPT);

function writeDodInsideRepo(content: string): string {
  const dir = mkdtempSync(join(ENGINE_ROOT, '.tmp-dod-ci-'));
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

describe('detectCiIncompatibleCommand — 单元测试', () => {
  it('curl localhost → invalid', () => {
    expect(detectCiIncompatibleCommand('curl localhost:5221/api').valid).toBe(false);
  });
  it('curl 127.0.0.1 → invalid', () => {
    expect(detectCiIncompatibleCommand('curl 127.0.0.1:5221/health').valid).toBe(false);
  });
  it('curl 0.0.0.0 → invalid', () => {
    expect(detectCiIncompatibleCommand('curl 0.0.0.0:3000/test').valid).toBe(false);
  });
  it('curl $BRAIN_URL → invalid', () => {
    expect(detectCiIncompatibleCommand('curl $BRAIN_URL/api').valid).toBe(false);
  });
  it('psql → invalid', () => {
    expect(detectCiIncompatibleCommand('psql cecelia -c "select 1"').valid).toBe(false);
  });
  it('npm test → invalid', () => {
    expect(detectCiIncompatibleCommand('npm test').valid).toBe(false);
  });
  it('npm run test → invalid', () => {
    expect(detectCiIncompatibleCommand('npm run test').valid).toBe(false);
  });
  it('npx vitest → invalid', () => {
    expect(detectCiIncompatibleCommand('npx vitest run').valid).toBe(false);
  });
  it('node -e 命令 → valid', () => {
    expect(detectCiIncompatibleCommand('node -e "require(\'fs\').accessSync(\'x\')"').valid).toBe(true);
  });
  it('curl https:// 外部 URL → valid', () => {
    expect(detectCiIncompatibleCommand('curl -sf https://api.example.com/health').valid).toBe(true);
  });
  it('空命令 → valid', () => {
    expect(detectCiIncompatibleCommand('').valid).toBe(true);
  });
  it('失败原因包含替代建议', () => {
    const result = detectCiIncompatibleCommand('curl localhost:5221/api');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/node -e|tests\//);
  });
});

describe('check-dod-mapping.cjs — CI 不兼容命令检测', () => {
  it('manual:curl localhost:... → exit 1，提示用 node -e 替代', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物已创建
  Test: manual:node -e "require('fs').accessSync('packages/engine/package.json')"
- [x] [BEHAVIOR] API 返回正确数据
  Test: manual:curl localhost:5221/api/brain/tasks
- [x] [GATE] CI 全部通过
  Test: manual:node -e "require('fs').accessSync('packages/engine/scripts/devgate/check-dod-mapping.cjs')"
`.trim());
    try {
      const { code, stdout } = runScript(dodFile);
      expect(code).toBe(1);
      expect(stdout).toMatch(/node -e/);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });

  it('manual:curl 127.0.0.1:... → exit 1', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物已创建
  Test: manual:node -e "require('fs').accessSync('packages/engine/package.json')"
- [x] [BEHAVIOR] 服务响应
  Test: manual:curl 127.0.0.1:5221/health
- [x] [GATE] CI 全部通过
  Test: manual:node -e "require('fs').accessSync('packages/engine/scripts/devgate/check-dod-mapping.cjs')"
`.trim());
    try {
      const { code } = runScript(dodFile);
      expect(code).toBe(1);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });

  it('manual:psql ... → exit 1，提示用 tests/ 替代', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物已创建
  Test: manual:node -e "require('fs').accessSync('packages/engine/package.json')"
- [x] [BEHAVIOR] 数据库表存在
  Test: manual:psql cecelia -c "select count(*) from tasks"
- [x] [GATE] CI 全部通过
  Test: manual:node -e "require('fs').accessSync('packages/engine/scripts/devgate/check-dod-mapping.cjs')"
`.trim());
    try {
      const { code, stdout } = runScript(dodFile);
      expect(code).toBe(1);
      expect(stdout).toMatch(/PostgreSQL|tests\//);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });

  it('manual:npm test → exit 1，提示用 tests/ 替代', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物已创建
  Test: manual:node -e "require('fs').accessSync('packages/engine/package.json')"
- [x] [BEHAVIOR] 测试全部通过
  Test: manual:npm test
- [x] [GATE] CI 全部通过
  Test: manual:node -e "require('fs').accessSync('packages/engine/scripts/devgate/check-dod-mapping.cjs')"
`.trim());
    try {
      const { code, stdout } = runScript(dodFile);
      expect(code).toBe(1);
      expect(stdout).toMatch(/node_modules|tests\//);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });

  it('manual:npm run test → exit 1', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物已创建
  Test: manual:node -e "require('fs').accessSync('packages/engine/package.json')"
- [x] [BEHAVIOR] 测试全部通过
  Test: manual:npm run test
- [x] [GATE] CI 全部通过
  Test: manual:node -e "require('fs').accessSync('packages/engine/scripts/devgate/check-dod-mapping.cjs')"
`.trim());
    try {
      const { code } = runScript(dodFile);
      expect(code).toBe(1);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });

  it('manual:node -e "..." → exit 0（CI 兼容命令正常通过）', () => {
    const dodFile = writeDodInsideRepo(`
- [x] [ARTIFACT] 产出物已创建
  Test: manual:node -e "if(!require('fs').existsSync('packages/engine/package.json'))process.exit(1)"
- [x] [BEHAVIOR] 文件包含正确内容
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/package.json','utf8');if(!c.includes('engine'))process.exit(1)"
- [x] [GATE] CI 全部通过
  Test: manual:node -e "if(!require('fs').existsSync('packages/engine/scripts/devgate/check-dod-mapping.cjs'))process.exit(1)"
`.trim());
    try {
      const { code } = runScript(dodFile);
      expect(code).toBe(0);
    } finally {
      rmSync(require('path').dirname(dodFile), { recursive: true });
    }
  });
});
