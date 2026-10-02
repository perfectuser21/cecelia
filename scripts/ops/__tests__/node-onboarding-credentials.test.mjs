import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink, link, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const runnerUrl = new URL('../node-onboarding-runner.mjs', import.meta.url).href;
const cached = 'ops_fixture-cache-token';
const inherited = 'ops_fixture-inherited-token';

async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'onboarding-op-')));
  const directory = join(home, '.credentials'); const path = join(directory, '1password.env');
  await mkdir(directory, { mode: 0o700 }); await mkdir(join(home, 'bin'));
  await writeFile(path, `# 私有服务账号缓存\nexport OP_SERVICE_ACCOUNT_TOKEN='${cached}'\n`, { mode: 0o600 });
  await writeFile(join(home, 'bin', 'op'), `#!${process.execPath}\nif (process.argv.slice(2).join('|') !== 'read|op://CS/fixture/private key') process.exit(7);\nif ((process.env.OP_SERVICE_ACCOUNT_TOKEN || 'desktop') !== process.env.EXPECTED_TOKEN) process.exit(8);\nprocess.stdout.write('FIXTURE-PRIVATE-KEY');\n`, { mode: 0o700 });
  return { home, directory, path, cleanup: () => rm(home, { recursive: true, force: true }) };
}

function invoke(f, { token, expected = cached, command = 'op', args = ['read', 'op://CS/fixture/private key'], setup = '', options = {} } = {}) {
  const env = { ...process.env, HOME: f.home, PATH: `${join(f.home, 'bin')}:${process.env.PATH}`, EXPECTED_TOKEN: expected };
  delete env.OP_SERVICE_ACCOUNT_TOKEN;
  if (token !== undefined) env.OP_SERVICE_ACCOUNT_TOKEN = token;
  const source = `import { runCommand } from ${JSON.stringify(runnerUrl)};
${setup}
try { const result = await runCommand(${JSON.stringify(command)}, ${JSON.stringify(args)}, ${JSON.stringify(options)}); process.stdout.write(JSON.stringify(result)); }
catch (error) { process.stdout.write(JSON.stringify({ error: error.message })); process.exitCode = 1; }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined); assert.equal(result.stderr, '');
  assert.ok(!result.stdout.includes(cached)); assert.ok(!result.stdout.includes(inherited));
  return { status: result.status, value: JSON.parse(result.stdout) };
}

test('非交互冷环境从私有缓存启动真实 op 子进程', async () => {
  const f = await fixture();
  try { assert.deepEqual(invoke(f), { status: 0, value: { stdout: 'FIXTURE-PRIVATE-KEY', code: 0 } }); }
  finally { await f.cleanup(); }
});

test('已有非空环境凭据优先，不读取不安全缓存', async () => {
  const f = await fixture();
  try { await chmod(f.path, 0o644); assert.equal(invoke(f, { token: inherited, expected: inherited }).value.code, 0); }
  finally { await f.cleanup(); }
});

test('缺少缓存保留 op 原有桌面授权路径', async () => {
  const f = await fixture();
  try { await rm(f.path); assert.equal(invoke(f, { expected: 'desktop' }).value.code, 0); }
  finally { await f.cleanup(); }
});

test('缓存凭据仅注入 op，其他命令不接收它', async () => {
  const f = await fixture();
  try { assert.equal(invoke(f, { command: process.execPath, args: ['-e', 'process.stdout.write(String(Boolean(process.env.OP_SERVICE_ACCOUNT_TOKEN)))'] }).value.stdout, 'false'); }
  finally { await f.cleanup(); }
});

test('空环境变量回退私有缓存并接受普通和双引号赋值', async () => {
  const f = await fixture();
  try {
    for (const value of [cached, `"${cached}"`]) {
      await writeFile(f.path, `OP_SERVICE_ACCOUNT_TOKEN=${value}\n`);
      assert.equal(invoke(f, { token: '  ' }).value.code, 0);
    }
  } finally { await f.cleanup(); }
});

test('缓存目录与文件必须属于当前运行用户', async () => {
  const f = await fixture();
  try {
    for (const setup of ['process.getuid = () => -1;', 'const uid = process.getuid(); let n = 0; process.getuid = () => n++ ? -1 : uid;']) {
      assert.equal(invoke(f, { setup }).status, 1);
    }
  } finally { await f.cleanup(); }
});

test('缓存文件为FIFO时及时拒绝，不阻塞超时与清理', async () => {
  const f = await fixture();
  try {
    await rm(f.path); assert.equal(spawnSync('mkfifo', [f.path]).status, 0); await chmod(f.path, 0o600);
    assert.equal(invoke(f).status, 1);
  } finally { await f.cleanup(); }
});

test('加载缓存后 op 超时仍终止子进程并隐藏stderr', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.home, 'bin', 'op'), `#!${process.execPath}\nprocess.stderr.write(process.env.OP_SERVICE_ACCOUNT_TOKEN); setTimeout(() => {}, 10000);\n`);
    const result = invoke(f, { options: { timeoutMs: 50 } });
    assert.deepEqual(result, { status: 1, value: { error: '命令执行失败' } });
  } finally { await f.cleanup(); }
});

