import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { runInNewContext } from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const worker = 'packages/brain/scripts/fleet-worker/';
const suites = [
  ['app-server-canary.yml', ['app-server-canary.cjs', 'app-server-rpc-canary.cjs', '../../src/app-server/client.js'], [
    '.github/actions/dockerhub-mirror/action.yml', 'packages/brain/config/fleet-node-profiles.json']],
  ['linux-resource-canary.yml', ['linux-resource-canary.cjs', 'linux-resource-probe.cjs', 'linux-cgroup.cjs'], [
    worker + 'node-probe.cjs', worker + 'fleet-worker.cjs', worker + 'local-resource-admission.cjs',
    'packages/brain/config/fleet-node-profiles.json']],
  ['attempt-runtime-limits.yml', ['attempt-limits-canary.cjs'], [
    worker + 'local-resource-admission.cjs', 'packages/brain/config/fleet-node-profiles.json']],
];
const workflow = name => yaml.load(readFileSync(join(root, '.github/workflows', name), 'utf8'));
function dependencies(entries) {
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    if (!/\.(cjs|mjs|js)$/.test(file)) return;
    const source = readFileSync(join(root, file), 'utf8');
    for (const match of source.matchAll(/(?:require\(\s*|from\s*)['"](\.[^'"]+)['"]/g)) {
      const target = join(dirname(file), match[1]);
      // 部署时动态拼接的外部插件不属于仓库依赖闭包。
      if (existsSync(join(root, target))) visit(target);
    }
  }
  entries.forEach(file => visit(join(worker, file)));
  return visited;
}
function matches(pattern, file) {
  const re = pattern.split('**').map(part => part.split('*').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp('^' + re + '$').test(file);
}
for (const [name, entries, extra] of suites) {
  test(`${name}: 本地传递依赖、配置、调用方和守卫自身变更都触发专项`, () => {
    const paths = workflow(name).on.pull_request.paths;
    const files = [...dependencies(entries), ...extra, 'scripts/ci/__tests__/basic-resource-canary.test.mjs'];
    const missing = files.filter(file => !paths.some(pattern => matches(pattern, file)));
    assert.deepEqual(missing, [], '未覆盖的真实依赖/调用方路径');
  });
  const job = Object.values(workflow(name).jobs)[0];
  for (const step of job.steps.filter(s => s.run?.includes('| tee '))) {
    for (const exitCode of [0, 19]) test(`${name}: ${step.name} 真shell保留子进程退出${exitCode}`, () => {
      const temp = mkdtempSync(join(tmpdir(), 'resource-canary-shell-'));
      try {
        const node = join(temp, 'node');
        writeFileSync(node, `#!/bin/sh\nprintf '%s\\n' "$*" > "$MARKER"\nprintf 'canary-output\\n'\nexit ${exitCode}\n`);
        chmodSync(node, 0o755);
        const result = spawnSync('bash', ['-e', '-c', step.run], { cwd: temp, encoding: 'utf8',
          env: { PATH: `${temp}:${process.env.PATH}`, MARKER: join(temp, 'invoked') }, timeout: 10000 });
        assert.equal(result.status, exitCode, result.stdout + result.stderr);
        assert.match(readFileSync(join(temp, 'invoked'), 'utf8'), /packages\/brain\/scripts\/fleet-worker\/.+-canary\.cjs/);
        const log = step.run.match(/tee\s+([^\s]+)/)[1];
        assert.equal(readFileSync(join(temp, log), 'utf8'), 'canary-output\n');
      } finally { rmSync(temp, { recursive: true, force: true }); }
    });
  }
}

// 执行真实 canary 发给容器的采样程序；变异数据必须触发同一组断言。
const linuxSource = readFileSync(join(root, worker, 'linux-resource-canary.cjs'), 'utf8');
const linuxProgram = linuxSource.match(/const program = `([\s\S]*?)`;/)[1];
const observed = { status: 'observed', cpu_cores: 0.5, memory_limit_bytes: 134217728,
  memory_available_bytes: 67108864, execution: false, pool_verified: false, ancestry_visible: false };
for (const [field, value] of [[null, null], ['status', 'unknown'], ['cpu_cores', 1],
  ['memory_limit_bytes', 268435456], ['memory_available_bytes', -1],
  ['memory_available_bytes', 134217729], ['execution', true], ['pool_verified', true], ['ancestry_visible', true]]) {
  test(`Linux真实采样断言拒绝变异 ${field ?? '正常基线'}=${value}`, async () => {
    const report = { ...observed, ...(field ? { [field]: value } : {}) }, childProcess = { exitCode: 0 };
    await runInNewContext(linuxProgram, { process: childProcess, console: { log() {}, error() {} },
      require: name => name === 'node:assert/strict' ? assert : { sampleLinuxResources: async () => report } });
    assert.equal(childProcess.exitCode, field ? 1 : 0);
  });
}
