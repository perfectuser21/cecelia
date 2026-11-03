import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {once} from 'node:events';

const entry = fileURLToPath(new URL('../frontend-proxy.js', import.meta.url));
const document = '<!doctype html><main>PRIVATE_DASHBOARD_' + '原始文档'.repeat(400) + '</main>';
const outside = 'PRIVATE_OUTSIDE_DIST_MUST_NOT_BE_SERVED';

async function listen(server) {
  server.listen(0);
  await once(server, 'listening');
  return server.address().port;
}
async function close(server) {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}
async function unusedPort() {
  const server = net.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}
function httpRequest(port, path, {method = 'GET', body, headers = {}} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port, path, method, headers}, res => {
      const chunks = [];
      res.on('data', data => chunks.push(data));
      res.on('error', reject);
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
    });
    req.setTimeout(2000, () => req.destroy(new Error('PRIVATE_HTTP_TIMEOUT')));
    req.on('error', reject);
    req.end(body);
  });
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'frontend-proxy-http-'));
  const dist = join(root, 'dist');
  await mkdir(dist);
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'index.html'), document);
  await writeFile(join(root, 'outside.txt'), outside);
  const received = [];
  const response = {status: 200, body: {source: 'private-brain'}, headers: {'X-Private-Upstream': 'fixture'}};
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', data => chunks.push(data));
    req.on('end', () => {
      received.push({method: req.method, path: req.url, host: req.headers.host,
        contentType: req.headers['content-type'], body: Buffer.concat(chunks).toString()});
      res.writeHead(response.status, {'Content-Type': 'application/json', ...response.headers});
      res.end(JSON.stringify(response.body));
    });
  });
  const sockets = new Set();
  upstream.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const brainPort = await listen(upstream);
  const port = await unusedPort();
  assert.ok(![5211, 5221, 3000, 3001].includes(port) && ![5211, 5221].includes(brainPort));
  const child = spawn(process.execPath, [entry], {env: {PATH: process.env.PATH, HOME: root,
    FRONTEND_PORT: String(port), BRAIN_PORT_TARGET: String(brainPort),
    DASHBOARD_STATIC_DIR: dist, LANGFUSE_PROXY_PORT: '0'}, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    for (const socket of sockets) socket.destroy();
    if (upstream.listening) await close(upstream);
    await rm(root, {recursive: true, force: true});
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CLI readiness timeout: ' + output)), 3000);
    const ready = data => {
      if (String(data).includes('Frontend proxy running')) { clearTimeout(timeout); resolve(); }
    };
    child.stdout.on('data', ready);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`CLI exited ${code}: ${output}`)); });
  });
  return {root, dist, port, brainPort, upstream, response, received, child, output: () => output};
}

test('CLI真实文件按MIME/gzip字节服务，覆盖旧六种可压缩及六种已压缩类型', async t => {
  const f = await fixture(t);
  for (const ext of ['.js', '.css', '.html', '.json', '.svg', '.map']) {
    const value = Buffer.from(`PRIVATE_${ext}_` + '内容'.repeat(120));
    const path = `/assets/asset.a1b2${ext}`;
    await writeFile(join(f.dist, path.slice(1)), value);
    const res = await httpRequest(f.port, path, {headers: {'Accept-Encoding': 'gzip, deflate, br'}});
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], 'gzip', ext);
    assert.match(res.headers.vary, /Accept-Encoding/);
    assert.deepEqual(gunzipSync(res.body), value);
    if (ext === '.js') assert.equal(res.headers['content-type'], 'application/javascript');
  }
  for (const ext of ['.png', '.jpg', '.ico', '.woff', '.woff2', '.ttf']) {
    const value = Buffer.from([0, 255, 23, 88]);
    const path = `/assets/binary${ext}`;
    await writeFile(join(f.dist, path.slice(1)), value);
    const res = await httpRequest(f.port, path, {headers: {'Accept-Encoding': 'gzip'}});
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], undefined, ext);
    assert.deepEqual(res.body, value);
  }
  await writeFile(join(f.dist, 'plain.js'), 'PRIVATE_UNCOMPRESSED');
  for (const accept of [undefined, '', 'deflate, br']) {
    const res = await httpRequest(f.port, '/plain.js', {headers: accept === undefined ? {} : {'Accept-Encoding': accept}});
    assert.equal(res.headers['content-encoding'], undefined);
    assert.equal(res.body.toString(), 'PRIVATE_UNCOMPRESSED');
  }
});

test('真实HTML/SW/registerSW及SPA fallback不缓存，深链和查询仍返回本人文档', async t => {
  const f = await fixture(t);
  for (const name of ['sw.js', 'registerSW.js']) await writeFile(join(f.dist, name), `PRIVATE_${name}`);
  for (const path of ['/', '/index.html?version=private', '/sw.js', '/registerSW.js', '/pipeline/private-id']) {
    const res = await httpRequest(f.port, path);
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-cache, no-store, must-revalidate');
    if (!path.endsWith('sw.js') && !path.endsWith('registerSW.js')) assert.equal(res.body.toString(), document);
  }
});

