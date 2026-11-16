#!/usr/bin/env bash
# 执行真实ESM入口，仅链接外部依赖替身，不启动HTTP/采样进程或读取凭据。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
export FIXTURE_REPO="$ROOT"
node --experimental-vm-modules --input-type=module <<'JS'
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
const entry = path.join(process.env.FIXTURE_REPO, 'scripts/preview-agent.mjs');
const source = readFileSync(entry, 'utf8');
async function run(token) {
 const events = [], routes = [], intervals = [];
 const app = {
  use: (...args) => routes.push(args),
  get: (...args) => routes.push(args),
  listen: (port, host, callback) => { events.push(['listen', port, host]); callback(); },
 };
 const express = Object.assign(() => app, {json: () => 'json-parser'});
 const route = Symbol('real-route-boundary');
 const env = {};
 const context = vm.createContext({
  process: {env, exit: code => { events.push(['exit', code]); throw Error('isolated-exit'); }},
  console: {log(){}, warn(){}, error(){}},
  setInterval: (callback, ms) => { intervals.push([callback, ms]); return {unref(){}}; },
 });
 const bindings = {
  express: {default: express},
  'node:child_process': {execFile: (...args) => events.push(['execFile', ...args.slice(0, 3)])},
  'node:path': {dirname: path.dirname, join: path.join},
  'node:url': {fileURLToPath},
  '../packages/brain/src/routes/preview.js': {default: route},
  './preview-cache/router.mjs': {createCacheRouter: () => 'cache-router'},
  './preview-agent/deploy-token.mjs': {
   loadDeployToken: () => ({token}), describeTokenSource: () => 'isolated-fixture', resolveReleaseSha: () => 'a'.repeat(40),
  },
 };
 const mod = new vm.SourceTextModule(source, {context, initializeImportMeta: meta => {meta.url = pathToFileURL(entry).href;}});
 await mod.link(specifier => {
  assert.ok(Object.hasOwn(bindings, specifier), `未隔离依赖: ${specifier}`);
  const values = bindings[specifier];
  return new vm.SyntheticModule(Object.keys(values), function() {
   for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, {context});
 });
 if (!token) await assert.rejects(mod.evaluate(), /isolated-exit/); else await mod.evaluate();
 return {events, routes, intervals, env, route};
}
const denied = await run(null);
assert.deepEqual(denied.events, [['exit', 1]]);
assert.equal(denied.intervals.length, 0);
const allowed = await run('synthetic-fixture-token');
assert.deepEqual(allowed.events.find(e => e[0] === 'listen'), ['listen', 5241, '127.0.0.1']);
assert.equal(allowed.env.DEPLOY_TOKEN, 'synthetic-fixture-token');
assert.ok(allowed.routes.some(([url, handler]) => url === '/api/brain/preview' && handler === allowed.route));
assert.equal(allowed.intervals.length, 1);
assert.equal(allowed.intervals[0][1], 60_000);
allowed.intervals[0][0]();
assert.equal(allowed.events.filter(e => e[0] === 'execFile').length, 2);
assert.ok(allowed.events.filter(e => e[0] === 'execFile').every(e => e[1] === 'bash' && e[2][0].endsWith('/host-disk-sampler.sh')));
console.log('预览代理：空令牌启动拒绝、默认回环监听、鉴权变量接线、周期采样，通过');
JS
