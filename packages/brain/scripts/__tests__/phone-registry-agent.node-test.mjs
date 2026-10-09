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
test('同代发布切指针故障，两个入口均保留旧可用数据', t => {
  const f = fixture(t); const code = `import importlib.util, pathlib, json, os
s=importlib.util.spec_from_file_location('agent',${JSON.stringify(script)}); m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
c=pathlib.Path(os.environ['PHONE_AGENT_CONFIG']); p=(c/m.PROFILE_NAME).read_text();a=(c/m.ACCOUNT_NAME).read_text()
replace=m.os.replace;count=0
def fail_switch(src,dest):
 global count
 if pathlib.Path(dest).name=='.phone-registry-current':
  count+=1
  if count==2: raise OSError('injected pointer switch failure')
 return replace(src,dest)
m.os.replace=fail_switch
try:m.publish(c,'new-profiles','new-accounts',p,a)
except OSError:pass
else:raise AssertionError('expected failure')
print(json.dumps({'profiles':(c/m.PROFILE_NAME).read_text()==p,'accounts':(c/m.ACCOUNT_NAME).read_text()==a}))`;
  const r = spawnSync('python3', ['-c', code], { env: f.env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { profiles: true, accounts: true });
});
test('核验超时先TERM收尾后退出，不直接杀掉wrapper留在途子进程', t => {
  const f = fixture(t); const child = join(f.dir, 'slow.py');
  writeFileSync(child, 'import signal,time,os,pathlib,sys\ndef stop(s,f):\n pathlib.Path(os.environ["PHONE_TEST_DIR"],"cleaned").write_text("1");sys.exit(143)\nsignal.signal(signal.SIGTERM,stop)\ntime.sleep(60)\n');
  const code = `import importlib.util,json,time\ns=importlib.util.spec_from_file_location('agent',${JSON.stringify(script)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nstart=time.monotonic();code,out=m.command(['python3',${JSON.stringify(child)}],timeout_s=.3);print(json.dumps({'code':code,'elapsed':time.monotonic()-start}))`;
  const r = spawnSync('python3', ['-c', code], { env: f.env, encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, r.stderr); const out = JSON.parse(r.stdout); assert.equal(out.code, 124); assert.ok(out.elapsed < 3);
  assert.equal(readFileSync(join(f.dir, 'cleaned'), 'utf8'), '1');
});

test('控制器失败即使输出正确ID也不得确认核验通过或误报账号不一致', t => {
  const f = fixture(t); const ctl = f.env.PHONE_AGENT_CONTROLLER;
  writeFileSync(ctl, readFileSync(ctl, 'utf8') + '\nexit 17\n');
  // lock-status仍正常，只有持锁核验命令返回失败。
  writeFileSync(ctl, readFileSync(ctl, 'utf8').replace('exit 17', 'if [ "$3" = with-lock ]; then exit 17; fi'));
  assert.equal(f.run().receipts[0].status, 'unreadable');
  assert.match(f.log(), /account-current/);
});

test('v1坐标上限迁到v2真实宽高须加一，v2尺寸不得再增加', t => {
  const f = fixture(t); writeFileSync(join(f.conf, 'douyin-phone-profiles.tsv'), 'p1\tSER1\tMODEL\t1079\t2411\n');
  assert.equal(f.run().ok, true);
  assert.match(readFileSync(join(f.conf, 'douyin-phone-profiles.tsv'), 'utf8'), /SER1\tMODEL\t1080\t2412/);
  assert.equal(f.run().ok, true);
  assert.match(readFileSync(join(f.conf, 'douyin-phone-profiles.tsv'), 'utf8'), /SER1\tMODEL\t1080\t2412/);
});
test('业务成功但wrapper明确报告清场失败不得缓存当天核验通过', t => {
  const f = fixture(t); const ctl = f.env.PHONE_AGENT_CONTROLLER;
  writeFileSync(ctl, readFileSync(ctl, 'utf8') + '\nif [ "$3" = with-lock ]; then echo "warning: close-app cleanup failed" >&2; fi\n');
  assert.equal(f.run().receipts[0].status, 'cleanup_failed');
  assert.equal(f.run().receipts[0].status, 'cleanup_failed');
  assert.equal((f.log().match(/account-current/g) ?? []).length, 2);
});

test('v2扩展技术列按serial保留，enabled严格从Brain真身导出', t => {
  const f = fixture(t); const path = join(f.conf, 'douyin-phone-profiles.tsv');
  writeFileSync(path, '#registry_version 2\n#profile\tserial\tmodel\twidth\theight\tdensity\tsdk\tlocale\tapp_version\tenabled\nv1\tSER1\tMODEL\t1080\t2412\t440\t34\tzh-CN\t31.0\tfalse\n');
  assert.equal(f.run().ok, true);
  const rows = readFileSync(path, 'utf8').trim().split('\n');
  const columns = rows.find(row => row.startsWith('#profile')).slice(1).split('\t');
  const row = rows.find(row => row.startsWith('p1\t')).split('\t');
  const values = Object.fromEntries(columns.map((key, i) => [key, row[i]]));
  assert.equal(values.density, '440'); assert.equal(values.sdk, '34'); assert.equal(values.locale, 'zh-CN');
  assert.equal(values.app_version, '31.0'); assert.equal(values.enabled, 'true');
});

test('原始TSV引号昵称不得吞掉下一手机行，账号角色两代仍保留', t => {
  const f = fixture(t); const path = join(f.conf, 'douyin-phone-profiles.tsv');
  writeFileSync(path, readFileSync(path, 'utf8') + 'p2\tSER2\tMODEL\t1080\t2412\t小号\txian-m1\t归属\t研发\t\n');
  writeFileSync(join(f.conf, 'douyin-account-routes.tsv'), 'p1\t123\t"账号\tcustom-role\n');
  const rows = [{ ...phones[0], nickname: '"小号', douyin_accounts: [{ id: '123', nickname: '"账号', current: true }] },
    { ...phones[0], serial: 'SER2', profile: 'p2', nickname: '第二手机', douyin_accounts: [] }];
  assert.equal(f.run({ phones: rows }).ok, true); assert.equal(f.run({ phones: rows }).ok, true);
  assert.match(readFileSync(path, 'utf8'), /p2\tSER2/);
  assert.match(readFileSync(join(f.conf, 'douyin-account-routes.tsv'), 'utf8'), /123\t"账号\tcustom-role/);
});
test('整轮核验给TERM收尾留预算，不让SSH外层期限先杀在途控制器', t => {
  const f = fixture(t); const code = `import importlib.util,json,pathlib,os\ns=importlib.util.spec_from_file_location('agent',${JSON.stringify(script)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nclock=[0.0];calls=[]\nm.time.monotonic=lambda:clock[0]\ndef bounded(argv,timeout_s=20):\n calls.append(timeout_s);clock[0]+=timeout_s+7;return 124,''\nm.command=bounded\nbundle={'phones':[{'serial':'SER1','profile':'p1','host':'xian-m1','douyin_accounts':[{'id':'123','current':True}]},{'serial':'SER2','profile':'p2','host':'xian-m1','douyin_accounts':[{'id':'456','current':True}]}],'host':'xian-m1','tasks':[],'now':1893500000000}\nr=m.reconcile(pathlib.Path(os.environ['PHONE_AGENT_CONFIG']),bundle,budget_s=8);print(json.dumps({'calls':calls,'elapsed':clock[0],'receipts':r}))`;
  const r = spawnSync('python3', ['-c', code], { env: f.env, encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, r.stderr); const out = JSON.parse(r.stdout);
  assert.ok(out.calls.every(timeout => timeout <= 1)); assert.ok(out.elapsed <= 8);
  assert.equal(out.receipts[1].status, 'budget_exhausted');
  assert.ok(out.receipts.every(receipt => receipt.status !== 'verified'));
});
