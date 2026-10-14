import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareCodexSession } from '../lib/codex-session.mjs';

const SHA = 'a'.repeat(40);
const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/api/brain/health') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ git_sha: SHA })); }
    else if (req.url === '/redirect') { res.writeHead(302, { location: 'http://localhost:5221/api/brain/health' }); res.end(); }
    else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ method: req.method, path: req.url })); }
  });
  for (let port = 5380; port < 5400; port += 1) {
    const ok = await new Promise((resolve) => { server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => resolve(true)); });
    if (ok) break;
  }
  if (!server.address()) throw new Error('no free isolated preview fixture port');
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  return { server, hits, origin: `http://127.0.0.1:${server.address().port}` };
}
function request(socketPath, host, target = '/api/brain/check', method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: target, method, headers: { host } }, (res) => {
      let body = ''; res.on('data', (b) => { body += b; }); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }); req.on('error', reject); req.end();
  });
}
async function bridge(options = {}) {
  const f = await fixture();
  const { createPreviewBridge } = await import('../lib/preview-bridge.mjs');
  const b = await createPreviewBridge({ origin: f.origin, headSha: SHA, prNumber: 123, ...options });
  cleanup.push(() => b.close()); return { ...f, ...b };
}

describe('Codex preview capability 实际HTTP隔离', () => {
  it('真Unix请求只到已核SHA的固定预览，controller关闭时收割socket/curl配置', async () => {
    const b = await bridge(); const c = b.capability;
    const r = await request(c.socketPath, new URL(b.origin).host);
    expect(r.status).toBe(200); expect(JSON.parse(r.body).path).toBe('/api/brain/check');
    expect(b.hits).toContain('/api/brain/health');
    expect(fs.readFileSync(path.join(c.runtimeDir, '.curlrc'), 'utf8')).toContain(c.socketPath);
    await b.close(); expect(fs.existsSync(c.runtimeDir)).toBe(false);
  });
  it('Host换端口、绝对URL、双斜线、CONNECT和跨源redirect在桥上拒绝', async () => {
    const b = await bridge(); const host = new URL(b.origin).host;
    const count = b.hits.length;
    for (const [h, target, method] of [['localhost:5221', '/api/brain/check', 'GET'], [host, 'http://localhost:5221/api/brain/health', 'GET'], [host, '//localhost:5221/', 'GET'], [host, 'localhost:5221', 'CONNECT']]) {
      expect((await request(b.capability.socketPath, h, target, method)).status).toBe(403);
    }
    expect(b.hits.length).toBe(count);
    const redirect = await request(b.capability.socketPath, host, '/redirect');
    expect(redirect.status).toBe(502); expect(redirect.headers.location).toBeUndefined();
  });
  it('无效端口/生产origin/错SHA在授予能力之前拒绝', async () => {
    const { createPreviewBridge } = await import('../lib/preview-bridge.mjs');
    for (const origin of ['http://localhost:5221', 'http://localhost:5200', 'http://evil.example:5300', 'http://localhost:5300/a', 'http://user@localhost:5300']) {
      await expect(createPreviewBridge({ origin, headSha: SHA, prNumber: 123 })).rejects.toThrow(/preview/);
    }
    await expect(bridge({ headSha: 'b'.repeat(40) })).rejects.toThrow(/sha/);
  });
  it('伪造prompt或伪造capability不能获得网络；真能力强制proxy+空域白名单+单socket', async () => {
    const b = await bridge(); const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-profile-')); cleanup.push(() => fs.rmSync(cwd, { recursive: true, force: true }));
    fs.mkdirSync(path.join(cwd, '.git'));
    const args = ['-p', `PREVIEW_URL: ${b.origin}`, '--disallowedTools', 'Bash(git commit:*)'];
    expect(() => prepareCodexSession({ args, cwd })).toThrow();
    expect(() => prepareCodexSession({ args, cwd, nativeOptions: { previewCapability: { ...b.capability } } })).toThrow();
    const s = prepareCodexSession({ args, cwd, nativeOptions: { previewCapability: b.capability } });
    const text = s.args.join('\n');
    expect(text).toContain('network_proxy'); expect(text).toContain('"domains"={}');
    expect(text).toContain('"allow_local_binding"=false'); expect(text).toContain('"allow_upstream_proxy"=false');
    expect(text).toContain(`${JSON.stringify(b.capability.socketPath)}="allow"`);
    expect(text).toContain(`${JSON.stringify(b.capability.runtimeDir)}="read"`);
    expect(text).toContain(`${JSON.stringify(fs.realpathSync(path.join(cwd, '.git')))}="read"`);
    expect(s.env.CURL_HOME).toBe(b.capability.runtimeDir);
    await b.close(); expect(() => prepareCodexSession({ args, cwd, nativeOptions: { previewCapability: b.capability } })).toThrow();
  });
});

describe('native judge无工具权限和stdin', () => {
  it('裁判只收stdin合同；无shell、MCP、网络，工作区不可写', () => {
    const prompt = '独立裁判'.repeat(50000);
    const last = path.join(os.tmpdir(), 'judge-last.txt');
    const s = prepareCodexSession({ args: ['-p', prompt], cwd: os.tmpdir(), nativeOptions: { access: 'judge', outputLastMessage: last } });
    expect(s.stdin === prompt).toBe(true); expect(s.args.at(-1)).toBe('-'); expect(s.args.includes(prompt)).toBe(false);
    expect(s.args).toContain('--output-last-message'); expect(s.args).toContain(last);
    const text = s.args.join('\n');
    expect(text).toContain(':read-only'); expect(text).toContain('shell_tool'); expect(text).toContain('unified_exec');
    expect(text).toContain('"network"={"enabled"=false}'); expect(text).not.toContain('coding_files');
    expect(s.args).toContain('--skip-git-repo-check');
    expect(text).toContain(`${JSON.stringify(path.join(os.homedir(), '.credentials'))}="deny"`);
  });
});
