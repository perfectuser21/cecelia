import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const script = fileURLToPath(new URL('../../agents/wechat_rpa.py', import.meta.url));
const actions = ['send_message', 'click', 'screenshot', 'read_inbox'];

function run(t, action, dryrun = false) {
  const directory = mkdtempSync(join(tmpdir(), 'wechat-script-contract-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const result = spawnSync('python3', ['-I', script], {
    cwd: directory, encoding: 'utf8', timeout: 10000,
    input: JSON.stringify({action_type: action, target: 'isolated-fixture', content: 'fixture'}),
    env: {PATH: process.env.PATH, HOME: directory, TMPDIR: directory, WECHAT_RPA_DRYRUN: dryrun ? '1' : '0'},
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  return {status: result.status, payload: JSON.parse(result.stdout)};
}

for (const action of actions) {
  test(`真实微信脚本 ${action} 拒绝伪造业务成功`, t => {
    const result = run(t, action);
    assert.equal(result.status, 1);
    assert.deepEqual(result.payload, {ok: false, error: 'unsupported_action', action_type: action});
  });
  test(`显式演练 ${action} 只产生未执行回执`, t => {
    const result = run(t, action, true);
    assert.equal(result.status, 0);
    assert.equal(result.payload.ok, true);
    assert.equal(result.payload.data.dryrun, true);
    const receipt = {send_message: {sent: false, target: 'isolated-fixture'}, click: {clicked: false},
      screenshot: {path: null}, read_inbox: {messages: []}}[action];
    assert.deepEqual(result.payload.data, {dryrun: true, ...receipt});
  });
}

test('微信脚本保留健康探测，探测不能被误当成业务执行', t => {
  const result = run(t, 'health_check');
  assert.equal(result.status, 0);
  assert.deepEqual(result.payload, {ok: true, data: {alive: true, dryrun: false}});
});
