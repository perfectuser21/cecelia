import { it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nativeWorktreeFixture } from '../helpers/native-worktree-fixture';

it('恶意TMPDIR中的引号、空格和命令替换均为Git路径/argv数据，不执行旁路命令', () => {
  const outer = mkdtempSync(join(tmpdir(), 'native-fixture-security-'));
  const marker = join(outer, 'unexpected-command');
  const hostile = join(outer, `tmp $(touch ${marker}) quote'" space`);
  const originalTmpdir = process.env.TMPDIR;
  let fixture: ReturnType<typeof nativeWorktreeFixture> | undefined;
  try {
    mkdirSync(hostile, { recursive: true });
    process.env.TMPDIR = hostile;
    fixture = nativeWorktreeFixture();
    expect(fixture.base).toContain(`$(touch ${marker}) quote'" space`);
    expect(fixture.git('rev-parse', '--show-toplevel')).toBe(fixture.repo);
    expect(fixture.git('config', '--get', 'core.hooksPath')).toBe('/dev/null');
    expect(fixture.git('config', '--get', 'user.email')).toBe('fixture@example.invalid');
    const literal = `value '" $(touch ${marker})`;
    fixture.git('config', 'fixture.literal', literal);
    expect(fixture.git('config', '--get', 'fixture.literal')).toBe(literal);
    const shell = fixture.shell('printf "%s\\n" "$1"', [literal]);
    expect(shell.status, shell.stderr).toBe(0);
    expect(shell.stdout).toBe(`${literal}\n`);
    expect(existsSync(marker)).toBe(false);
  } finally {
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
    fixture?.dispose();
    rmSync(outer, { recursive: true, force: true });
  }
});

it.each([0, 27])('shell API通过真实临时脚本文件执行，argv保留引号/命令替换字面量并传播退出码%d', exitCode => {
  const fixture = nativeWorktreeFixture();
  const marker = join(fixture.base, 'unexpected-shell-command');
  try {
    const literal = `literal '" $(touch ${marker})\nsecond line`;
    const result = fixture.shell('test -f "$0" || exit 91\nprintf "%s\\n" "$0" "$1" "$2" "$FIXTURE_EXTRA"\nexit "$3"\n',
      [literal, 'arg with spaces', String(exitCode)], { FIXTURE_EXTRA: 'override-preserved' });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(exitCode);
    const firstLine = result.stdout.split('\n')[0];
    expect(firstLine.startsWith(join(fixture.base, 'tmp/'))).toBe(true);
    expect(firstLine.endsWith('.sh')).toBe(true);
    expect(result.stdout.slice(firstLine.length + 1)).toBe(`${literal}\narg with spaces\noverride-preserved\n`);
    expect(existsSync(firstLine)).toBe(false);
    expect(existsSync(marker)).toBe(false);
  } finally { fixture.dispose(); }
});
