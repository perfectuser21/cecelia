import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('旧 Harness 发布和版本号猜测发布结果的入口已退役', () => {
  for (const path of [
    'scripts/post-merge-deploy.sh',
    'scripts/deploy.sh',
    'scripts/ci/assert-deploy-effect.sh',
  ]) assert.equal(existsSync(new URL(path, root)), false, `${path} 不得重新成为发布入口`);
});

test('任务执行器不再把任务完成当作正式发布指令', () => {
  const commands = read('packages/brain/scripts/cecelia-run.sh')
    .split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  assert.doesNotMatch(commands, /deploy-local\.sh|brain-deploy\.sh|DEPLOY_CHANGED/);
});

test('tick 与周期调度均不能根据 main 漂移自行发布', () => {
  for (const path of ['packages/brain/src/tick-scheduler.js', 'packages/brain/src/scheduler-jobs.js']) {
    assert.doesNotMatch(read(path), /runDriftSentinel|cron\/drift-sentinel\.js/);
  }
  assert.equal(existsSync(new URL('packages/brain/src/cron/drift-sentinel.js', root)), false);
});

test('发布验收仍保留隔离候选闸门和真实运行身份', () => {
  assert.match(read('scripts/brain-deploy.sh'), /stage_candidate "\$EXPECTED_SHA" "\$CECELIA_RELEASE_IMAGE"/);
  assert.match(read('packages/brain/src/routes/goals.js'), /version:\s*pkg\.version/);
  assert.match(read('scripts/lib/bluegreen.sh'), /EXPECTED_SHA/);
});


test('Brain 裸跑安装与模式切换入口全部退役，PG和执行器安装仍保留', () => {
  for (const path of [
    'packages/brain/deploy/com.cecelia.brain.plist',
    'scripts/brain-docker-up.sh', 'scripts/brain-docker-down.sh',
    'scripts/brain-docker-smoke.sh', 'scripts/brain-reload.sh',
  ]) assert.equal(existsSync(new URL(path, root)), false, `${path} 不得恢复旧Brain`);
  for (const path of ['packages/brain/deploy/install.sh', 'scripts/setup-autostart.sh']) {
    assert.equal(read(path).includes('com.cecelia.brain'), false, `${path} 不得启动裸跑Brain`);
  }
  assert.match(read('packages/brain/deploy/install.sh'), /cecelia-run\.sh/);
  assert.equal(existsSync(new URL('packages/brain/deploy/cecelia-watchdog.sh', root)), false);
  assert.match(read('scripts/setup-autostart.sh'), /launchctl bootstrap system "\$PG17_PLIST"/);
});

