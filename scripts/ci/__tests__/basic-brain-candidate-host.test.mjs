import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../..');
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

function cleanupFixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'brain-candidate-host-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'bin'));
  const log = join(dir, 'docker.jsonl');
  writeFileSync(join(dir, 'bin/docker'), `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_LOG, JSON.stringify(args) + '\\n');
const command = args[0] === '--context' ? args.slice(2) : args;
if (command[0] === 'context') { console.log('ssh://administrator@mac-studio'); process.exit(0); }
if (process.env.DISCONNECTED === '1') { console.error('Cannot connect to the Docker daemon'); process.exit(1); }
if (command[0] === 'inspect' && command.includes('--format')) console.log('admission-v1');
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
    DOCKER_LOG: log, BRAIN_CANDIDATE_DOCKER_CONTEXT: 'mac-studio', ...overrides };
  const run = body => spawnSync('bash', ['-c', `set -euo pipefail; source ${shellQuote(join(root, 'scripts/lib/brain-staging.sh'))}; ${body}`], { env, encoding: 'utf8' });
  return { run, commands: () => readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) };
}

test('候选清理只访问所配 Mac Docker，生产默认 daemon 不得收到候选 stop/rm', t => {
  const f = cleanupFixture(t);
  const result = f.run('stage_remove_container cecelia-admission-brain');
  assert.equal(result.status, 0, result.stderr);
  const stops = f.commands().filter(args => args.includes('stop'));
  assert.deepEqual(stops, [['--context', 'mac-studio', 'stop', 'cecelia-admission-brain']]);
  assert.equal(f.commands().some(args => args[0] === 'rm'), false);
});

test('候选 Docker 断链必须清理失败，不能当作容器不存在', t => {
  const f = cleanupFixture(t, { DISCONNECTED: '1' });
  assert.notEqual(f.run('stage_remove_container cecelia-admission-brain').status, 0);
});
