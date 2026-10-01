import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const moduleUrl = new URL('../node-onboarding.mjs', import.meta.url);
const pythonPath = fileURLToPath(new URL('../node-agent.py', import.meta.url));
const remotePath = fileURLToPath(new URL('../node-agent-remote.py', import.meta.url));
const request = { id: '12345678-1234-4234-8234-123456789abc', name: 'test-node', address: '192.0.2.1', ssh_user: 'runner', ssh_port: 22, credential_ref: 'op://CS/example/private key', host_key_fingerprint: `SHA256:${'A'.repeat(43)}`, role: 'worker', region: 'test', mode: 'enroll' };
const health = (seq = 1) => ({ schema_version: 1, node_id: request.id, agent_version: '1', boot_id: 'a2345678-1234-4234-8234-123456789abc', observed_at: new Date(Date.now() + seq * 1000).toISOString(), sequence: seq, hostname: 'test-host', os: 'linux', resources: { memory_total_bytes: 1024, memory_available_bytes: 512, cpu_load_1m: 0, cpu_cores: 2, disk_free_bytes: 2048, disk_total_bytes: 4096 }, capabilities: { collector: true, janitor: true, execution: false }, janitor: { policy: 'owned-cache-only', mode: 'observe' } });
async function runtime() {
  try { return await import(moduleUrl); } catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') assert.fail('节点接入运行时尚未实现'); throw error; }
}
function harness(overrides = {}) {
  const calls = []; let sampleCount = 0;
  const runner = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    if (command === 'op') return { stdout: 'PRIVATE-SECRET\n', code: 0 };
    if (command === 'ssh-keyscan') return { stdout: '192.0.2.1 ssh-ed25519 AAAATEST\n', code: 0 };
    if (command === 'ssh-keygen') return { stdout: `256 ${overrides.pin || request.host_key_fingerprint} test (ED25519)\n`, code: 0 };
    if (command === 'ssh') {
      if (overrides.sshError) throw new Error('PRIVATE-SECRET internal stderr');
      const payload = JSON.parse(Buffer.from(options.input.split('\n')[1], 'base64').toString());
      if (payload.action === 'probe') return { stdout: JSON.stringify({ os: 'linux', hostname: 'test-host' }), code: 0 };
      if (payload.action === 'install') return { stdout: '{}', code: 0 };
      sampleCount++;
      return { stdout: JSON.stringify({ service: { enabled: true, active: !overrides.inactive }, health: overrides.stale ? { ...health(sampleCount), observed_at: '2020-01-01T00:00:00Z' } : health(overrides.stuck ? 1 : sampleCount) }), code: 0 };
    }
    throw new Error('未知命令');
  };
  return { runner, calls };
}

test('输入拒绝命令注入、非 CS 凭据和未知模式', async () => {
  const { validateRequest } = await runtime();
  assert.equal(validateRequest(request).id, request.id);
  for (const patch of [{ name: 'a;id' }, { address: '-oProxyCommand=bad' }, { address: 'x$(id)' }, { ssh_user: 'a;id' }, { credential_ref: 'op://Other/x/y' }, { mode: 'delete' }, { ssh_port: 0 }]) assert.throws(() => validateRequest({ ...request, ...patch }));
});

test('接入验证后台序号增长，隔离 SSH 配置并清理私钥', async () => {
  const { onboard } = await runtime(); const home = await mkdtemp(join(tmpdir(), 'node-enroll-')); const h = harness(); const waits = [];
  try {
    const receipt = await onboard(request, { runner: h.runner, home, sleep: async ms => waits.push(ms) });
    assert.equal(receipt.verified, true); assert.equal(receipt.health.sequence, 2); assert.equal(receipt.health.capabilities.execution, false);
    assert.ok(waits.some(ms => ms >= 10000));
    const ssh = h.calls.find(c => c.command === 'ssh');
    assert.ok(ssh.args.includes('StrictHostKeyChecking=yes')); assert.ok(ssh.args.includes('/dev/null')); assert.ok(ssh.args.includes('IdentitiesOnly=yes'));
    const keyPath = ssh.args[ssh.args.indexOf('-i') + 1]; await assert.rejects(access(keyPath));
    assert.deepEqual(receipt.steps.map(s => s.key), ['connect', 'probe', 'install', 'verify']);
  } finally { await rm(home, { recursive: true, force: true }); }
});

