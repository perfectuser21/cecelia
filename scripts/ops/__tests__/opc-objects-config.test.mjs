import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = process.env.OPC_OBJECTS_TEST_SCRIPT || fileURLToPath(new URL('../opc-objects.mjs', import.meta.url));
const current = join(homedir(), '.openclaw/openclaw.json');
const account = { channels: { feishu: { accounts: { main: { appId: 'fixture-app', appSecret: 'SECRET_MUST_NOT_LEAK' } } } } };
function run(configs, override, apiFailure = false) {
  const dir = mkdtempSync(join(tmpdir(), 'opc-config-test-'));
  const preload = join(dir, 'fake-io.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
const configs = ${JSON.stringify(configs)};
const read = fs.readFileSync;
fs.existsSync = p => Object.hasOwn(configs, String(p));
fs.readFileSync = (p, ...args) => {
  if (!Object.hasOwn(configs, String(p))) {
    if (String(p).endsWith('.json')) throw Object.assign(new Error('missing fixture config'), {code:'ENOENT'});
    return read(p, ...args);
  }
  const value = configs[String(p)];
  if (value?.error) throw Object.assign(new Error('fixture secret SECRET_MUST_NOT_LEAK'), {code: value.error});
  return typeof value === 'string' ? value : JSON.stringify(value);
};
globalThis.fetch = async (url, options) => {
  if (${apiFailure}) throw new Error('network unavailable');
  if (String(url).includes('/auth/')) {
    const body = JSON.parse(options.body);
    if (body.app_id !== 'fixture-app' || body.app_secret !== 'SECRET_MUST_NOT_LEAK') throw new Error('wrong account selected');
    return {ok:true, json:async()=>({code:0,tenant_access_token:'fixture-token'})};
  }
  return {ok:true, json:async()=>({code:0,data:{has_more:false,items:[{record_id:'fixture-record',fields:{标题:'fixture',状态:'进行中'}}]}})};
};`);
  const env = { ...process.env };
  delete env.OPENCLAW_CONFIG_PATH;
  if (override !== undefined) env.OPENCLAW_CONFIG_PATH = override;
  try {
    const r = spawnSync(process.execPath, ['--import', preload, script, 'list', '--inspection-summary'], { env, encoding: 'utf8' });
    assert.doesNotMatch(r.stdout + r.stderr, /SECRET_MUST_NOT_LEAK/);
    return { status: r.status, body: JSON.parse(r.stdout) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('Mac current config restores a complete readonly inspection', () => {
  const r = run({ [current]: account });
  assert.equal(r.status, 0);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.mode, 'inspection-summary');
  assert.equal(r.body.source_count, 1);
  assert.equal(r.body.truncated, false);
});
test('explicit config selects only that account before current and legacy', () => {
  const r = run({ '/config/chosen.json': account, [current]: {}, '/root/.openclaw/clawdbot.json': {} }, '/config/chosen.json');
  assert.equal(r.status, 0);
  assert.equal(r.body.ok, true);
});
test('missing explicit config cannot silently use current account', () => {
  const r = run({ [current]: account }, '/config/missing.json');
  assert.notEqual(r.status, 0);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /指定.*配置.*不存在/);
});
test('bad explicit JSON fails without exposing JSON or trying another account', () => {
  const r = run({ '/config/bad.json': '{SECRET_MUST_NOT_LEAK', [current]: account }, '/config/bad.json');
  assert.notEqual(r.status, 0);
  assert.match(r.body.error, /配置.*JSON/);
});
test('unreadable chosen config fails safely', () => {
  const r = run({ '/config/denied.json': {error:'EACCES'}, [current]: account }, '/config/denied.json');
  assert.notEqual(r.status, 0);
  assert.match(r.body.error, /EACCES/);
});
test('missing main credentials are reported before making an API request', () => {
  const r = run({ [current]: {channels:{feishu:{accounts:{main:{appId:'fixture-app'}}}}} });
  assert.notEqual(r.status, 0);
  assert.match(r.body.error, /appId.*appSecret/);
});
test('legacy Linux config remains supported', () => {
  const r = run({ '/opt/openclaw/state/clawdbot.json': account });
  assert.equal(r.status, 0);
  assert.equal(r.body.source_count, 1);
});
test('failed API call never reports a successful inspection', () => {
  const r = run({ [current]: account }, undefined, true);
  assert.notEqual(r.status, 0);
  assert.equal(r.body.ok, false);
});
