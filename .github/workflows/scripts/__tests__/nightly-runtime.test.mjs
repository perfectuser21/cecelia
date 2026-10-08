import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createVitest } from 'vitest/node';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const workflow = yaml.load(readFileSync(join(root, '.github/workflows/nightly-regression.yml'), 'utf8'));
const stepFor = (job, name) => workflow.jobs[job].steps.find(step => step.name?.startsWith(name));

for (const [job, name] of [
  ['brain-integration-nightly', 'Integration Tests'],
  ['e2e-smoke-nightly', 'E2E 贯通冒烟'],
]) {
  test(`${job}：工作流真实Vitest配置能选到集成文件，PG测试已启用`, async () => {
    const step = stepFor(job, name);
    const config = step.run.match(/--config\s+(\S+)/)?.[1];
    const filters = step.run.match(/src\/[^\s\\]+/g);
    assert.ok(filters?.length, '不能丢失正式集成测试过滤器');
    const ctx = await createVitest('test', {
      root: join(root, 'packages/brain'), watch: false,
      ...(config ? { config: join(root, 'packages/brain', config) } : {}),
    });
    try {
      const selected = await ctx.globTestFiles(filters);
      assert.ok(selected.length > 0, '真实Vitest选择为零，nightly无法执行任何集成测试');
      if (job === 'e2e-smoke-nightly') assert.equal(selected.length, 3, '必须保留原三条E2E路径');
    } finally { await ctx.close(); }
    assert.equal(step.env.POSTGRES_INTEGRATION, '1', '选中后仍需启用真实PG测试');
  });
}

test('nightly批量smoke：实际shell获得完整隔离连接环境，任一脚本失败仍让job失败', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'nightly-runner-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const scripts = join(cwd, 'packages/brain/scripts/smoke');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, 'environment.sh'), `#!/bin/bash
set -eu
[[ "$BRAIN_CONTAINER" == cecelia-brain-nightly && "$SMOKE_ALLOW_WRITE" == 1 ]]
[[ "$DB_NAME" == cecelia_test && "$PGDATABASE" == "$DB_NAME" ]]
[[ "$PGHOST" == "$DB_HOST" && "$PGPORT" == "$DB_PORT" ]]
[[ "$PGUSER" == "$DB_USER" && "$PGPASSWORD" == "$DB_PASSWORD" ]]
`);
  const step = stepFor('real-env-smoke-nightly', 'Run smoke scripts');
  // 只展开工作流里的CI密钥引用；不用宿主数据库配置兜底漏传变量。
  const env = { PATH: process.env.PATH, ...Object.fromEntries(Object.entries(step.env)
    .map(([key, value]) => [key, String(value).replaceAll('${{ secrets.CI_DB_PASSWORD }}', 'isolated-test-password')])) };
  const run = () => spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
    cwd, env, encoding: 'utf8', timeout: 5000,
  });
  const success = run();
  assert.equal(success.status, 0, success.stdout + success.stderr);
  assert.match(success.stdout, /通过: 1, 失败: 0/);
  // 普通实例不能冒充专用Walking实例；该入口必须移交到被汇总的真实独立job。
  writeFileSync(join(scripts, 'walking-skeleton-1node-smoke.sh'), '#!/bin/sh\nexit 43\n');
  const delegated = run();
  assert.equal(delegated.status, 0, delegated.stdout + delegated.stderr);
  assert.match(delegated.stdout, /DELEGATED.*walking-ci-e2e-nightly/);
  writeFileSync(join(scripts, 'failure.sh'), '#!/bin/sh\nexit 42\n');
  const failure = run();
  assert.equal(failure.status, 1, '不能吞掉任何smoke失败');
  assert.match(failure.stdout, /通过: 1, 失败: 1/);
});

test('Walking专用nightly：沿用正式实际Docker/PG验收，启动隔离实例且加入失败汇总', t => {
  const job = workflow.jobs['walking-ci-e2e-nightly'];
  assert.ok(job, '必须有实际执行Walking的独立job，不能只从RunAll移除');
  const official = yaml.load(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')).jobs['walking-ci-e2e'];
  const expected = JSON.parse(JSON.stringify(official).replaceAll('cecelia-brain-walking-ci', 'cecelia-brain-walking-nightly'));
  assert.deepEqual(job, expected, '保留正式CI的真实两线程、PG检查、重启、产出工件及清场');
  assert.ok(workflow.jobs['open-issue-on-failure'].needs.includes('walking-ci-e2e-nightly'));
  const cwd = mkdtempSync(join(tmpdir(), 'nightly-walking-start-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const bin = join(cwd, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), `#!${process.execPath}\nconst fs=require('fs');fs.appendFileSync(process.env.DOCKER_LOG,JSON.stringify({args:process.argv.slice(2),database:process.env.DB_NAME})+'\\n');\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { PATH: `${bin}:${process.env.PATH}`, GITHUB_WORKSPACE: cwd, DOCKER_LOG: join(cwd, 'docker.log'),
    ...Object.fromEntries(Object.entries(job.env).map(([key, value]) => [key, String(value).replaceAll('${{ secrets.CI_DB_PASSWORD }}', 'isolated-test-password')])) };
  const startup = job.steps.find(step => step.name === 'Prepare isolated Brain and actual Alpine worker');
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', startup.run], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(env.DOCKER_LOG, 'utf8').trim().split('\n').map(JSON.parse);
  const run = calls.find(call => call.args[0] === 'run');
  assert.equal(run.database, 'cecelia_test');
  assert.ok(run.args.includes('cecelia-brain-walking-nightly'));
  for (const flag of ['CI=true', 'WALKING_CI_OWNER=1', 'NODE_ENV=test', 'CECELIA_TICK_ENABLED=false', 'DATABASE_URL']) {
    assert.ok(run.args.includes(flag), `缺专用隔离启动参数 ${flag}`);
  }
  const smoke = job.steps.find(step => step.name === 'True two-thread Docker callback checkpoint restart acceptance');
  assert.equal(smoke.env.SMOKE_ALLOW_WRITE, '1');
  assert.equal(smoke.env.BRAIN_CONTAINER, 'cecelia-brain-walking-nightly');
});

const goodHealthz = status => ({ status, db: 'connected', tick: 'disabled', checked_at: new Date().toISOString() });
for (const [name, code, body, accepted] of [
  ['正常200', 200, goodHealthz('ok'), true],
  ['真实critical503', 503, goodHealthz('critical'), true],
  ['缺少公开schema字段', 503, { status: 'critical' }, false],
  ['未知状态', 200, goodHealthz('unknown'), false],
  ['错误HTTP状态', 404, goodHealthz('critical'), false],
]) {
  test(`F5真HTTP读回：${name}`, async t => {
    const server = createServer((req, res) => {
      const health = req.url === '/api/brain/health';
      res.writeHead(health ? 200 : code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health ? { organs: { scheduler: {}, circuit_breaker: {} } } : body));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const child = spawn('bash', [join(root, 'packages/brain/scripts/smoke/factory-f5-cockpit-smoke.sh')], {
      env: { PATH: process.env.PATH, BRAIN_URL: `http://127.0.0.1:${server.address().port}` },
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const resultCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(resultCode, accepted ? 0 : 1, output);
    if (accepted && body.status === 'critical') assert.match(output, /status=critical/, '必须保留真实critical证据');
  });
}
