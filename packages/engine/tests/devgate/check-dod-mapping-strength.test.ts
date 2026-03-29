import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { resolve, join } from 'path';

const SCRIPT = resolve(__dirname, '../../scripts/devgate/check-dod-mapping.cjs');
const ENGINE_ROOT = resolve(__dirname, '../..');

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
  Test: manual:npm test
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
  Test: manual:npm test
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
  Test: manual:npm test
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
