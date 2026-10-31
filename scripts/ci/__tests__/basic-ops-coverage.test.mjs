import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {opsChecks} from '../ops-checks.mjs';
import {commandsFor} from '../run-basic-check.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const representative = [
  'scripts/dispatch-worker.test.mjs',
  'scripts/brain-image-retention.test.mjs',
  'scripts/brain-image-deploy.test.mjs',
  'scripts/brain-image-rollback.test.mjs',
  'scripts/bluegreen-sidecar-completion.test.mjs',
  'scripts/preview-cache.test.mjs',
  'scripts/preview-cache-http.test.mjs',
  'scripts/__tests__/dashboard-release-bind.test.mjs',
  'scripts/preview-agent/__tests__/deploy-token.test.mjs',
  'scripts/__tests__/bluegreen-env-file.test.sh',
  'scripts/__tests__/brain-deploy-build-same-version.test.sh',
  'scripts/__tests__/preview-env-start.test.sh',
  'scripts/__tests__/preview-reaper.test.sh',
  'scripts/__tests__/preview-start-request-retry.test.sh',
  'scripts/__tests__/preview-agent-install.test.sh',
  'scripts/__tests__/preview-host-release.test.sh',
  'scripts/__tests__/codex-remote-launch.test.sh',
  'scripts/__tests__/codex-request.test.sh',
  'scripts/ops/__tests__/credentials/op-item-to-env.test.sh',
  'scripts/ops/__tests__/janitor/janitor_dry_run.test.sh',
  'docker/cecelia-runner/__tests__/entrypoint-callback-retry.test.sh',
  'docker/cecelia-runner/__tests__/assertion-exec-package-root.test.cjs',
];
const safeSmokes = [
  'bluegreen-bark-nojq', 'brain-compose-envfile-authority', 'brain-deploy-service-isolation',
  'dashboard-sha-reconcile', 'deploy-chain-wounds', 'deploy-local-npm-cache', 'gate3-brain-deploy',
  'runner-credential-single-chain',
].map(name => `scripts/smoke/${name}-smoke.sh`);
const paths = steps => steps.map(step => step.args.at(-1));

test('实际 CI runner 接通完整 Ops 集合，而不是只有发现器测试通过', () => {
  assert.deepEqual(commandsFor('ops'), opsChecks(root));
});

test('旧实际行为测试的代表文件都拥有 Ops 命令入口', () => {
  const steps = opsChecks(root);
  const selected = paths(steps);
  for (const file of representative) assert.ok(selected.includes(file), `${file}缺少实际执行owner`);
  for (const step of steps) assert.equal(step.cwd, root.replace(/\/$/, ''));
  assert.equal(new Set(selected).size, selected.length, '不能重复执行同一测试');
  assert.ok(!selected.some(file => /dod|tdd|test-pyramid|ratchet-guard|cross-ref/.test(file)));
  for (const file of [...safeSmokes, 'scripts/smoke/dashboard-staging-gate-smoke.sh'])
    assert.ok(selected.includes(file), `${file}缺少安全fixture执行owner`);
  for (const name of ['kv-route', 'check-agents-rules-sync', 'check-docs-dir-registry', 'workflow-yaml-valid'])
    assert.ok(!selected.includes(`scripts/smoke/${name}-smoke.sh`));
});

const fixtureFiles = [
  'scripts/dispatch-worker.test.mjs',
  'scripts/brain-image-retention.test.mjs',
  'scripts/brain-image-deploy.test.mjs',
  'scripts/brain-image-rollback.test.mjs',
  'scripts/bluegreen-sidecar-completion.test.mjs',
  'scripts/preview-cache.test.mjs',
  'scripts/__tests__/dashboard-release-bind.test.mjs',
  'scripts/preview-agent/__tests__/fixture.test.mjs',
  'scripts/__tests__/bluegreen-fixture.test.sh',
  'scripts/__tests__/brain-deploy-fixture.test.sh',
  'scripts/__tests__/preview-fixture.test.sh',
  'scripts/__tests__/codex-request.test.sh',
  'scripts/__tests__/codex-remote-launch.test.sh',
  'scripts/ops/__tests__/nested/fixture.test.sh',
  'docker/cecelia-runner/__tests__/fixture.test.sh',
  'docker/cecelia-runner/__tests__/fixture.test.cjs',
  ...safeSmokes,
  'scripts/smoke/dashboard-staging-gate-smoke.sh',
];

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ops-discovery-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  for (const file of fixtureFiles) {
    mkdirSync(dirname(join(directory, file)), {recursive: true});
    const write = `appendFileSync(process.env.OPS_CAPTURE, ${JSON.stringify(file + '\n')});`;
    writeFileSync(join(directory, file), file.endsWith('.sh')
      ? `#!/usr/bin/env bash\nset -eu\nprintf '%s\\n' '${file}' >> "$OPS_CAPTURE"\n`
      : file.endsWith('.cjs')
        ? `const {appendFileSync} = require('node:fs'); ${write}\n`
        : `import {appendFileSync} from 'node:fs'; ${write}\n`);
  }
  mkdirSync(join(directory, 'scripts/ci'), {recursive: true});
  writeFileSync(join(directory, 'scripts/ci/run-isolated-staging-smoke.mjs'),
    `import {appendFileSync} from 'node:fs'; appendFileSync(process.env.OPS_CAPTURE, process.argv[2]+'\\n');\n`);
  return directory;
}

