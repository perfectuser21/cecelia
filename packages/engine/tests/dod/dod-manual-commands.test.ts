/**
 * dod-manual-commands.test.ts (Phase 7.5)
 *
 * 回归测试：验证 check-manual-cmd-whitelist.cjs 能抓住常见的死 DoD 模式。
 *
 * 背景：Phase 8.3 撞到死 DoD（manual:node -e "...~/.claude/skills/..."）
 * CI runner 上该路径不存在，导致无关 PR CI 失败。这个测试确保将来写死 DoD 会被抓到。
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SCRIPT = join(
  process.cwd(),
  '..',
  '..',
  'scripts',
  'devgate',
  'check-manual-cmd-whitelist.cjs'
);

// 运行脚本，返回 exit code 和 stderr
function runWhitelist(taskCardPath: string): { code: number; stderr: string } {
  try {
    const stdout = execSync(`node "${SCRIPT}" "${taskCardPath}"`, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stderr: stdout.toString() };
  } catch (e: any) {
    return { code: e.status || 1, stderr: (e.stderr || e.stdout || '').toString() };
  }
}

describe('DoD manual: 命令白名单回归（Phase 7.5）', () => {
  let tmpDir: string;

  const makeTaskCard = (body: string): string => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dod-manual-'));
    const file = join(tmpDir, 'DoD.md');
    writeFileSync(file, body);
    return file;
  };

  const cleanup = () => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  };

  it('PASS：白名单内命令（node）通过', () => {
    const file = makeTaskCard(
      `# DoD\n- [x] [ARTIFACT] foo\n  Test: manual:node -e "process.exit(0)"\n`
    );
    const { code } = runWhitelist(file);
    expect(code).toBe(0);
    cleanup();
  });

  it('PASS：白名单内命令（curl/bash/psql/npm/npx/playwright）通过', () => {
    const file = makeTaskCard(
      [
        '# DoD',
        '- [x] a',
        '  Test: manual:curl -sf https://example.com/',
        '- [x] b',
        '  Test: manual:bash -c "echo ok"',
        '- [x] c',
        '  Test: manual:psql -c "SELECT 1"',
        '- [x] d',
        '  Test: manual:npm test',
        '- [x] e',
        '  Test: manual:npx vitest run',
        '- [x] f',
        '  Test: manual:playwright test',
        '',
      ].join('\n')
    );
    const { code } = runWhitelist(file);
    expect(code).toBe(0);
    cleanup();
  });

  it('FAIL：grep -q（非白名单命令）被拦截', () => {
    const file = makeTaskCard(
      `# DoD\n- [x] foo\n  Test: manual:grep -q 'pattern' file\n`
    );
    const { code, stderr } = runWhitelist(file);
    expect(code).toBe(1);
    expect(stderr).toContain('grep');
    cleanup();
  });

  it('FAIL：ls / cat 被拦截', () => {
    const fileLs = makeTaskCard(
      `# DoD\n- [x] a\n  Test: manual:ls -la\n`
    );
    expect(runWhitelist(fileLs).code).toBe(1);
    cleanup();

    const fileCat = makeTaskCard(
      `# DoD\n- [x] b\n  Test: manual:cat file.txt\n`
    );
    expect(runWhitelist(fileCat).code).toBe(1);
    cleanup();
  });

  it('FAIL：echo / printf / find / sed / awk 被拦截', () => {
    const cases = ['echo', 'printf', 'find', 'sed', 'awk'];
    for (const cmd of cases) {
      const file = makeTaskCard(
        `# DoD\n- [x] foo\n  Test: manual:${cmd} something\n`
      );
      const { code } = runWhitelist(file);
      expect(code).toBe(1);
      cleanup();
    }
  });

  it('PASS：多行 DoD 中所有 manual: 命令都在白名单', () => {
    const file = makeTaskCard(
      [
        '# DoD: 复合测试',
        '- [x] 条目 1',
        '  Test: manual:node -e "process.exit(0)"',
        '',
        '- [x] 条目 2',
        '  Test: manual:bash -c "true"',
        '',
        '- [x] 条目 3',
        '  Test: tests/foo/bar.test.ts',
        '',
      ].join('\n')
    );
    const { code } = runWhitelist(file);
    expect(code).toBe(0);
    cleanup();
  });

  it('FAIL：混合 DoD 里只要有一条非白名单就挂', () => {
    const file = makeTaskCard(
      [
        '# DoD',
        '- [x] 好的',
        '  Test: manual:node -e "process.exit(0)"',
        '- [x] 坏的',
        '  Test: manual:grep pattern file',
        '',
      ].join('\n')
    );
    const { code, stderr } = runWhitelist(file);
    expect(code).toBe(1);
    expect(stderr).toMatch(/grep/);
    cleanup();
  });

  it('边界：Test 字段不是 manual: 格式（tests/ 或 contract:）时不检查', () => {
    const file = makeTaskCard(
      [
        '# DoD',
        '- [x] 走 tests/',
        '  Test: tests/foo/bar.test.ts',
        '- [x] 走 contract:',
        '  Test: contract:L1-STOP-HOOK-OWNERSHIP',
        '',
      ].join('\n')
    );
    const { code } = runWhitelist(file);
    expect(code).toBe(0);
    cleanup();
  });
});

describe('scanManualViolations 单元测试（Phase 7.5）', () => {
  // 通过 require 测试内部函数
  const scriptPath = join(
    process.cwd(),
    '..',
    '..',
    'scripts',
    'devgate',
    'check-manual-cmd-whitelist.cjs'
  );

  it('extractManualCommand 提取顶层命令', () => {
    const { extractManualCommand } = require(scriptPath);
    expect(extractManualCommand('  Test: manual:node -e "..."')).toBe('node');
    expect(extractManualCommand('  Test: manual:bash -c "foo"')).toBe('bash');
    expect(extractManualCommand('  Test: manual:grep pattern')).toBe('grep');
    expect(extractManualCommand('  Test: manual:curl https://a.b')).toBe('curl');
    expect(extractManualCommand('- [x] 不含 manual')).toBeNull();
    expect(extractManualCommand('  Test: tests/foo.test.ts')).toBeNull();
  });

  it('ALLOWED_COMMANDS 包含 Cecelia 规范白名单', () => {
    const { ALLOWED_COMMANDS } = require(scriptPath);
    // 这些必须在白名单
    for (const cmd of ['node', 'npm', 'npx', 'curl', 'bash', 'psql', 'playwright']) {
      expect(ALLOWED_COMMANDS.has(cmd)).toBe(true);
    }
    // 这些必须不在
    for (const cmd of ['grep', 'ls', 'cat', 'echo', 'find', 'sed', 'awk', 'printf']) {
      expect(ALLOWED_COMMANDS.has(cmd)).toBe(false);
    }
  });

  it('scanManualViolations 识别违规行号', () => {
    const { scanManualViolations } = require(scriptPath);
    const content = [
      '# DoD',
      '- [x] OK',
      '  Test: manual:node -e "true"',
      '- [x] BAD',
      '  Test: manual:grep pattern',
    ].join('\n');
    const violations = scanManualViolations(content);
    expect(violations).toHaveLength(1);
    expect(violations[0].lineNum).toBe(5);
    expect(violations[0].cmd).toBe('grep');
  });
});
