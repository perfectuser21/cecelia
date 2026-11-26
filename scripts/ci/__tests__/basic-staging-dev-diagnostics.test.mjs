import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('隔离staging的真实DEV端口冲突必须输出启动退出码、端口及原生错误', {timeout: 45000}, async t => {
  const temp = mkdtempSync(join(tmpdir(), 'staging-dev-diagnostics-'));
  t.after(() => rmSync(temp, {recursive: true, force: true}));
  // 仅在测试自己的wrapper探测后占用DEV端口。
  // smoke、dev启动器、Node服务及wrapper清理均运行真实实现。
  const original = readFileSync(join(root, 'scripts/ci/run-isolated-staging-smoke.mjs'), 'utf8');
  const allocation = 'const port = await unusedPortRange();';
  assert.ok(original.includes(allocation), 'fixture需要wrapper真实端口分配入口');
  const wrapper = join(temp, 'collision-wrapper.mjs');
  writeFileSync(wrapper, original.replace(allocation, `${allocation}
    const occupied = createServer(socket => socket.destroy());
    await new Promise((done, reject) => occupied.once('error', reject).listen(port + 3, '0.0.0.0', done));
    occupied.unref();`));
  const child = spawn(process.execPath, [wrapper, 'scripts/smoke/dashboard-staging-gate-smoke.sh'], {
    cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  // 只取消本测试的wrapper，由其finally清理自己创建的独立进程组。
  const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({code, signal}));
  }).finally(() => clearTimeout(timer));
  assert.equal(result.signal, null, output);
  assert.equal(result.code, 1, output);
  assert.match(output, /STAGING_GATE_SMOKE_FAIL/, output);
  const port = /Dashboard 放行闸 smoke \(port=(\d+)\)/.exec(output);
  assert.ok(port, output);
  assert.match(output, new RegExp(`DEV diagnostics: exit=1 port=${Number(port[1]) + 3}\\b`), output);
  assert.match(output, /EADDRINUSE/, output);
});