test('真实goals/captures与Brain直达转发保留method/query/body/status，不能只测镜像函数', async t => {
  const f = await fixture(t);
  for (const [path, target, method, status, body] of [
    ['/api/tasks/goals?parent_id=%E7%A7%81%E6%9C%89%E7%9B%AE%E6%A0%87&limit=2', '/api/brain/tasks/goals?parent_id=%E7%A7%81%E6%9C%89%E7%9B%AE%E6%A0%87&limit=2', 'GET', 200, undefined],
    ['/api/captures?source=private', '/api/brain/captures?source=private', 'POST', 201, {content: '本人中文', enabled: false}],
    ['/api/captures/private-id?revision=2', '/api/brain/captures/private-id?revision=2', 'PATCH', 409, {status: 'completed'}],
    ['/api/captures/private-id', '/api/brain/captures/private-id', 'DELETE', 404, undefined],
    ['/api/brain/tasks/tasks?limit=3', '/api/brain/tasks/tasks?limit=3', 'GET', 500, undefined],
    ['/api/v1/vps-monitor/stats?private=1', '/api/brain/vps-monitor/stats?private=1', 'GET', 200, undefined],
  ]) {
    f.response.status = status;
    f.response.body = {upstream: target, status};
    const wireBody = body === undefined ? undefined : JSON.stringify(body);
    const res = await httpRequest(f.port, path, {method, body: wireBody,
      headers: wireBody ? {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(wireBody)} : {}});
    assert.equal(res.status, status);
    assert.equal(res.headers['x-private-upstream'], 'fixture');
    assert.deepEqual(JSON.parse(res.body), {upstream: target, status});
    assert.deepEqual(f.received.at(-1), {method, path: target, host: `localhost:${f.brainPort}`,
      contentType: wireBody ? 'application/json' : undefined, body: wireBody || ''});
  }
});

test('私有Brain端口不可达时两条真实HTTP代理均502，不能伪造成功或拖挂', async t => {
  const f = await fixture(t);
  await close(f.upstream);
  for (const [path, message] of [['/api/brain/tasks', 'Brain service unavailable'], ['/api/tasks/goals', 'API unavailable']]) {
    const res = await httpRequest(f.port, path);
    assert.equal(res.status, 502);
    assert.deepEqual(JSON.parse(res.body), {error: message});
  }
  assert.equal(f.child.exitCode, null);
});

test('真实WS升级保留head与双向字节，并改写握手path/Host/Origin', async t => {
  const f = await fixture(t);
  let handshake;
  let postHandshake = '';
  f.upstream.on('upgrade', (req, socket, head) => {
    handshake = {path: req.url, method: req.method, host: req.headers.host, origin: req.headers.origin, head: head.toString()};
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nUPSTREAM_BYTES');
    socket.on('data', data => { postHandshake += data; socket.write('ECHO:' + data); });
  });
  const client = net.createConnection({host: '127.0.0.1', port: f.port});
  t.after(() => client.destroy());
  await once(client, 'connect');
  const received = [];
  let sent = false;
  const complete = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('private WS timeout: ' + Buffer.concat(received))), 2000);
    client.on('error', reject);
    client.on('data', data => {
      received.push(data);
      const text = Buffer.concat(received).toString();
      if (text.includes('UPSTREAM_BYTES') && !sent) { sent = true; client.write('CLIENT_BYTES'); }
      if (text.includes('ECHO:CLIENT_BYTES')) { clearTimeout(timeout); resolve(text); }
    });
  });
  client.write('GET /api/brain/ws?private=1 HTTP/1.1\r\nHost: private-dashboard.invalid\r\nOrigin: https://private-dashboard.invalid\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nUPGRADE_HEAD');
  const text = await complete;
  assert.match(text, /^HTTP\/1.1 101/);
  assert.deepEqual(handshake, {path: '/ws?private=1', method: 'GET', host: `localhost:${f.brainPort}`,
    origin: `http://localhost:${f.port}`, head: 'UPGRADE_HEAD'});
  assert.equal(postHandshake, 'CLIENT_BYTES');
});

test('require真实CLI模块不监听两个本人已占端口，也不留下运行资源', async t => {
  const sentinel = net.createServer();
  const langfuse = net.createServer();
  const port = await listen(sentinel), other = await listen(langfuse);
  t.after(async () => { await close(sentinel); await close(langfuse); });
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(entry)});process.stdout.write('IMPORTED_WITHOUT_LISTEN')`], {
    env: {PATH: process.env.PATH, FRONTEND_PORT: String(port), LANGFUSE_PROXY_PORT: String(other)},
    encoding: 'utf8', timeout: 2000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'IMPORTED_WITHOUT_LISTEN');
});

test('原始URL路径越界必须拒绝，不能读取本人dist旁的私有文件', async t => {
  const f = await fixture(t);
  const res = await httpRequest(f.port, '/../outside.txt');
  assert.equal(res.status, 403, 'unexpected body: ' + res.body);
  assert.ok(!res.body.includes(Buffer.from(outside)));
});

test('查询字符串不能参与磁盘路径规范化并逃出dist', async t => {
  const f = await fixture(t);
  const res = await httpRequest(f.port, '/page?next=/../../outside.txt');
  assert.equal(res.status, 200);
  assert.equal(res.body.toString(), document);
});

test('缺index返回明确404且CLI存活，不能readstream异常崩溃或断开请求', async t => {
  const f = await fixture(t);
  await rm(join(f.dist, 'index.html'));
  const res = await httpRequest(f.port, '/not-a-file').catch(error => ({error: error.code || error.message}));
  assert.equal(res.status, 404, JSON.stringify(res) + '\nCLI: ' + f.output());
  assert.equal(f.child.exitCode, null, f.output());
});
