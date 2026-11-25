import test from 'node:test';
import assert from 'node:assert/strict';
import {accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import yaml from 'js-yaml';

const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'));
const action = yaml.load(readFileSync(new URL('../../../.github/actions/dockerhub-mirror/action.yml', import.meta.url), 'utf8'));
const mirrorCommand = action.runs.steps.map(step => step.run).join('\n');

test('真实矩阵只撤出镜像与前端的无消费者安装，其他九项保留原APT链', () => {
  const install = workflow.jobs.checks.steps.find(step => step.name === 'Install test tools');
  assert.equal(install.run, 'sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends ripgrep jq zsh libxml2-utils');
  assert.ok(!install['continue-on-error']);
  let retained = 0;
  for (const matrix of workflow.jobs.checks.strategy.matrix.include) {
    const selected = install.if === undefined ? true : runInNewContext(install.if, {matrix});
    assert.equal(selected, !['image', 'dashboard'].includes(matrix.component), JSON.stringify(matrix));
    if (selected) retained++;
  }
  assert.equal(retained, 9);
  assert.ok(workflow.jobs.checks.steps.find(step => step.name === 'Run actual checks').if === undefined);
});

function executable(name) {
  for (const directory of process.env.PATH.split(delimiter)) {
    const path = join(directory, name);
    try { accessSync(path, constants.X_OK); return path; } catch {}
  }
  throw Error(`测试所需真实工具不可用：${name}`);
}

function runMirror({jq = true, environment = 'github-hosted'} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ci-host-mirror-'));
  const config = join(directory, 'daemon.json');
  const calls = join(directory, 'sudo-calls');
  try {
    writeFileSync(config, JSON.stringify({debug: true, 'log-driver': 'json-file'}));
    // sudo仅映射本夹具文件；kill也只留回执，不会操作真实配置或进程。
    writeFileSync(join(directory, 'sudo'), `#!/bin/sh
printf '%s\\n' "$*" >> "$MIRROR_TEST_CALLS"
case "$1" in
  test) [ "$2" = -f ] && [ "$3" = /etc/docker/daemon.json ] || exit 88; test -f "$MIRROR_TEST_CONF" ;;
  cat) [ "$2" = /etc/docker/daemon.json ] || exit 88; "$MIRROR_REAL_CAT" "$MIRROR_TEST_CONF" ;;
  tee) [ "$2" = /etc/docker/daemon.json ] || exit 88; "$MIRROR_REAL_TEE" "$MIRROR_TEST_CONF" ;;
  kill) [ "$2" = -HUP ] && [ "$3" = 4242 ] || exit 88 ;;
  *) exit 88 ;;
esac
`, {mode: 0o755});
    writeFileSync(join(directory, 'docker'), '#!/bin/sh\nprintf \'%s\\n\' \'["https://mirror.gcr.io"]\'\n', {mode: 0o755});
    writeFileSync(join(directory, 'pidof'), '#!/bin/sh\nprintf \'%s\\n\' 4242\n', {mode: 0o755});
    writeFileSync(join(directory, 'sleep'), '#!/bin/sh\nexit 89\n', {mode: 0o755});
    for (const name of ['seq', 'grep', ...(jq ? ['jq'] : [])]) symlinkSync(executable(name), join(directory, name));
    const result = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', mirrorCommand], {
      encoding: 'utf8', timeout: 5000,
      env: {...process.env, PATH: directory, RUNNER_ENVIRONMENT: environment,
        MIRROR_TEST_CONF: config, MIRROR_TEST_CALLS: calls,
        MIRROR_REAL_CAT: executable('cat'), MIRROR_REAL_TEE: executable('tee')},
    });
    return {...result, config: JSON.parse(readFileSync(config, 'utf8') || 'null'),
      calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []};
  } finally { rmSync(directory, {recursive: true, force: true}); }
}

test('真实mirror脚本缺jq必须在首次sudo前拒绝，不截断配置', () => {
  const result = runMirror({jq: false});
  assert.equal(result.signal, null);
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, []);
  assert.deepEqual(result.config, {debug: true, 'log-driver': 'json-file'});
  assert.match(result.stdout + result.stderr, /缺少 jq/);
});

test('真实mirror脚本用原生jq保留已有配置、设置镜像并仅发送SIGHUP', () => {
  const result = runMirror();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.config, {debug: true, 'log-driver': 'json-file', 'registry-mirrors': ['https://mirror.gcr.io']});
  assert.deepEqual(result.calls.filter(call => call.startsWith('kill ')), ['kill -HUP 4242']);
  assert.ok(!result.calls.some(call => /restart|systemctl/.test(call)));
});

test('真实mirror脚本仍拒绝非托管runner且不调用sudo', () => {
  const result = runMirror({environment: 'self-hosted'});
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, []);
  assert.match(result.stdout + result.stderr, /只能用于 GitHub 托管/);
});
