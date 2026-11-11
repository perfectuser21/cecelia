import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
const action = yaml.load(readFileSync(new URL('../../../.github/actions/dockerhub-mirror/action.yml', import.meta.url), 'utf8'));
function fixture(config, gateways, environment = 'github-hosted') {
  const dir = mkdtempSync(join(tmpdir(), 'docker-mirror-'));
  const conf = join(dir, 'daemon.json'), signal = join(dir, 'signal');
  writeFileSync(conf, JSON.stringify(config));
  const bin = (name, source) => writeFileSync(join(dir, name), '#!/usr/bin/env node\n' + source, {mode: 0o755});
  bin('sudo', `const fs=require('node:fs');const a=process.argv.slice(2);const p=process.env.FIXTURE_CONF;
if(a[0]==='test')process.exit(fs.existsSync(p)?0:1);
else if(a[0]==='cat')process.stdout.write(fs.readFileSync(p));
else if(a[0]==='tee'){const s=fs.readFileSync(0);fs.writeFileSync(p,s);process.stdout.write(s);}
else if(a[0]==='kill')fs.writeFileSync(process.env.FIXTURE_SIGNAL,a.join(' '));
else process.exit(77);`);
  bin('docker', `const fs=require('node:fs');const a=process.argv.slice(2);
if(a[0]==='network' && a[1]==='inspect')process.stdout.write(process.env.FIXTURE_GATEWAYS);
else if(a[0]==='info')process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(process.env.FIXTURE_CONF))['registry-mirrors']||[]));
else process.exit(78);`);
  bin('pidof', 'process.stdout.write("424242");');
  try {
    const result = spawnSync('bash', ['-c', action.runs.steps[0].run], {encoding: 'utf8', timeout: 10000,
      env: {...process.env, PATH: `${dir}:${process.env.PATH}`, RUNNER_ENVIRONMENT: environment,
        FIXTURE_CONF: conf, FIXTURE_SIGNAL: signal, FIXTURE_GATEWAYS: JSON.stringify(gateways)}});
    let hup = ''; try { hup = readFileSync(signal, 'utf8'); } catch {}
    return {...result, config: JSON.parse(readFileSync(conf)), hup};
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
test('mirror reload preserves observed bridge gateways so host-gateway remains usable', () => {
  const result = fixture({'log-driver': 'json-file'}, [{Gateway: '172.19.0.1'}, {Gateway: 'fd00::1'}]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.config['host-gateway-ips'], ['172.19.0.1', 'fd00::1']);
  assert.deepEqual(result.config['registry-mirrors'], ['https://mirror.gcr.io']);
  assert.equal(result.config['log-driver'], 'json-file');
  assert.equal(result.hup, 'kill -HUP 424242');
});
for (const preset of [{'host-gateway-ip': '192.0.2.1'}, {'host-gateway-ips': ['192.0.2.1', 'fd01::1']}]) {
  test(`explicit gateway configuration survives reload: ${Object.keys(preset)[0]}`, () => {
    const result = fixture(preset, [{Gateway: '172.19.0.1'}]);
    assert.equal(result.status, 0, result.stderr);
    for (const [key, value] of Object.entries(preset)) assert.deepEqual(result.config[key], value);
    assert.equal(Object.keys(result.config).filter(key => key.startsWith('host-gateway')).length, 1);
  });
}
test('unknown gateway fails before mutating daemon or signalling reload', () => {
  const result = fixture({}, []);
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.config, {});
  assert.equal(result.hup, '');
});
test('self-hosted machines are rejected before any daemon mutation', () => {
  const result = fixture({}, [{Gateway: '172.19.0.1'}], 'self-hosted');
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.config, {});
  assert.equal(result.hup, '');
});