test('接入实际读取缓存后写入并清理私钥，回执隐藏凭据且锁可重用', async () => {
  const f = await fixture();
  const request = { id: '12345678-1234-4234-8234-123456789abc', name: 'test-node', address: '192.0.2.1', ssh_user: 'runner', ssh_port: 22, credential_ref: 'op://CS/fixture/private key', host_key_fingerprint: `SHA256:${'A'.repeat(43)}`, role: 'worker', region: 'test', mode: 'enroll' };
  try {
    const env = { ...process.env, HOME: f.home, PATH: `${join(f.home, 'bin')}:${process.env.PATH}`, EXPECTED_TOKEN: cached };
    delete env.OP_SERVICE_ACCOUNT_TOKEN;
    const source = `import assert from 'node:assert/strict';
import { readFile, stat, access, chmod } from 'node:fs/promises';
import { runCommand } from ${JSON.stringify(runnerUrl)};
import { onboard } from ${JSON.stringify(new URL('../node-onboarding.mjs', import.meta.url).href)};
const key = ${JSON.stringify(join(f.directory, 'cecelia-onboarding', request.id, 'key'))};
let verifiedKeys = 0;
const runner = async (command, args, options) => {
  if (command === 'op') return runCommand(command, args, options);
  assert.equal(await readFile(key, 'utf8'), 'FIXTURE-PRIVATE-KEY'); assert.equal((await stat(key)).mode & 0o777, 0o600);
  verifiedKeys++;
  throw new Error('FIXTURE-PRIVATE-KEY ' + process.env.EXPECTED_TOKEN);
};
for (let attempt = 0; attempt < 2; attempt++) {
  const receipt = await onboard(${JSON.stringify(request)}, { runner });
  assert.equal(receipt.error_code, 'CONNECT_FAILED'); await assert.rejects(access(key));
  assert.ok(!JSON.stringify(receipt).includes(process.env.EXPECTED_TOKEN)); assert.ok(!JSON.stringify(receipt).includes('FIXTURE-PRIVATE-KEY'));
}
assert.equal(verifiedKeys, 2, '私钥断言必须成功执行，不能被接入异常回执吞掉');
await chmod(${JSON.stringify(f.path)}, 0o644);
const receipt = await onboard(${JSON.stringify(request)}, { runner });
assert.equal(receipt.error_code, 'CREDENTIAL_FAILED'); await assert.rejects(access(key));
assert.equal(process.env.OP_SERVICE_ACCOUNT_TOKEN, undefined);
process.stdout.write('已验证私钥生命周期、回执脱敏和锁释放');`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '已验证私钥生命周期、回执脱敏和锁释放');
  } finally { await f.cleanup(); }
});

for (const [label, damage] of [
  ['公开权限', f => chmod(f.path, 0o644)],
  ['可执行权限', f => chmod(f.path, 0o700)],
  ['目录可被其他用户写', f => chmod(f.directory, 0o777)],
  ['文件软链', async f => { await rm(f.path); await symlink(join(f.home, 'missing'), f.path); }],
  ['目录软链', async f => { await rm(f.directory, { recursive: true }); await mkdir(join(f.home, 'elsewhere')); await symlink(join(f.home, 'elsewhere'), f.directory); }],
  ['硬链接', f => link(f.path, join(f.home, 'duplicate'))],
  ['非普通文件', async f => { await rm(f.path); await mkdir(f.path); }],
  ['体积过大', f => writeFile(f.path, '#'.repeat(16385))],
  ['重复赋值', f => writeFile(f.path, `OP_SERVICE_ACCOUNT_TOKEN=${cached}\nOP_SERVICE_ACCOUNT_TOKEN=${inherited}\n`)],
  ['其他环境变量', f => writeFile(f.path, `OP_SERVICE_ACCOUNT_TOKEN=${cached}\nPATH=/untrusted\n`)],
  ['shell表达式', f => writeFile(f.path, `OP_SERVICE_ACCOUNT_TOKEN=$(touch ${join(f.home, 'executed')})\n`)],
  ['空凭据', f => writeFile(f.path, "OP_SERVICE_ACCOUNT_TOKEN=''\n")],
  ['没有赋值', f => writeFile(f.path, '# no token\n')],
]) {
  test(`存在但不安全的缓存安全拒绝：${label}`, async () => {
    const f = await fixture();
    try {
      await damage(f); const result = invoke(f); assert.equal(result.status, 1); assert.equal(result.value.error, '1Password 凭据缓存不安全或格式无效');
      await assert.rejects(access(join(f.home, 'executed')), { code: 'ENOENT' });
    }
    finally { await f.cleanup(); }
  });
}
