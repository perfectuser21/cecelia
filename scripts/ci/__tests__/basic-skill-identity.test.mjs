import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {commandsFor} from '../run-basic-check.mjs';
const require = createRequire(import.meta.url), {parse} = require('yaml');
const root = resolve('.');
const helper = join(root, 'scripts/ci/check-skill-source-identity.py');
const composite = parse(readFileSync(join(root, '.github/actions/skills-source/action.yml'), 'utf8'));
const directory = mkdtempSync(join(tmpdir(), 'skill-identity-test-'));
const keyfile = join(directory, 'synthetic-key');
const generated = spawnSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', keyfile, '-q'], {encoding:'utf8'});
assert.equal(generated.status, 0);
const privateKey = readFileSync(keyfile, 'utf8');
const publicKey = readFileSync(keyfile + '.pub', 'utf8');
const expected = createHash('sha256').update(publicKey.trim().split(/\s+/).slice(0, 2).join(' ')).digest('hex');
process.once('exit', () => rmSync(directory, {recursive:true, force:true}));
function env(key = privateKey, hash = expected) {
  const result = {...process.env, SKILLS_SOURCE_SSH_KEY:key, SKILLS_SOURCE_PUBLIC_KEY_SHA256:hash};
  return result;
}
function check(key, hash) {
  const result = spawnSync('python3', [helper], {env:env(key, hash), encoding:'utf8', timeout:15000});
  assert.ifError(result.error);
  assert.equal(result.stderr, '', '异常原文不能进入日志');
  for (const forbidden of [privateKey, privateKey.split('\n')[1], publicKey.trim(), expected]) {
    assert.ok(!result.stdout.includes(forbidden), '输出不得包含密钥或摘要值');
  }
  assert.match(result.stdout, /^\{"parse_ok": (?:true|false), "matches_registered": (?:true|false)\}\n$/);
  return {...result, body:JSON.parse(result.stdout)};
}
test('Basic scripts实际集合自动选择身份回归', () => {
  assert.ok(commandsFor('scripts').some(step => step.args.includes('scripts/ci/__tests__/basic-skill-identity.test.mjs')));
});
test('真实ssh-keygen派生的synthetic身份匹配且仅输出布尔', () => {
  const r = check(privateKey, expected); assert.equal(r.status, 0);
  assert.deepEqual(r.body, {parse_ok:true, matches_registered:true});
});
test('CRLF及尾部换行按真实bootstrap规则归一化', () => {
  assert.equal(check(privateKey.replaceAll('\n', '\r\n') + '\r\n', expected).status, 0);
});
for (const [name, key, hash, parsed] of [
  ['错配', privateKey, '0'.repeat(64), true],
  ['缺expected', privateKey, '', true],
  ['畸形expected', privateKey, 'not-a-digest', true],
  ['缺key', '', expected, false],
  ['畸形key', 'synthetic-invalid-secret-marker\nnot-a-key', expected, false],
]) test(`${name}非零且无秘密/异常泄露`, () => {
  const r=check(key, hash); assert.notEqual(r.status, 0);
  assert.deepEqual(r.body, {parse_ok:parsed, matches_registered:false});
  assert.ok(!r.stdout.includes('synthetic-invalid-secret-marker'));
});
test('所有composite调用者显式传入公开var身份摘要', () => {
  let count=0;
  for (const file of readdirSync(join(root, '.github/workflows')).filter(p => /\.ya?ml$/.test(p))) {
    const workflow=parse(readFileSync(join(root, '.github/workflows', file), 'utf8'));
    for (const job of Object.values(workflow.jobs || {})) for (const step of job.steps || []) {
      if (step.uses !== './.github/actions/skills-source') continue;
      count++;
      assert.equal(step.with?.['expected-public-sha256'], '${{ vars.SKILLS_SOURCE_PUBLIC_KEY_SHA256 }}', file);
    }
  }
  assert.equal(count, 6);
  assert.equal(composite.inputs['expected-public-sha256']?.required, true);
});
test('真实composite在fetch前校验身份：错配零fetch，匹配才到原入口', () => {
  const workspace=join(directory, 'workspace');mkdirSync(join(workspace, 'scripts/ci'), {recursive:true});
  if (existsSync(helper)) copyFileSync(helper, join(workspace, 'scripts/ci/check-skill-source-identity.py'));
  const marker=join(workspace, 'fetch-reached');
  writeFileSync(join(workspace, 'scripts/ensure-skills-source.sh'), '#!/bin/bash\nprintf reached > "$GITHUB_WORKSPACE/fetch-reached"\n');
  spawnSync('git', ['init', '-q', workspace]);
  const body=composite.runs.steps[0].run;
  const run = hash => spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', body], {cwd:workspace, env:{...env(privateKey, hash), GITHUB_WORKSPACE:workspace}, encoding:'utf8'});
  const bad=run('0'.repeat(64));assert.notEqual(bad.status, 0);assert.equal(existsSync(marker), false);
  const good=run(expected);assert.equal(good.status, 0, good.stderr);assert.equal(readFileSync(marker,'utf8'), 'reached');
  assert.equal(composite.runs.steps[0].env.SKILLS_SOURCE_PUBLIC_KEY_SHA256, '${{ inputs.expected-public-sha256 }}');
});
