import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {parse} from 'yaml';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const workflow = parse(readFileSync(join(source, '.github/workflows/ci.yml'), 'utf8'));
const deployJob = workflow.jobs['brain-deploy'];
const runs = deployJob.steps.filter(step => step.run && /gate3-trigger-deploy|gate3-wait-deploy|run-brain-deploy/.test(step.run));

function runShell(script, cwd, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bash', ['-e', '-c', script], {cwd, env, detached: true});
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      reject(new Error('isolated workflow shell timed out: ' + output));
    }, 15000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolvePromise({code, output}); });
  });
}

async function scenario(t, {brainChanged = false, force = false, invalidReceipt = false, rejectPost = false, failWait = false} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'brain-deploy-routing-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  mkdirSync(join(dir, 'home'));
  const env = {PATH: process.env.PATH, HOME: join(dir, 'home'), LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    DEPLOY_TOKEN: 'synthetic-fixture-only', REQUIRE_EXACT_SHA: '1',
    POLL_INTERVAL_S: '0', MAX_POLLS: '2', MAX_RETRIGGER: '0',
    GITHUB_OUTPUT: join(dir, 'outputs'), GITHUB_STEP_SUMMARY: join(dir, 'summary'),
    RUNNER_TEMP: join(dir, 'runner'), FORCE_BRAIN_DEPLOY: force ? '1' : '0'};
  const git = (...args) => execFileSync('git', args, {cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '-b', 'cp-fixture');
  git('config', 'core.hooksPath', '/dev/null');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'isolated fixture');
  function put(path, content) { mkdirSync(dirname(join(dir, path)), {recursive: true}); writeFileSync(join(dir, path), content); }
  for (const name of ['gate3-trigger-deploy.sh', 'gate3-wait-deploy.sh', 'run-brain-deploy.sh', 'brain-deploy-preflight.mjs']) {
    const path = 'scripts/ci/' + name;
    if (existsSync(join(source, path))) { mkdirSync(dirname(join(dir, path)), {recursive: true}); copyFileSync(join(source, path), join(dir, path)); }
  }
  put('packages/brain/server.js', 'export const current = 1;\n');
  put('scripts/ops/us-vps/opc-watchdog.sh', '#!/bin/bash\ntrue\n');
  git('add', '.'); git('commit', '-qm', 'fixture baseline');
  const baseline = git('rev-parse', 'HEAD');
  put(brainChanged ? 'packages/brain/server.js' : 'scripts/ops/us-vps/opc-watchdog.sh', brainChanged ? 'export const current = 2;\n' : '#!/bin/bash\n: new-monitor\n');
  git('add', '.'); git('commit', '-qm', 'fixture target');
  const target = git('rev-parse', 'HEAD');
  let actual = baseline;
  const requests = [];
  const receipt = () => ({deployment_id: '11111111-1111-4111-8111-111111111111', outcome: 'success',
    image_id: 'sha256:' + 'a'.repeat(64), container_id: 'b'.repeat(64), version: '1.445.296', git_sha: actual,
    confirmed_at: new Date().toISOString(), actor: 'brain-deploy:fixture',
    business_readback: {protocol: 'brain-release-readback/v1', status: 'passed', scope: 'read_only',
      container_id: 'b'.repeat(64), task_count: 1, task_sample_sha256: 'c'.repeat(64), external_services: 'not_evaluated'}});
  // A stable receipt belongs to the live runtime; GET must never create a new receipt.
  const confirmedAt = new Date().toISOString();
  const server = createServer(async (req, res) => {
    requests.push({method: req.method, path: req.url});
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/api/brain/deploy') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      assert.equal(req.headers.authorization, 'Bearer synthetic-fixture-only');
      assert.equal(JSON.parse(raw).sha, target);
      if (rejectPost) { res.writeHead(403); res.end('{}'); return; }
      actual = target; res.writeHead(202); res.end('{}'); return;
    }
    if (req.method === 'GET' && req.url === '/api/brain/health') {
      res.end(JSON.stringify({status: 'healthy', version: '1.445.296', git_sha: actual,
        runtime: {isolated: false, background_automation: true}})); return;
    }
    if (req.method === 'GET' && req.url === '/api/brain/deploy/status') {
      const settlement = {...receipt(), confirmed_at: confirmedAt};
      res.end(JSON.stringify({status: failWait && actual === target ? 'failed' : 'success', git_sha: actual,
        settled: !(invalidReceipt && actual === baseline), settlement})); return;
    }
    res.writeHead(404); res.end('{}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  env.BRAIN_URL = 'http://127.0.0.1:' + server.address().port;
  env.GITHUB_SHA = target;
  let result = {code: 0, output: ''};
  assert.ok(runs.length > 0, 'workflow must execute its actual release path');
  for (const step of runs) {
    result = await runShell(step.run, dir, env);
    if (result.code !== 0) break;
  }
  return {result, requests, baseline, target, actual, dir};
}

test('actual main CI shell avoids POST for a certified independent watchdog change', async t => {
  const s = await scenario(t);
  assert.equal(s.result.code, 0, s.result.output);
  assert.equal(s.requests.filter(r => r.method === 'POST').length, 0, 'independent host watchdog changes must not trigger a Brain release');
  assert.equal(s.actual, s.baseline, 'do not relabel the actual production SHA');
  const report = JSON.parse(readFileSync(join(s.dir, 'runner/brain-deploy-preflight/report.json'), 'utf8'));
  assert.equal(report.deploy_required, false);
  assert.equal(report.actual_runtime_sha, s.baseline);
  assert.equal(report.target_sha, s.target);
  assert.equal(report.host_ops_installation, 'not_evaluated');
});

for (const [name, options] of [
  ['runtime code changes', {brainChanged: true}],
  ['an unconfirmed native receipt', {invalidReceipt: true}],
  ['explicit force', {force: true}],
]) {
  test('actual main CI shell retains exact target deployment for ' + name, async t => {
    const s = await scenario(t, options);
    assert.equal(s.result.code, 0, s.result.output);
    assert.equal(s.requests.filter(r => r.method === 'POST').length, 1);
    assert.equal(s.actual, s.target);
  });
}

for (const [name, options] of [['POST denial', {rejectPost: true}], ['failed native settlement', {failWait: true}]]) {
  test('actual main CI shell fails on ' + name, async t => {
    const s = await scenario(t, {...options, brainChanged: true});
    assert.notEqual(s.result.code, 0, s.result.output);
  });
}

test('one existing main release job keeps fixed SHA checkout and exact-SHA gate', () => {
  assert.equal(Object.keys(workflow.jobs).length, 8);
  assert.match(deployJob.if, /github\.event_name == 'push'/);
  assert.match(deployJob.if, /refs\/heads\/main/);
  assert.match(deployJob.if, /ci-passed/);
  assert.equal(deployJob.env.REQUIRE_EXACT_SHA, '1');
  assert.ok(deployJob.steps.some(step => step.with?.ref === '${{ github.sha }}'));
});
