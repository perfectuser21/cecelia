import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFile } from 'node:fs/promises';
const module = await import('./preview-cache/router.mjs').catch(() => ({}));
test('强Bearer鉴权覆盖plan/execute/receipt，缺服务token全部拒绝且不触达服务', async t => {
  assert.equal(typeof module.createCacheRouter, 'function', '缺少独立强鉴权cache路由');
  for (const token of ['', 'fixture-secret']) {
    let calls = 0;
    const service = Object.fromEntries(['plan', 'execute', 'receipt'].map(k => [k, async () => { calls++; return { status: 'fixture' }; }]));
    const app = express(); app.use(express.json()); app.use('/cache', module.createCacheRouter({ token, service }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}/cache`;
    for (const path of ['/plan', '/execute', '/receipts/abc']) {
      for (const auth of ['', 'Basic fixture-secret', 'Bearer bad']) {
        const response = await fetch(base + path, { method: path.startsWith('/receipts') ? 'GET' : 'POST', headers: { authorization: auth } });
        assert.equal(response.status, 401);
      }
    }
    assert.equal(calls, 0);
    const response = await fetch(base + '/plan', { method: 'POST', headers: { authorization: 'Bearer fixture-secret' } });
    assert.equal(response.status, token ? 200 : 401);
  }
});
test('只有MMV代理挂清理模块；reaper不能旁路裸删', async () => {
  const agent = await readFile(new URL('./preview-agent.mjs', import.meta.url), 'utf8');
  assert.match(agent, /createCacheRouter/);
  const us = await readFile(new URL('../packages/brain/src/routes/preview.js', import.meta.url), 'utf8');
  assert.doesNotMatch(us, /preview-cache|createCacheRouter/);
  const reaper = await readFile(new URL('./preview-reaper.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(reaper, /rm -rf -- "\$NPM_CACHE_DIR"/);
});

test('保留的cache HTTP三分支使用正确Bearer传递原请求，并诚实返回服务错误', async t => {
  const calls = [];
  let failed = false;
  const service = Object.fromEntries(['plan', 'execute', 'receipt'].map(name => [name, async input => {
    calls.push({name, input});
    if (failed) throw Object.assign(new Error('owned failure'), {status: 409, code: 'OWNED_CONFLICT'});
    return {status: 'owned-' + name};
  }]));
  const app = express().use(express.json()).use('/cache', module.createCacheRouter({token: 'fixture-secret', service}));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/cache`;
  for (const name of ['plan', 'execute', 'receipt']) {
    const input = name === 'receipt' ? 'owned-intent' : {policy: 'owned', intent_id: name};
    const path = name === 'receipt' ? '/receipts/' + input : '/' + name;
    const options = {method: name === 'receipt' ? 'GET' : 'POST',
      headers: {authorization: 'Bearer fixture-secret', 'content-type': 'application/json'},
      ...(name === 'receipt' ? {} : {body: JSON.stringify(input)})};
    failed = false;
    const response = await fetch(base + path, options);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), {status: 'owned-' + name});
    assert.deepEqual(calls.at(-1), {name, input});
    failed = true;
    const failure = await fetch(base + path, options);
    assert.equal(failure.status, 409); assert.deepEqual(await failure.json(), {error: 'OWNED_CONFLICT'});
  }
  assert.equal(calls.length, 6);
});
