// Controller-owned Unix HTTP bridge. The model never chooses its upstream.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { productionMatchers } from './qa-report.mjs';

const active = new WeakSet();
const LIMIT = 8 * 1024 * 1024;
const HOP = new Set(['connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'host']);
const headers = (source) => Object.fromEntries(Object.entries(source).filter(([k]) => !HOP.has(k.toLowerCase()) && !k.toLowerCase().startsWith('x-forwarded-')));

export function previewCapability(value) {
  if (!value || !active.has(value)) throw new Error('codex_preview_capability_invalid');
  return value;
}

function originOf(origin, production) {
  let u;
  try { u = new URL(origin); } catch { throw new Error('preview_origin_invalid'); }
  if (u.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(u.hostname)
    || !/^53\d\d$/.test(u.port) || u.username || u.password || u.pathname !== '/' || u.search || u.hash
    || productionMatchers(production).target.test(u.origin)) throw new Error('preview_origin_invalid');
  return u;
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    stream.on('data', (chunk) => { size += chunk.length; if (size > LIMIT) { reject(new Error('preview_body_limit')); stream.destroy(); } else chunks.push(chunk); });
    stream.on('error', reject); stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/** No proxy env, automatic redirect, cookie jar, or inherited authorization. */
function upstream(origin, target, options, pending, ensureActive) {
  return new Promise((resolve, reject) => {
    ensureActive();
    const req = http.request({ hostname: origin.hostname, port: origin.port, path: target, agent: false,
      method: options.method ?? 'GET', headers: { ...headers(options.headers ?? {}), host: origin.host, connection: 'close' }, timeout: 10000 }, async (res) => {
      try { const body = await collect(res); ensureActive(); resolve({ status: res.statusCode, headers: res.headers, body }); } catch (e) { reject(e); }
    });
    pending.add(req); req.on('close', () => pending.delete(req));
    req.on('timeout', () => req.destroy(new Error('preview_upstream_timeout'))); req.on('error', reject);
    req.end(options.body);
  });
}

export async function createPreviewBridge({ origin, headSha, prNumber, production = null }) {
  const target = originOf(origin, production);
  if (!/^[a-f0-9]{40}$/.test(headSha ?? '') || !Number.isSafeInteger(prNumber) || prNumber <= 0) throw new Error('preview_identity_invalid');
  const pending = new Set();
  let closed = false; let invalidated = null; let capability;
  const ensureActive = () => {
    if (closed) throw new Error('preview_bridge_closed');
    if (invalidated) throw new Error(invalidated);
  };
  const verifySha = async () => {
    ensureActive();
    const r = await upstream(target, '/api/brain/health', {}, pending, ensureActive);
    ensureActive();
    let body; try { body = JSON.parse(r.body); } catch { /* rejected below */ }
    if (r.status !== 200 || body?.git_sha !== headSha) {
      invalidated = 'preview_sha_mismatch'; if (capability) active.delete(capability);
      throw new Error(invalidated);
    }
  };
  await verifySha();
  const runtimeDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-preview-')));
  const socketPath = path.join(runtimeDir, 'bridge.sock');
  // CURL_HOME keeps report commands portable; CI/preflight use those exact commands without this transport config.
  fs.writeFileSync(path.join(runtimeDir, '.curlrc'), `unix-socket = "${socketPath.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"\nproxy = ""\nnoproxy = "*"\n`, { mode: 0o400 });
  capability = Object.freeze({ runtimeDir, socketPath, origin: target.origin, headSha, prNumber });
  const sockets = new Set(); const requests = [];
  const server = http.createServer(async (req, res) => {
    const deny = (status, reason) => { if (!res.headersSent) res.writeHead(status, { 'content-type': 'text/plain', connection: 'close' }); res.end(reason); };
    if (closed || req.headers.host !== target.host || !req.url.startsWith('/') || req.url.startsWith('//')
      || /[\\\x00-\x20]/.test(req.url) || req.headers.upgrade || req.method === 'CONNECT') return deny(403, 'preview_bridge_forbidden');
    try {
      const body = await collect(req); ensureActive();
      await verifySha(); ensureActive();
      const r = await upstream(target, req.url, { method: req.method, headers: req.headers, body }, pending, ensureActive);
      ensureActive();
      // The deployment may switch after the first health check; never release that response as the old head.
      await verifySha(); ensureActive();
      if (r.headers.location) {
        const location = new URL(r.headers.location, target.origin);
        if (location.origin !== target.origin || location.username || location.password) return deny(502, 'preview_redirect_forbidden');
      }
      if (requests.length < 1000) requests.push({ method: req.method, path: req.url, status: r.status, sha: headSha });
      res.writeHead(r.status, { ...headers(r.headers), 'content-length': r.body.length, connection: 'close' }); res.end(r.body);
    } catch (error) { deny(502, error.message.startsWith('preview_') ? error.message : 'preview_upstream_failed'); }
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('connect', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));
  server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));
  const close = async () => {
    if (closed) return;
    closed = true; active.delete(capability);
    for (const req of pending) req.destroy(); for (const socket of sockets) socket.destroy();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    fs.chmodSync(socketPath, 0o600); active.add(capability);
  } catch (e) { await close(); throw e; }
  return { capability, close, requests, verify: verifySha, get invalidated() { return invalidated; } };
}