for (const [label, options, expected] of [['主机指纹不匹配', { pin: 'SHA256:wrong' }, 'HOST_KEY_MISMATCH'], ['服务未运行', { inactive: true }, 'VERIFY_FAILED'], ['样本过期', { stale: true }, 'VERIFY_FAILED'], ['序号不增长', { stuck: true }, 'VERIFY_FAILED'], ['命令错误不泄露密钥', { sshError: true }, 'CONNECT_FAILED']]) {
  test(label, async () => {
    const { onboard } = await runtime(); const home = await mkdtemp(join(tmpdir(), 'node-fail-')); const h = harness(options);
    try { const result = await onboard(request, { runner: h.runner, home, sleep: async () => {} }); assert.equal(result.verified, false); assert.equal(result.error_code, expected); assert.ok(!JSON.stringify(result).includes('PRIVATE-SECRET')); if (options.pin) assert.ok(!h.calls.some(c => c.command === 'ssh')); }
    finally { await rm(home, { recursive: true, force: true }); }
  });
}

test('采样模式不执行安装', async () => {
  const { onboard } = await runtime(); const home = await mkdtemp(join(tmpdir(), 'node-sample-')); const h = harness();
  try { const result = await onboard({ ...request, mode: 'sample' }, { runner: h.runner, home, sleep: async () => {} }); assert.equal(result.verified, true); assert.ok(!h.calls.some(c => c.command === 'ssh' && c.options.input.includes(Buffer.from('install').toString('base64')))); assert.ok(!result.steps.some(s => s.key === 'install')); }
  finally { await rm(home, { recursive: true, force: true }); }
});

test('真实 collector 子进程产生两份健康样本且权限600', { timeout: 20000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'node-collector-'));
  const child = spawn('python3', [pythonPath, '--node-id', request.id, '--home', home], { stdio: 'ignore' });
  const closed = new Promise(resolve => child.once('close', resolve));
  try {
    const path = join(home, '.local/state/cecelia-node', request.id, 'health.json'); const samples = []; const started = Date.now();
    while (Date.now() - started < 14000 && samples.length < 2) {
      try { const sample = JSON.parse(await readFile(path, 'utf8')); if (!samples.length || sample.sequence > samples[0].sequence) samples.push(sample); } catch {}
      if (samples.length < 2) await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(samples.length, 2, '实际后台采集必须持续刷新'); assert.ok(Date.parse(samples[1].observed_at) - Date.parse(samples[0].observed_at) >= 9900);
    assert.match(samples[1].boot_id, /^[0-9a-f-]{36}$/); assert.equal(samples[0].boot_id, samples[1].boot_id);
    assert.equal(samples[1].node_id, request.id); assert.equal(samples[1].capabilities.execution, false); assert.ok(samples[1].resources.memory_total_bytes > 0); assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally { child.kill('SIGTERM'); await closed; await rm(home, { recursive: true, force: true }); }
});

