import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const script = new URL('../phone-registry-agent.py', import.meta.url).pathname;
const phones = [{ serial: 'SER1', profile: 'p1', host: 'xian-m1', nickname: '台账昵称', model: 'MODEL', owner: '归属', role: '研发', enabled: true,
  douyin_accounts: [{ id: '123', nickname: '台账号', current: true }], wechat: { id: 'wxid', nickname: '微信' } }];
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'phone-agent-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const conf = join(dir, 'config'); mkdirSync(conf);
  writeFileSync(join(conf, 'douyin-phone-profiles.tsv'), '#registry_version 2\n#profile\tserial\tmodel\twidth\theight\tnickname\thost\towner\trole\twechat\np1\tSER1\tMODEL\t1234\t2345\t旧昵称\txian-m1\t旧归属\t研发\t\n');
  writeFileSync(join(conf, 'douyin-account-routes.tsv'), 'p1\t123\t旧号\tsearch-primary,distribution\n');
  writeFileSync(join(dir, 'actual'), '123');
  const ctl = join(dir, 'ctl');
  writeFileSync(ctl, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PHONE_TEST_DIR/ctl.log"\ncase "$3" in\nlock-status) if [ -f "$PHONE_TEST_DIR/busy" ]; then echo lock=held; else echo lock=free; fi;;\nwith-lock) printf "douyin_id="; cat "$PHONE_TEST_DIR/actual"; printf "\\n";;\nesac\n', { mode: 0o755 });
  const env = { ...process.env, PHONE_AGENT_CONFIG: conf, PHONE_AGENT_CONTROLLER: ctl, PHONE_TEST_DIR: dir };
  const run = (over = {}) => {
    const bundle = Buffer.from(JSON.stringify({ phones, host: 'xian-m1', tasks: [], now: Date.parse('2030-01-01T12:00:00Z'), ...over })).toString('base64');
    const r = spawnSync('python3', [script, '--bundle-b64', bundle], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
  };
  return { dir, conf, env, run, log: () => { try { return readFileSync(join(dir, 'ctl.log'), 'utf8'); } catch { return ''; } } };
}
test('同源TSV经单代指针发布，保留serial实测宽高和账号角色', t => {
  const f = fixture(t); const out = f.run(); assert.equal(out.ok, true);
  const profiles = readFileSync(join(f.conf, 'douyin-phone-profiles.tsv'), 'utf8');
  assert.match(profiles, /p1\tSER1\tMODEL\t1234\t2345\t台账昵称/);
  assert.match(readFileSync(join(f.conf, 'douyin-account-routes.tsv'), 'utf8'), /123\t台账号\tsearch-primary,distribution/);
  assert.match(readlinkSync(join(f.conf, 'douyin-phone-profiles.tsv')), /phone-registry-current/);
  assert.match(readlinkSync(join(f.conf, 'douyin-account-routes.tsv')), /phone-registry-current/);
  assert.equal(out.receipts[0].status, 'verified'); assert.match(f.log(), /with-lock.*account-current 123/);
});
test('当日同一目标只核验一次；目标ID改后重新核验', t => {
  const f = fixture(t); f.run(); const first = f.log(); f.run(); assert.equal(f.log(), first);
  writeFileSync(join(f.dir, 'actual'), '456');
  const out = f.run({ phones: [{ ...phones[0], douyin_accounts: [{ id: '456', nickname: '新号', current: true }] }] });
  assert.equal(out.receipts[0].status, 'verified'); assert.match(f.log(), /account-current 456/);
});
test('锁忙不读账号、不记当天核验成功；恢复空闲后仍会核验', t => {
  const f = fixture(t); writeFileSync(join(f.dir, 'busy'), '1');
  assert.equal(f.run().receipts[0].status, 'busy'); assert.doesNotMatch(f.log(), /with-lock/);
  rmSync(join(f.dir, 'busy')); assert.equal(f.run().receipts[0].status, 'verified');
});
test('在途设备任务与未知设备任务不碰UI；明确别机可以核验', t => {
  const f = fixture(t);
  for (const payload of [{ serial: 'SER1' }, {}]) {
    assert.equal(f.run({ tasks: [{ id: 'running', status: 'in_progress', task_type: 'device_job', payload }] }).receipts[0].status, 'task_busy');
  }
  assert.equal(f.log(), '');
  assert.equal(f.run({ tasks: [{ id: 'other', status: 'in_progress', task_type: 'device_job', payload: { serial: 'OTHER' } }] }).receipts[0].status, 'verified');
});
test('错号仅返回提醒回执，不切换或写台账；空ID不能当通过', t => {
  const f = fixture(t); writeFileSync(join(f.dir, 'actual'), 'wrong-id');
  const out = f.run(); assert.equal(out.receipts[0].status, 'mismatch'); assert.equal(out.receipts[0].actual_id, 'wrong-id');
  assert.doesNotMatch(f.log(), /switch|send|tap/);
  writeFileSync(join(f.dir, 'actual'), ''); assert.equal(f.run().receipts[0].status, 'unreadable');
});
test('缺失真实宽高或非法数据不覆盖任何可用代', t => {
  const f = fixture(t); const before = readFileSync(join(f.conf, 'douyin-phone-profiles.tsv'), 'utf8');
  const out = f.run({ phones: [{ ...phones[0], serial: 'NEW' }] });
  assert.equal(out.ok, false); assert.equal(readFileSync(join(f.conf, 'douyin-phone-profiles.tsv'), 'utf8'), before); assert.equal(f.log(), '');
});
