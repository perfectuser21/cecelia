import assert from 'node:assert/strict';
import {it} from 'node:test';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {nativeWorktreeFixture} from './fixtures/native-worktree-fixture.mjs';

const script = new URL('../../local-precheck.sh', import.meta.url).pathname;
function fixture() {
  const f = nativeWorktreeFixture();
  for (const dir of ['scripts', 'packages/brain/scripts', 'packages/engine/ci/scripts']) mkdirSync(join(f.repo, dir), {recursive: true});
  copyFileSync(new URL('../../check-version-sync.sh', import.meta.url), join(f.repo, 'scripts/check-version-sync.sh'));
  writeFileSync(join(f.repo, 'packages/brain/package.json'), '{"version":"1.2.3"}');
  writeFileSync(join(f.repo, 'packages/brain/package-lock.json'), '{"version":"1.2.3"}');
  writeFileSync(join(f.repo, 'DEFINITION.md'), 'Brain 版本: 1.2.3\n');
  writeFileSync(join(f.repo, '.brain-versions'), '1.2.3\n');
  writeFileSync(join(f.repo, 'scripts/facts-check.mjs'), "import {appendFileSync} from 'node:fs'; appendFileSync('checked','facts\\n'); process.exit(Number(process.env.PRIVATE_FACTS_EXIT || 0));");
  writeFileSync(join(f.repo, 'packages/brain/scripts/generate-manifest.mjs'), "import assert from 'node:assert/strict'; import {appendFileSync} from 'node:fs'; assert.deepEqual(process.argv.slice(2),['--check']); appendFileSync('checked','manifest\\n'); process.exit(Number(process.env.PRIVATE_MANIFEST_EXIT || 0));");
  writeFileSync(join(f.repo, 'packages/engine/ci/scripts/check-version-sync.sh'), 'printf retired > retired-engine-executed\nexit 17\n');
  return f;
}

it('local-precheck强制验证真实Brain/root版本，旧Engine失败入口不得执行', () => {
  const f = fixture();
  try {
    const result = f.run('bash', [script, '--force']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(join(f.repo, 'packages/engine/retired-engine-executed')), false);
    assert.equal(readFileSync(join(f.repo, 'checked'), 'utf8'), 'facts\nmanifest\n');
    assert.match(result.stdout, /1\.2\.3/);
  } finally {f.dispose();}
});

for (const [label, env] of [['facts', {PRIVATE_FACTS_EXIT: '9'}], ['manifest', {PRIVATE_MANIFEST_EXIT: '13'}]]) {
  it(`local-precheck真实${label}子命令失败不能变绿，其他检查仍执行`, () => {
    const f = fixture();
    try {
      const result = f.run('bash', [script, '--force'], env);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.equal(readFileSync(join(f.repo, 'checked'), 'utf8'), 'facts\nmanifest\n');
    } finally {f.dispose();}
  });
}

it('根版本文件改动也触发现役Brain/root预检，真实版本不一致必须失败', () => {
  const f = fixture();
  try {
    f.git('add', '.'); f.git('commit', '-qm', 'baseline');
    f.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    writeFileSync(join(f.repo, '.brain-versions'), '9.9.9\n');
    f.git('add', '.brain-versions'); f.git('commit', '-qm', 'version drift');
    const result = f.run('bash', [script]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /9\.9\.9/);
    assert.equal(readFileSync(join(f.repo, 'checked'), 'utf8'), 'facts\nmanifest\n');
  } finally {f.dispose();}
});