test('身份保护、安装幂等、观察清理边界与软链保护', () => {
  const script = `import importlib.util, pathlib, tempfile, os, json, time
spec = importlib.util.spec_from_file_location('collector', ${JSON.stringify(pythonPath)})
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
spec2 = importlib.util.spec_from_file_location('remote', ${JSON.stringify(remotePath)})
r = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(r)
with tempfile.TemporaryDirectory() as t:
 h=pathlib.Path(t); node=${JSON.stringify(request.id)}
 state=c.prepare_identity(h,node); assert c.prepare_identity(h,node)==state
 (h/'.local/share/cecelia-node/identity.json').write_text(json.dumps({'node_id':'different'}))
 try: c.prepare_identity(h,node); raise AssertionError('必须拒绝覆盖身份')
 except ValueError: pass
 (h/'.local/share/cecelia-node/identity.json').write_text(json.dumps({'node_id':node}))
 cache=state/'cache'; cache.mkdir(exist_ok=True)
 old=cache/'old'; old.write_text('abc'); os.utime(old,(0,0))
 outside=h/'outside'; outside.write_text('outside'); os.utime(outside,(0,0)); (cache/'link').symlink_to(outside)
 (cache/'active').write_text('live'); os.utime(cache/'active',(0,0)); (cache/'active.lease').write_text(json.dumps({'expires_at':time.time()+3600}))
 result=c.inspect_cache(state); assert result['reclaimable_files']==1 and result['reclaimable_bytes']==3
 assert old.exists() and outside.exists() and (cache/'active').exists()
 commands=[]
 def run(args):
  commands.append(args)
  return 'yes' if 'show-user' in args else ('enabled' if 'is-enabled' in args else 'active')
 r.install(h,node,pathlib.Path(${JSON.stringify(pythonPath)}).read_text(),system='linux',uid=1234,run=run)
 before=(h/f'.local/share/cecelia-node/{node}/node-agent.py').read_bytes()
 r.install(h,node,pathlib.Path(${JSON.stringify(pythonPath)}).read_text(),system='linux',uid=1234,run=run)
 assert before==(h/f'.local/share/cecelia-node/{node}/node-agent.py').read_bytes()
 assert any('enable' in cmd for cmd in commands)
 assert all('prune' not in ' '.join(cmd) for cmd in commands)
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
});

test('整轮超时也中断采样等待并清理凭据', async () => {
  const { onboard } = await runtime(); const home = await mkdtemp(join(tmpdir(), 'node-timeout-')); const h = harness();
  try {
    const started = Date.now();
    const result = await onboard(request, { runner: h.runner, home, totalTimeoutMs: 100, sleep: () => new Promise(resolve => setTimeout(resolve, 500)) });
    assert.equal(result.error_code, 'TIMEOUT'); assert.ok(Date.now() - started < 350);
    await assert.rejects(access(join(home, '.credentials/cecelia-onboarding', request.id, 'key')));
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('拒绝超出资源总量的伪健康样本', async () => {
  const { verifySample } = await runtime(); const value = health();
  value.resources.memory_available_bytes = value.resources.memory_total_bytes + 1;
  assert.throws(() => verifySample({ health: value, service: { enabled: true, active: true } }, request, { hostname: 'test-host', os: 'linux' }));
});

test('SSH stdin 启动器真实执行 Python 探测代码', async () => {
  const { onboard } = await runtime(); const home = await mkdtemp(join(tmpdir(), 'node-wire-')); const h = harness();
  try {
    await onboard({ ...request, mode: 'sample' }, { runner: h.runner, home, sleep: async () => {} });
    const ssh = h.calls.find(call => call.command === 'ssh');
    const result = spawnSync('python3', ['-c', 'import sys; exec(sys.stdin.readline())'], { input: ssh.options.input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); const probe = JSON.parse(result.stdout); assert.ok(['linux', 'darwin'].includes(probe.os)); assert.ok(probe.hostname);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('命令超时终止真实子进程且错误不含stderr', async () => {
  const { runCommand } = await import('../node-onboarding-runner.mjs');
  await assert.rejects(runCommand('python3', ['-c', 'import sys,time; sys.stderr.write("PRIVATE-SECRET"); time.sleep(5)'], { timeoutMs: 50 }), error => !error.message.includes('PRIVATE-SECRET'));
});


test('名称与后端统一为2至63位且允许数字开头', async () => {
  const { validateRequest } = await runtime();
  for (const name of ['1n', 'aa', 'a'.repeat(63)]) assert.equal(validateRequest({ ...request, name }).name, name);
  for (const name of ['a', '', 'a'.repeat(64), '-aa', 'A-node', 'a_node']) assert.throws(() => validateRequest({ ...request, name }));
  assert.equal(validateRequest({ ...request, ssh_user: 'a'.repeat(32) }).ssh_user.length, 32);
  for (const ssh_user of ['a'.repeat(33), 'user$']) assert.throws(() => validateRequest({ ...request, ssh_user }));
  for (const credential_ref of ['op://CS/item/section/field', 'op://CS/item', 'op://CS//field']) assert.throws(() => validateRequest({ ...request, credential_ref }));
});

test('连续验收拒绝缺失启动身份及跨进程样本', async () => {
  const { verifySample } = await runtime(); const first = health(1);
  const probe = { hostname: 'test-host', os: 'linux' }; const service = { enabled: true, active: true };
  for (const boot_id of [undefined, 'invalid', 'b2345678-1234-4234-8234-123456789abc']) {
    assert.throws(() => verifySample({ service, health: { ...health(2), boot_id } }, request, probe, first));
  }
});

test('真实采集器重启更换启动身份并延续已有序号', { timeout: 10000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'node-reboot-'));
  const path = join(home, '.local/state/cecelia-node', request.id, 'health.json'); const samples = [];
  try {
    for (let run = 0; run < 2; run++) {
      const child = spawn('python3', [pythonPath, '--node-id', request.id, '--home', home], { stdio: 'ignore' });
      const closed = new Promise(resolve => child.once('close', resolve));
      try {
        const started = Date.now();
        while (Date.now() - started < 3000) {
          try { const sample = JSON.parse(await readFile(path, 'utf8')); if (!samples.length || sample.sequence > samples[0].sequence) { samples.push(sample); break; } } catch {}
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } finally { child.kill('SIGTERM'); await closed; }
    }
    assert.equal(samples.length, 2); assert.match(samples[0].boot_id, /^[0-9a-f-]{36}$/);
    assert.notEqual(samples[1].boot_id, samples[0].boot_id); assert.ok(samples[1].sequence > samples[0].sequence);
    assert.ok(Date.parse(samples[1].observed_at) > Date.parse(samples[0].observed_at));
  } finally { await rm(home, { recursive: true, force: true }); }
});
