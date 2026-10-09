import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = resolve(import.meta.dirname, '../..');
const tag = n => `prod-cecelia-v${n}`;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dashboard-release-bind-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dash = join(root, 'apps/dashboard');
  mkdirSync(join(root, 'bin'), { recursive: true });
  mkdirSync(join(root, 'scripts'));
  mkdirSync(dash, { recursive: true });
  const release = n => join(dash, '.dist-releases', tag(n));
  const seed = (path, sha) => {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'index.html'), `<div>${sha}</div>`);
    writeFileSync(join(path, 'build-info.json'), JSON.stringify({ git_sha: sha }));
  };
  seed(release(1), 'old'); seed(release(2), 'new'); seed(join(dash, 'dist'), 'old');
  writeFileSync(join(release(1), 'frozen-sentinel'), 'must survive');
  writeFileSync(join(root, '.production-release'), `current=${tag(1)}\n`);
  // Only Docker is replaced: capture the exact mount source requested by real scripts.
  writeFileSync(join(root, 'bin/docker'), `#!/bin/sh
printf '%s|%s\\n' "\${DASHBOARD_DIST_DIR:-unset}" "$*" >> "$CECELIA_DEPLOY_ROOT/docker.log"
if [ "\${FAIL_BIND_SOURCE:-}" = "\${DASHBOARD_DIST_DIR:-unset}" ] && [ ! -e "$CECELIA_DEPLOY_ROOT/failed-once" ]; then
  touch "$CECELIA_DEPLOY_ROOT/failed-once"
  exit 1
fi
printf '%s' "\${DASHBOARD_DIST_DIR:-$CECELIA_DEPLOY_ROOT/apps/dashboard/dist}" > "$CECELIA_DEPLOY_ROOT/mounted-source"
`, { mode: 0o755 });
  // Keep the fingerprint step enabled and check the selected mount's real build-info bytes.
  writeFileSync(join(root, 'scripts/check-deploy-fingerprint.sh'), `#!/bin/sh
printf 'checked\\n' >> "$CECELIA_DEPLOY_ROOT/fingerprint.log"
node -e 'const fs=require("fs"),p=fs.readFileSync(process.env.CECELIA_DEPLOY_ROOT+"/mounted-source","utf8");process.exit(JSON.parse(fs.readFileSync(p+"/build-info.json")).git_sha===process.env.EXPECTED_GIT_SHA?0:1)'
`);
  const run = (script, args = [], extra = {}) => {
    const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, CECELIA_DEPLOY_ROOT: root,
      CECELIA_SKIP_HK: '1', CECELIA_SKIP_BRAIN_PROMOTE: '1', CECELIA_SKIP_GIT_TAG: '1', ...extra };
    delete env.CECELIA_SKIP_FRONTEND_RECREATE; delete env.CECELIA_SKIP_FINGERPRINT;
    return spawnSync('bash', [join(repo, 'scripts', script), ...args], { env, encoding: 'utf8' });
  };
  return { root, dash, release, seed, run,
    read: p => readFileSync(join(root, p), 'utf8'),
    promote: (n, env) => run('promote-dashboard.sh', ['--deploy', tag(n)], env),
    rollback: (n, env) => run('rollback-cecelia.sh', [tag(n)], env) };
}
const succeeded = r => assert.equal(r.status, 0, r.stdout + r.stderr);

test('Compose defaults to dist and honors an explicit immutable release source', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, '.env.docker'), '');
  // Configuration rendering is read-only: no daemon/container actions or real env files.
  for (const override of [null, f.release(2)]) {
    const env = { ...process.env, CECELIA_INTERNAL_ENV_FILE: join(f.root, 'missing.env') };
    delete env.DASHBOARD_DIST_DIR;
    if (override) env.DASHBOARD_DIST_DIR = override;
    const r = spawnSync('docker', ['compose', '--project-directory', f.root, '--env-file', join(f.root, '.env.docker'),
      '-f', join(repo, 'docker-compose.yml'), 'config', '--format', 'json'], { env, encoding: 'utf8' });
    succeeded(r);
    const mount = JSON.parse(r.stdout).services.frontend.volumes.find(v => v.target === '/app');
    assert.equal(mount.source, override || join(f.dash, 'dist'));
  }
});

test('promote mounts the frozen release, keeps existing releases immutable, and runs SHA verification', t => {
  const f = fixture(t); succeeded(f.promote(2));
  assert.equal(f.read('mounted-source'), f.release(2));
  assert.ok(existsSync(join(f.release(1), 'frozen-sentinel')), 'prior frozen release was replaced by live dist');
  assert.match(f.read('docker.log'), /up -d --force-recreate --no-deps frontend/);
  assert.equal(f.read('fingerprint.log'), 'checked\n');
  assert.match(f.read('.production-release'), /current=prod-cecelia-v2/);
});

test('repeated deploy of the same release never replaces its mounted directory', t => {
  const f = fixture(t); succeeded(f.promote(1));
  assert.ok(existsSync(join(f.release(1), 'frozen-sentinel')));
  assert.equal(f.read('mounted-source'), f.release(1));
});

test('failed promote restores the previous immutable mount and leaves the pointer unchanged', t => {
  const f = fixture(t);
  const r = f.promote(2, { FAIL_BIND_SOURCE: f.release(2) });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.equal(f.read('mounted-source'), f.release(1));
  assert.match(f.read('.production-release'), /current=prod-cecelia-v1/);
  assert.equal(JSON.parse(f.read('apps/dashboard/dist/build-info.json')).git_sha, 'old');
});

test('rollback rebinds the target frozen release before moving the pointer', t => {
  const f = fixture(t); succeeded(f.promote(2)); succeeded(f.rollback(1));
  assert.equal(f.read('mounted-source'), f.release(1));
  assert.match(f.read('.production-release'), /current=prod-cecelia-v1/);
});

test('failed rollback restores the current frozen mount and leaves current unchanged', t => {
  const f = fixture(t); succeeded(f.promote(2));
  const r = f.rollback(1, { FAIL_BIND_SOURCE: f.release(1) });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.equal(f.read('mounted-source'), f.release(2));
  assert.match(f.read('.production-release'), /current=prod-cecelia-v2/);
  assert.equal(JSON.parse(f.read('apps/dashboard/dist/build-info.json')).git_sha, 'new');
});

test('release-only retention never deletes the currently mounted old release', t => {
  const f = fixture(t);
  for (let n = 3; n <= 7; n++) f.seed(f.release(n), `sha-${n}`);
  f.seed(join(f.dash, '.dist-staging'), 'staged');
  writeFileSync(join(f.dash, '.staging-pending'), `staging_dist=${f.dash}/.dist-staging\n`);
  succeeded(f.run('promote-dashboard.sh', ['--release-only']));
  assert.ok(existsSync(join(f.release(1), 'frozen-sentinel')), 'retention removed the active mount source');
});
