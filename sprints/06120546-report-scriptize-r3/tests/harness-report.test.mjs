import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, execSync } from 'child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SCRIPT = 'packages/brain/scripts/harness-report.mjs';

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-report-test-'));
  writeFileSync(join(dir, 'sprint-prd.md'), '# Sprint PRD — fixture\n## journey_type: autonomous\n');
  return dir;
}

function runScript(args, env = {}) {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exit: 0, output: out };
  } catch (e) {
    return { exit: e.status ?? 1, output: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

describe('harness-report.mjs — 存在性 [BEHAVIOR]', () => {
  it('脚本文件存在', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it('缺少参数时 exit 非零 + 输出 CLI 错误提示', () => {
    const { exit, output } = runScript([]);
    expect(exit).not.toBe(0);
    // 确保是 CLI 自身报的参数缺失错误（而非 node 找不到脚本的 MODULE_NOT_FOUND 假绿）
    expect(output).toMatch(/sprint-dir|required|missing argument/i);
  });
});

describe('harness-report.mjs — S2 harness-report.md 生成 [BEHAVIOR]', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('harness-report.md 生成且非空', () => {
    dir = makeFixture();
    runScript(['--sprint-dir', dir, '--task-id', '00000000-0000-0000-0000-000000000001',
               '--pr-url', 'https://github.com/test/1', '--feature-id', 'fake']);
    expect(existsSync(join(dir, 'harness-report.md'))).toBe(true);
    const content = readFileSync(join(dir, 'harness-report.md'), 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });
});

describe('harness-report.mjs — S3 learning.md 生成 [BEHAVIOR]', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('learning.md 存在且非空', () => {
    dir = makeFixture();
    runScript(['--sprint-dir', dir, '--task-id', '00000000-0000-0000-0000-000000000001',
               '--pr-url', 'https://github.com/test/1', '--feature-id', 'fake']);
    expect(existsSync(join(dir, 'learning.md'))).toBe(true);
    const content = readFileSync(join(dir, 'learning.md'), 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });
});

describe('harness-report.mjs — S4 index.html 生成 [BEHAVIOR]', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('index.html 存在且含 HTML 结构', () => {
    dir = makeFixture();
    runScript(['--sprint-dir', dir, '--task-id', '00000000-0000-0000-0000-000000000001',
               '--pr-url', 'https://github.com/test/1', '--feature-id', 'fake']);
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
    const content = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(content.toLowerCase()).toMatch(/html/);
  });
});

describe('harness-report.mjs — 幂等性 [BEHAVIOR]', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('重复执行第二次 exit 0', () => {
    dir = makeFixture();
    const args = ['--sprint-dir', dir, '--task-id', '00000000-0000-0000-0000-000000000001',
                  '--pr-url', 'https://github.com/test/1', '--feature-id', 'fake'];
    runScript(args);
    const { exit } = runScript(args);
    expect(exit).toBe(0);
  });
});

describe('harness-report.mjs — PARTIAL_FAIL [BEHAVIOR]', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('Brain API 不可达时 exit 非零 + 输出 PARTIAL_FAIL + harness-report.md 仍生成', () => {
    dir = makeFixture();
    const { exit, output } = runScript(
      ['--sprint-dir', dir, '--task-id', '00000000-0000-0000-0000-000000000099',
       '--pr-url', 'https://github.com/test/1', '--feature-id', 'fake'],
      { BRAIN_URL: 'http://localhost:19999' }
    );
    expect(exit).not.toBe(0);
    expect(output).toContain('PARTIAL_FAIL');
    expect(existsSync(join(dir, 'harness-report.md'))).toBe(true);
  });
});

describe('harness-report.mjs — git 零接触 [BEHAVIOR]', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('执行前后 git status --porcelain 不变', () => {
    dir = makeFixture();
    const gitBefore = execSync('git status --porcelain 2>/dev/null | sort | md5sum', { encoding: 'utf8' });
    const result = runScript(['--sprint-dir', dir, '--task-id', '00000000-0000-0000-0000-000000000001',
               '--pr-url', 'https://github.com/test/1', '--feature-id', 'fake']);
    // guard：脚本必须实际运行成功，否则 git 比对无意义（脚本不存在时此行使测试 FAIL）
    expect(result.exit).toBe(0);
    const gitAfter = execSync('git status --porcelain 2>/dev/null | sort | md5sum', { encoding: 'utf8' });
    expect(gitBefore).toBe(gitAfter);
  });
});

describe('harness-report.mjs — feature-id 空时 S6 跳过 [BEHAVIOR]', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('feature-id 为空时文件仍生成，不 crash', () => {
    dir = makeFixture();
    runScript(['--sprint-dir', dir, '--task-id', '00000000-0000-0000-0000-000000000001',
               '--pr-url', 'https://github.com/test/1', '--feature-id', '']);
    expect(existsSync(join(dir, 'harness-report.md'))).toBe(true);
  });
});