test('Docker不可达且遗留旧plist时，真实发布脚本仍只规划Docker隔离验收', t => {
  const directory = mkdtempSync(join(tmpdir(), 'retired-brain-launchd-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  for (const path of ['scripts/lib', 'packages/brain', 'home/Library/LaunchAgents', 'bin']) {
    mkdirSync(join(directory, path), {recursive: true});
  }
  cpSync(new URL('scripts/lib/', root), join(directory, 'scripts/lib'), {recursive: true});
  const original = read('scripts/brain-deploy.sh');
  const statusLine = 'DEPLOY_STATUS_FILE="/tmp/cecelia-deploy-status.json"';
  assert.equal(original.split(statusLine).length, 2);
  writeFileSync(join(directory, 'scripts/brain-deploy.sh'), original.replace(statusLine,
    `DEPLOY_STATUS_FILE="${directory}/deploy-status.json"`));
  writeFileSync(join(directory, 'packages/brain/package.json'), '{"version":"9.9.9"}');
  writeFileSync(join(directory, 'home/Library/LaunchAgents/com.cecelia.brain.plist'), '<plist/>');
  for (const name of ['docker', 'curl', 'ssh', 'launchctl']) {
    writeFileSync(join(directory, 'bin', name), '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$BOUNDARY_CALLS"\nexit 97\n', {mode: 0o755});
  }
  const calls = join(directory, 'calls');
  const result = spawnSync('bash', [join(directory, 'scripts/brain-deploy.sh'), '--dry-run'], {
    cwd: directory, encoding: 'utf8', timeout: 10000,
    env: {...process.env, HOME: join(directory, 'home'), HOST_HOME: join(directory, 'home'),
      PATH: `${join(directory, 'bin')}:${process.env.PATH}`, BOUNDARY_CALLS: calls},
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout.includes('mode=docker'), true);
  assert.equal(result.stdout.includes('staging 同 SHA/镜像/隔离验证先于生产迁移'), true);
  assert.equal(/launchctl|\[dry-run\] node .*src\/migrate\.js/.test(result.stdout), false);
  const trace = existsSync(calls) ? readFileSync(calls, 'utf8') : '';
  assert.equal(/launchctl|curl|ssh/.test(trace), false);
  assert.equal(existsSync(join(directory, 'deploy-status.json')), false);
});

test('Docker发布后的Bridge按自身plist恢复，不依赖已删除Brain裸跑模式', t => {
  const directory = mkdtempSync(join(tmpdir(), 'bridge-own-service-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  mkdirSync(join(directory, 'Library/LaunchAgents'), {recursive: true});
  writeFileSync(join(directory, 'Library/LaunchAgents/com.cecelia.bridge.plist'), '<plist/>');
  const source = read('scripts/lib/brain-post-deploy.sh');
  const begin = source.indexOf('      # 重启 bridge');
  const end = source.indexOf('\n    else\n      echo "  WARN: $BRIDGE_SRC', begin);
  assert.equal(begin >= 0 && end > begin, true);
  const calls = join(directory, 'calls');
  const script = `uname() { echo Darwin; }
launchctl() { printf '%s\\n' "$*" >> "$BRIDGE_CALLS"; }
systemctl() { echo unexpected-systemctl >&2; return 91; }
` + source.slice(begin, end);
  const result = spawnSync('bash', ['-eu', '-c', script], {
    encoding: 'utf8', timeout: 10000,
    env: {...process.env, HOME: directory, DEPLOY_MODE: 'docker', BRIDGE_CALLS: calls},
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(calls), true);
  assert.match(readFileSync(calls, 'utf8'), /^kickstart -k gui\/\d+\/com\.cecelia\.bridge\n$/);
});

test('真实安装器不再安装故障时会裸跑Brain的旧watchdog', t => {
  const directory = mkdtempSync(join(tmpdir(), 'retired-watchdog-install-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  for (const path of ['packages/brain/deploy', 'packages/brain/scripts', 'home/bin', 'logs']) {
    mkdirSync(join(directory, path), {recursive: true});
  }
  const original = read('packages/brain/deploy/install.sh');
  const symlink = 'SYMLINK="/Users/administrator/bin/cecelia-run"';
  assert.equal(original.split(symlink).length, 2);
  writeFileSync(join(directory, 'packages/brain/deploy/install.sh'), original.replace(symlink,
    `SYMLINK="${directory}/home/bin/cecelia-run"`));
  writeFileSync(join(directory, 'packages/brain/scripts/cecelia-run.sh'), '#!/bin/sh\nexit 96\n');
  const sourceWatchdog = new URL('packages/brain/deploy/cecelia-watchdog.sh', root);
  if (existsSync(sourceWatchdog)) cpSync(sourceWatchdog, join(directory, 'packages/brain/deploy/cecelia-watchdog.sh'));
  const env = {...process.env, HOME: join(directory, 'home')};
  const install = spawnSync('bash', [join(directory, 'packages/brain/deploy/install.sh')], {
    env, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(install.status, 0, install.stdout + install.stderr);
  assert.equal(existsSync(join(directory, 'home/bin/cecelia-run')), true);
  const installed = join(directory, 'home/bin/cecelia-watchdog.sh');
  const calls = join(directory, 'calls');
  if (existsSync(installed)) {
    // 仅更换明确的I/O根；执行旧脚本本身，所有服务故障与进程创建都由函数stub承接。
    let script = readFileSync(installed, 'utf8');
    for (const [name, value] of [['BRAIN_DIR', join(directory, 'packages/brain')], ['LOG_DIR', join(directory, 'logs')]]) {
      const declaration = new RegExp(`^${name}="[^"\\n]*"$`, 'm');
      assert.equal(declaration.test(script), true);
      script = script.replace(declaration, `${name}="${value}"`);
    }
    writeFileSync(installed, script);
    const run = spawnSync('bash', ['-eu', '-c', `
curl() { printf 'curl\\n' >> "$STUB_CALLS"; return 1; }
node() { printf 'node\\n' >> "$STUB_CALLS"; }
nohup() { node "$@"; }
source "$1"
wait
`, '_', installed], {env: {...env, STUB_CALLS: calls}, encoding: 'utf8', timeout: 10000});
    assert.equal(run.status, 0, run.stdout + run.stderr);
  }
  const trace = existsSync(calls) ? readFileSync(calls, 'utf8') : '';
  assert.equal(trace.includes('node'), false, '5221不可达不能恢复本地裸跑Brain');
  assert.equal(existsSync(installed), false, '安装器不得恢复旧watchdog');
});
