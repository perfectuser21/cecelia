import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prepareCodexSession } from '../lib/codex-session.mjs';
import { runActivityProcess } from './helpers/run-activity.mjs';
import { gitPlain } from './helpers/git.mjs';
import { FAKE_CLAUDE_EVAL } from './fixtures/fake-claude-eval.mjs';

const SHA = 'a'.repeat(40);
const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const hits = [];
  const state = { sha: SHA, driftAfterBusiness: false };
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/api/brain/health') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ git_sha: state.sha })); }
    else if (req.url === '/redirect') { res.writeHead(302, { location: 'http://localhost:5221/api/brain/health' }); res.end(); }
    else { if (state.driftAfterBusiness) state.sha = 'b'.repeat(40); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ method: req.method, path: req.url })); }
  });
  for (let port = 5380; port < 5400; port += 1) {
    const ok = await new Promise((resolve) => { server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => resolve(true)); });
    if (ok) break;
  }
  if (!server.address()) throw new Error('no free isolated preview fixture port');
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  return { server, hits, state, origin: `http://127.0.0.1:${server.address().port}` };
}
function request(socketPath, host, target = '/api/brain/check', method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: target, method, headers: { host } }, (res) => {
      let body = ''; res.on('data', (b) => { body += b; }); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }); req.on('connect', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode, headers: res.headers }); }); req.on('error', reject); req.end();
  });
}
async function bridge(options = {}) {
  const f = await fixture();
  const { createPreviewBridge } = await import('../lib/preview-bridge.mjs');
  const b = await createPreviewBridge({ origin: f.origin, headSha: SHA, prNumber: 123, ...options });
  cleanup.push(() => b.close()); return Object.assign(b, f);
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
  it('预览SHA运行中漂移则每次请求重新核验并拒绝，不向业务API发送请求', async () => {
    const b = await bridge();
    b.state.sha = 'b'.repeat(40);
    const r = await request(b.capability.socketPath, new URL(b.origin).host);
    expect(r.status).toBe(502); expect(r.body).toBe('preview_sha_mismatch');
    expect(b.hits).not.toContain('/api/brain/check');
  });
  it('health核对后业务响应期间切换head，响应不交付且整轮sticky失效', async () => {
    const b = await bridge(); b.state.driftAfterBusiness = true;
    const r = await request(b.capability.socketPath, new URL(b.origin).host);
    expect(r.status).toBe(502); expect(r.body).toBe('preview_sha_mismatch');
    b.state.sha = SHA; b.state.driftAfterBusiness = false;
    await expect(b.verify()).rejects.toThrow('preview_sha_mismatch');
    expect(b.invalidated).toBe('preview_sha_mismatch');
  });
  it('会话结束控制器独立核SHA，close后不能重新向上游发health或业务请求', async () => {
    const b = await bridge();
    await expect(b.verify()).resolves.toBeUndefined();
    b.state.sha = 'b'.repeat(40);
    await expect(b.verify()).rejects.toThrow('preview_sha_mismatch');
    await b.close(); const count = b.hits.length;
    await expect(b.verify()).rejects.toThrow(/preview/);
    expect(b.hits.length).toBe(count);
  });
  it('health响应完成与close竞争时不在收割后新发业务请求', async () => {
    const b = await bridge(); const original = http.request.bind(http);
    let closed; const closing = new Promise((resolve) => { closed = resolve; });
    const spy = vi.spyOn(http, 'request').mockImplementation((options, callback) => original(options, (res) => {
      callback(res);
      if (options.path === '/api/brain/health') res.once('end', () => queueMicrotask(async () => { await b.close(); closed(); }));
    }));
    cleanup.push(() => spy.mockRestore());
    const response = request(b.capability.socketPath, new URL(b.origin).host).catch((e) => e.code);
    await closing; await response;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(b.hits).not.toContain('/api/brain/check');
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
    expect(s.env.CODING_WF_PREVIEW_BROWSER_HELPER).toBe(b.capability.browserHelperPath);
    expect(fs.existsSync(b.capability.browserHelperPath)).toBe(true);
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

it.each([false, true])('真实evaluate进程预览桥与sticky漂移门（drift=%s），finally收割', async (drift) => {
  const f = await fixture(); f.state.driftAfterBusiness = drift;
  const api = http.createServer((_req, res) => res.end(JSON.stringify({ status: 'active', port: new URL(f.origin).port })));
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve)); cleanup.push(() => new Promise((resolve) => api.close(resolve)));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluate-bridge-')); cleanup.push(() => fs.rmSync(cwd, { recursive: true, force: true }));
  gitPlain('init', '-q', cwd);
  const dir = path.join(cwd, 'sprints/s1'); fs.mkdirSync(dir, { recursive: true });
  const id = '11111111-2222-3333-4444-555555555555';
  const intent = `---\ntask_id: ${id}\nstep: intent\nupstream: []\n---\n### I-1\n查API\n`;
  fs.writeFileSync(path.join(dir, '01-intent.md'), intent);
  fs.writeFileSync(path.join(dir, '02-spec.md'), `---\ntask_id: ${id}\nstep: spec\nupstream: ["01-intent.md#I-1"]\n---\n## QA 场景\n### Q-1\n对应: I-1\n操作: 查询API\n期望: 200\n`);
  for (const name of ['03-build.md', '04-evidence.md']) fs.writeFileSync(path.join(dir, name), 'hidden');
  const fixturePath = FAKE_CLAUDE_EVAL; fs.chmodSync(fixturePath, 0o755);
  const r = await runActivityProcess(fileURLToPath(new URL('../activities/evaluate.mjs', import.meta.url)), {
    run_tag: 'rt', task_id: id, worktree: cwd, sprint_dir: 'sprints/s1', intent_ids: ['I-1'],
    intent_sha256: crypto.createHash('sha256').update(intent).digest('hex'), pr_number: 123, head_sha: SHA,
  }, { CODING_WF_PROVIDER: 'codex', CODING_WF_CODEX_BIN: fixturePath, CODING_WF_CODEX_MODEL: 'gpt-6-sol', FAKE_EVAL_MODE: 'bridge', FAKE_EVAL_NATIVE: 'codex',
    CODING_WF_PREVIEW_API: `http://127.0.0.1:${api.address().port}`, CODING_WF_PREVIEW_HOST: '127.0.0.1' });
  if (drift) {
    expect(r.result?.status, r.stderr).toBe('failed'); expect(r.result.reason_code).toBe('preview_stale');
    const home = r.stderr.match(/FAKE_CURL_HOME: (.+)/)?.[1]; expect(fs.existsSync(home)).toBe(false);
    expect(fs.existsSync(path.join(dir, '03-build.md'))).toBe(true); return;
  }
  expect(r.result?.status, r.stderr).toBe('completed');
  expect(r.result.outputs.qa).toMatchObject({ provider: 'codex', model: 'gpt-6-sol' });
  expect(r.result.outputs.qa.env).toMatchObject({ kind: 'preview', url: f.origin, sha: SHA, transport: 'unix_http_browser' });
  expect(f.hits).toContain('/api/brain/check?q=Q-1');
  const home = r.stderr.match(/FAKE_CURL_HOME: (.+)/)?.[1]; expect(home).toBeTruthy(); expect(fs.existsSync(home)).toBe(false);
  expect(r.stderr).toContain('FAKE_HIDDEN_BUILD: true'); expect(fs.existsSync(path.join(dir, '03-build.md'))).toBe(true);
});
