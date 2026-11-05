// 仅测试子进程使用：fetch与底层TCP/DNS共同封闭，任何非owned端点在发包前拒绝。
const fs = require('node:fs');
const net = require('node:net');
const dns = require('node:dns');
const origin = process.env.RELEASE_GATE_TEST_ORIGIN;
const allowed = origin ? new URL(origin) : null;
function deny(kind) {
  if (process.env.RELEASE_GATE_NETWORK_LOG) {
    fs.appendFileSync(process.env.RELEASE_GATE_NETWORK_LOG, JSON.stringify({ kind }) + '\n');
  }
  throw new Error('release_gate_test_network_denied');
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = function(input, options = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!allowed || url.origin !== allowed.origin || url.pathname !== '/api/brain/decisions'
      || url.search || (options.method || input.method || 'GET') !== 'POST') deny('fetch');
  return nativeFetch(input, options);
};
const nativeConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof first === 'object' && first !== null ? first : { port: first, host: args[1] };
  if (!allowed || options.path || options.host !== '127.0.0.1'
      || Number(options.port) !== Number(allowed.port)) deny('tcp');
  return nativeConnect.apply(this, args);
};
dns.lookup = function() { return deny('dns'); };
