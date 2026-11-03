import assert from 'node:assert/strict';
import {it} from 'node:test';
import {existsSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeWorktreeFixture} from './fixtures/native-worktree-fixture.mjs';

it('恶意TMPDIR中的引号、空格和命令替换都是Git路径/argv数据，不执行旁路命令', () => {
  const outer = mkdtempSync(join(tmpdir(), 'native-fixture-security-'));
  const marker = join(outer, 'unexpected-command');
  const hostile = join(outer, `tmp $(touch ${marker}) quote'" space`);
  const originalTmpdir = process.env.TMPDIR;
  let fixture;
  try {
    mkdirSync(hostile, {recursive: true}); process.env.TMPDIR = hostile;
    fixture = nativeWorktreeFixture();
    assert.ok(fixture.base.includes(`$(touch ${marker}) quote'" space`));
    assert.equal(fixture.git('rev-parse', '--show-toplevel'), fixture.repo);
    assert.equal(fixture.git('config', '--get', 'core.hooksPath'), '/dev/null');
    assert.equal(fixture.git('config', '--get', 'user.email'), 'fixture@example.invalid');
    const literal = `value '" $(touch ${marker})`;
    fixture.git('config', 'fixture.literal', literal);
    assert.equal(fixture.git('config', '--get', 'fixture.literal'), literal);
    const shell = fixture.shell('printf "%s\\n" "$1"', [literal]);
    assert.equal(shell.status, 0, shell.stderr); assert.equal(shell.stdout, `${literal}\n`);
    assert.equal(existsSync(marker), false);
  } finally {
    if (originalTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = originalTmpdir;
    fixture?.dispose(); rmSync(outer, {recursive: true, force: true});
  }
});

for (const exitCode of [0, 27]) it(`shell API用真实私有脚本文件保留字面argv并传播退出码${exitCode}`, () => {
  const fixture = nativeWorktreeFixture();
  const marker = join(fixture.base, 'unexpected-shell-command');
  try {
    const literal = `literal '" $(touch ${marker})\nsecond line`;
    const result = fixture.shell('test -f "$0" || exit 91\nprintf "%s\\n" "$0" "$1" "$2" "$FIXTURE_EXTRA"\nexit "$3"\n',
      [literal, 'arg with spaces', String(exitCode)], {FIXTURE_EXTRA: 'override-preserved'});
    assert.equal(result.error, undefined); assert.equal(result.status, exitCode, result.stderr);
    const firstLine = result.stdout.split('\n')[0];
    assert.ok(firstLine.startsWith(join(fixture.base, 'tmp/'))); assert.ok(firstLine.endsWith('.sh'));
    assert.equal(result.stdout.slice(firstLine.length + 1), `${literal}\narg with spaces\noverride-preserved\n`);
    assert.equal(existsSync(firstLine), false); assert.equal(existsSync(marker), false);
  } finally {fixture.dispose();}
});
