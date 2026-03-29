import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const SCRIPT = resolve(__dirname, '../../scripts/devgate/playwright-evaluator.sh');
const ENGINE_ROOT = resolve(__dirname, '../..');

function createTempDir(): string {
  return mkdtempSync(join(ENGINE_ROOT, '.tmp-eval-'));
}

function runEvaluator(
  taskCardPath: string,
  branch: string,
  projectRoot: string
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(
      `bash "${SCRIPT}" "${taskCardPath}" "${branch}" "${projectRoot}"`,
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, BRAIN_URL: 'http://localhost:99999' },
        timeout: 15000,
      }
    );
    return { code: 0, stdout, stderr: '' };
  } catch (err: any) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

function readSealFile(dir: string, branch: string): Record<string, any> | null {
  const sealPath = join(dir, `.dev-gate-evaluator.${branch}`);
  if (!existsSync(sealPath)) return null;
  const raw = readFileSync(sealPath, 'utf8');
  if (!raw || raw.length === 0) return null;
  return JSON.parse(raw);
}

describe('playwright-evaluator.sh — 参数校验', () => {
  it('无参数时 exit 2', () => {
    const result = runEvaluator('', '', '');
    expect(result.code).toBe(2);
  });

  it('缺少 branch 参数时 exit 2', () => {
    const result = runEvaluator('/tmp/nonexistent', '', '/tmp');
    expect(result.code).toBe(2);
  });

  it('Task Card 不存在时 exit 2', () => {
    const result = runEvaluator('/tmp/nonexistent-card.md', 'test-branch', '/tmp');
    expect(result.code).toBe(2);
  });
});

describe('playwright-evaluator.sh — 脚本存在性与可执行', () => {
  it('脚本文件存在', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it('脚本包含 Brain /health 健康检查', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('/health');
    expect(content).toContain('BRAIN_URL');
  });

  it('脚本包含 [BEHAVIOR] 提取逻辑', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('[BEHAVIOR]');
    expect(content).toContain('BEHAVIOR_TESTS');
  });

  it('脚本包含 seal 文件写入逻辑', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('.dev-gate-evaluator.');
    expect(content).toContain('verdict');
    expect(content).toContain('SEAL_FILE');
  });

  it('脚本支持 manual:/tests:/contract: 三种 Test 类型', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain("'^manual:'");
    expect(content).toContain("'^tests/'");
    expect(content).toContain("'^contract:'");
  });
});

describe('playwright-evaluator.sh — 退出码行为', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('无 BEHAVIOR 条目时 exit 0', () => {
    const taskCard = join(tmpDir, '.task-test.md');
    writeFileSync(taskCard, `# Task Card
## DoD
- [x] [ARTIFACT] 文件存在
  Test: manual:node -e "process.exit(0)"
`);

    const result = runEvaluator(taskCard, 'test-branch', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('找到 0 条');
    expect(result.stdout).toContain('seal 文件已写入');
  });

  it('BEHAVIOR 全部通过时 exit 0', () => {
    const taskCard = join(tmpDir, '.task-test.md');
    writeFileSync(taskCard, `# Task Card
## DoD
- [x] [BEHAVIOR] 返回 true
  Test: manual:node -e "process.exit(0)"
- [x] [BEHAVIOR] 另一个通过
  Test: manual:node -e "process.exit(0)"
`);

    const result = runEvaluator(taskCard, 'test-branch', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('pass');
  });

  it('BEHAVIOR 有失败时 exit 1', () => {
    const taskCard = join(tmpDir, '.task-test.md');
    writeFileSync(taskCard, `# Task Card
## DoD
- [x] [BEHAVIOR] 应该失败
  Test: manual:node -e "process.exit(1)"
`);

    const result = runEvaluator(taskCard, 'test-branch', tmpDir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('fail');
  });

  it('tests/ 引用：文件存在时 exit 0', () => {
    mkdirSync(join(tmpDir, 'tests'), { recursive: true });
    writeFileSync(join(tmpDir, 'tests', 'example.test.ts'), 'test');
    const taskCard = join(tmpDir, '.task-test.md');
    writeFileSync(taskCard, `# Task Card
## DoD
- [x] [BEHAVIOR] 测试文件存在
  Test: tests/example.test.ts
`);

    const result = runEvaluator(taskCard, 'test-branch', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('PASS');
  });

  it('contract: 引用时 exit 0（被 SKIP）', () => {
    const taskCard = join(tmpDir, '.task-test.md');
    writeFileSync(taskCard, `# Task Card
## DoD
- [x] [BEHAVIOR] contract 引用
  Test: contract:RCI-001
`);

    const result = runEvaluator(taskCard, 'test-branch', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('SKIP');
  });

  it('Brain 不可达时不算失败', () => {
    const taskCard = join(tmpDir, '.task-test.md');
    writeFileSync(taskCard, `# Task Card
## DoD
- [x] [BEHAVIOR] 通过
  Test: manual:node -e "process.exit(0)"
`);

    const result = runEvaluator(taskCard, 'test-branch', tmpDir);
    expect(result.code).toBe(0);
    // Brain 不可达显示 SKIP
    expect(result.stdout).toContain('SKIP');
    expect(result.stdout).toContain('/health');
  });
});

describe('playwright-evaluator.sh — seal 文件生成', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('成功时生成 seal 文件（通过 stdout 确认路径）', () => {
    const taskCard = join(tmpDir, '.task-test.md');
    writeFileSync(taskCard, `# Task Card
## DoD
- [x] [BEHAVIOR] 通过
  Test: manual:node -e "process.exit(0)"
`);

    const result = runEvaluator(taskCard, 'test-branch', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('.dev-gate-evaluator.test-branch');
    expect(result.stdout).toContain('seal 文件已写入');
  });

  it('失败时也生成 seal 文件', () => {
    const taskCard = join(tmpDir, '.task-test.md');
    writeFileSync(taskCard, `# Task Card
## DoD
- [x] [BEHAVIOR] 应该失败
  Test: manual:node -e "process.exit(1)"
`);

    const result = runEvaluator(taskCard, 'test-branch', tmpDir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('.dev-gate-evaluator.test-branch');
    expect(result.stdout).toContain('seal 文件已写入');
  });
});