test('独立fixture实际执行 Node、Shell、CJS，结果确定排序且新增同类文件自动加入', t => {
  const directory = fixture(t);
  const before = opsChecks(directory);
  assert.deepEqual(paths(before), [...fixtureFiles].sort());
  const newFile = 'scripts/ops/__tests__/new-category/new-behavior.test.sh';
  mkdirSync(dirname(join(directory, newFile)), {recursive: true});
  writeFileSync(join(directory, newFile), `printf '%s\\n' '${newFile}' >> "$OPS_CAPTURE"\n`);
  const extraNode = 'scripts/brain-image-retention-new.test.mjs';
  writeFileSync(join(directory, extraNode), `import {appendFileSync} from 'node:fs'; appendFileSync(process.env.OPS_CAPTURE, ${JSON.stringify(extraNode + '\n')});\n`);
  const steps = opsChecks(directory);
  assert.deepEqual(paths(steps), [...fixtureFiles, newFile, extraNode].sort());
  assert.deepEqual(steps, opsChecks(directory));
  const capture = join(directory, 'executed');
  const env = {...process.env, OPS_CAPTURE: capture};
  // 模拟工作流普通进程；外层 node:test 的 IPC 上下文不能传给独立测试执行器。
  delete env.NODE_TEST_CONTEXT;
  for (const step of steps) {
    const result = spawnSync(step.command, step.args, {cwd: step.cwd, encoding: 'utf8', env, timeout: 5000});
    assert.equal(result.status, 0, `${step.args.join(' ')}\n${result.stderr}`);
  }
  assert.deepEqual(readFileSync(capture, 'utf8').trim().split('\n'), paths(steps));
});

test('关键目录不存在或任何关键测试类别为空都明确失败', t => {
  const directory = fixture(t);
  rmSync(join(directory, 'scripts/preview-agent/__tests__'), {recursive: true});
  assert.throws(() => opsChecks(directory), /目录|directory/i);
  mkdirSync(join(directory, 'scripts/preview-agent/__tests__'), {recursive: true});
  assert.throws(() => opsChecks(directory), /空|empty/i);
});

test('部署与Runner测试全部被删时不能用别的目录测试冒充该类别已覆盖', t => {
  const directory = fixture(t);
  rmSync(join(directory, 'scripts/__tests__/brain-deploy-fixture.test.sh'));
  assert.throws(() => opsChecks(directory), /空|empty/i);
});

test('staging安全wrapper只在全新副本执行，隔离原产物/PID/凭据并保留真实失败码', t => {
  const directory = mkdtempSync(join(tmpdir(), 'staging-source-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const helpers = ['deploy-local.sh', 'promote-dashboard.sh', 'dashboard-staging-selfcheck.sh', 'dashboard-slot-server.cjs', 'dev-preview.sh'];
  for (const name of helpers) {
    mkdirSync(join(directory, 'scripts'), {recursive: true});
    writeFileSync(join(directory, 'scripts', name), 'fixture-only');
  }
  mkdirSync(join(directory, 'apps/dashboard/dist'), {recursive: true});
  writeFileSync(join(directory, 'apps/dashboard/dist/original'), 'must survive');
  writeFileSync(join(directory, 'apps/dashboard/.staging-slot.pid'), String(process.pid));
  mkdirSync(join(directory, 'scripts/smoke'), {recursive: true});
  const script = join(directory, 'scripts/smoke/dashboard-staging-gate-smoke.sh');
  writeFileSync(script, `#!/usr/bin/env bash
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
test ! -f "$ROOT/apps/dashboard/dist/original"
test ! -f "$ROOT/apps/dashboard/.staging-slot.pid"
test -z "\${BARK_TOKEN:-}"
test "$HOME" = "$ROOT/home"
test "$SMOKE_STAGING_PORT" -gt 1024
mkdir -p "$ROOT/apps/dashboard/dist"
printf 'only the copied root' > "$ROOT/apps/dashboard/dist/fixture"
printf 'ISOLATED_FIXTURE_OK\\n'
`);
  const wrapper = join(root, 'scripts/ci/run-isolated-staging-smoke.mjs');
  const result = spawnSync(process.execPath, [wrapper, 'scripts/smoke/dashboard-staging-gate-smoke.sh'], {
    cwd: directory, encoding: 'utf8', env: {...process.env, BARK_TOKEN: 'must-not-inherit'}, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ISOLATED_FIXTURE_OK/);
  assert.equal(readFileSync(join(directory, 'apps/dashboard/dist/original'), 'utf8'), 'must survive');
  assert.equal(readFileSync(join(directory, 'apps/dashboard/.staging-slot.pid'), 'utf8'), String(process.pid));
  assert.doesNotThrow(() => process.kill(process.pid, 0));
  writeFileSync(script, '#!/usr/bin/env bash\nexit 23\n');
  const failed = spawnSync(process.execPath, [wrapper, 'scripts/smoke/dashboard-staging-gate-smoke.sh'], {
    cwd: directory, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(failed.status, 23, failed.stderr);
});
