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
test('只有MMV代理挂清理模块；生产writer两条npm与reaper均不能旁路裸删', async () => {
  const agent = await readFile(new URL('./preview-agent.mjs', import.meta.url), 'utf8');
  assert.match(agent, /createCacheRouter/);
  const us = await readFile(new URL('../packages/brain/src/routes/preview.js', import.meta.url), 'utf8');
  assert.doesNotMatch(us, /preview-cache|createCacheRouter/);
  const start = await readFile(new URL('./preview-env-start.sh', import.meta.url), 'utf8');
  assert.match(start, /preview-cache\/writer\.mjs.*frontend/);
  assert.match(start, /preview-cache\/writer\.mjs.*brain/);
  assert.doesNotMatch(start, /npm ci --cache/);
  const reaper = await readFile(new URL('./preview-reaper.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(reaper, /rm -rf -- "\$NPM_CACHE_DIR"/);
});
