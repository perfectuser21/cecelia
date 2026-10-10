/**
 * Claude 无头通道下线 —— 进程入口层行为测试（任务 76a160b3）
 *
 * - cecelia-bridge.cjs / cecelia-bridge.js：/llm-call、/trigger-cecelia 一律 410 claude_channel_retired，
 *   不 spawn、不 exec；/health 与 notebook 端点不变
 * - packages/workflows/gateway（AI Gateway，无运行进程）：整个目录删除，deploy.sh 不再启动它
 * - server.js：不再自动拉起 cecelia-bridge
 * - cecelia-run.sh：任何动作前以 claude_channel_retired 退出
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const BRAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(BRAIN_ROOT, '../..');
const RETIRED = { ok: false, error: 'claude_channel_retired' };

/** 在 vm 沙箱里执行入口脚本，只替换系统边界：不监听端口、不起子进程。 */
function loadScript(file, env = {}) {
  let handler;
  const child = {
    spawn: vi.fn(() => { throw new Error('测试禁止启动子进程'); }),
    exec: vi.fn(), execSync: vi.fn(() => ''), execFile: vi.fn(), execFileSync: vi.fn(),
  };
  const fs = { mkdirSync: vi.fn(), writeFileSync: vi.fn(), unlinkSync: vi.fn(), accessSync: vi.fn(), constants: { X_OK: 1 } };
  const https = { request: vi.fn(() => ({ on: vi.fn(), write: vi.fn(), end: vi.fn() })) };
  const modules = {
    http: { createServer: (cb) => { handler = cb; return { listen: vi.fn(), close: vi.fn(), closeIdleConnections: vi.fn() }; } },
    https, fs, child_process: child,
  };
  const proc = new EventEmitter();
  proc.env = { HOME: '/fake', ...env };
  proc.exit = vi.fn();
  proc.kill = vi.fn();
  const cache = new Map();
  function evaluate(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const localRequire = (id) => {
      if (modules[id]) return modules[id];
      if (id.startsWith('.')) return evaluate(path.resolve(path.dirname(filename), id));
      return require(id);
    };
    vm.runInNewContext(readFileSync(filename, 'utf8'), {
      module, exports: module.exports, require: localRequire, process: proc, Buffer, Date, URL,
      console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      setTimeout, clearTimeout, setInterval, clearInterval,
    }, { filename });
    return module.exports;
  }
  evaluate(file);
  function request(url, payload = {}, method = 'POST') {
    const req = new EventEmitter();
    Object.assign(req, { method, url, aborted: false, headers: { host: 'localhost' } });
    const res = new EventEmitter();
    Object.assign(res, { writableEnded: false, headersSent: false, destroyed: false });
    res.setHeader = vi.fn();
    res.writeHead = vi.fn((status) => { res.statusCode = status; res.headersSent = true; });
    res.end = vi.fn((body) => {
      res.body = body ? JSON.parse(body) : undefined;
      res.writableEnded = true;
    });
    handler(req, res);
    req.emit('data', JSON.stringify(payload));
    req.emit('end');
    return res;
  }
  return { request, child, fs, https };
}

const flush = () => new Promise((r) => setImmediate(r));

describe.each(['cecelia-bridge.cjs', 'cecelia-bridge.js'])('%s：claude 端点下线', (entry) => {
  const file = path.join(BRAIN_ROOT, 'scripts', entry);

  it('/llm-call 返回 410 claude_channel_retired，不启动任何进程', () => {
    const b = loadScript(file, { CLAUDE_BIN: '/fake/claude' });
    const res = b.request('/llm-call', { prompt: '测试', model: 'haiku', image_base64: 'AAAA' });
    expect(res.statusCode).toBe(410);
    expect(res.body).toEqual(RETIRED);
    expect(b.child.spawn).not.toHaveBeenCalled();
    expect(b.fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('/trigger-cecelia 返回 410 claude_channel_retired，不写 prompt、不执行 cecelia-run', () => {
    const b = loadScript(file);
    const res = b.request('/trigger-cecelia', { task_id: 't1', checkpoint_id: 'c1', prompt: 'p' });
    expect(res.statusCode).toBe(410);
    expect(res.body).toEqual(RETIRED);
    expect(b.child.exec).not.toHaveBeenCalled();
    expect(b.child.execSync).not.toHaveBeenCalled();
    expect(b.fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('/health 仍 200（外部探活不报错）', () => {
    const b = loadScript(file);
    const res = b.request('/health', {}, 'GET');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it('/notebook/query 仍调用 notebooklm CLI（与 claude 无关的端点不变）', () => {
    const b = loadScript(file, { NOTEBOOKLM_BIN: '/fake/notebooklm' });
    b.request('/notebook/query', { query: '问题' });
    expect(b.child.execFile).toHaveBeenCalledWith('/fake/notebooklm', ['ask', '问题'], expect.any(Object), expect.any(Function));
  });
});

describe('AI Gateway：已删除', () => {
  it('packages/workflows/gateway 不存在，deploy.sh 不再同步/启动 ai-gateway', () => {
    expect(existsSync(path.join(REPO_ROOT, 'packages/workflows/gateway'))).toBe(false);
    const deploy = readFileSync(path.join(REPO_ROOT, 'packages/workflows/deploy/deploy.sh'), 'utf8');
    expect(deploy).not.toMatch(/ai-gateway|\/gateway\//);
  });
});

describe('server.js：不再自动拉起 cecelia-bridge', () => {
  it('源码不含 startCeceliaBridge，也不再 spawn cecelia-bridge 脚本', () => {
    const src = readFileSync(path.join(BRAIN_ROOT, 'server.js'), 'utf8');
    expect(src).not.toMatch(/startCeceliaBridge/);
    expect(src).not.toMatch(/cecelia-bridge\.(c?js)/);
  });
});

describe('cecelia-run.sh：claude 执行器下线', () => {
  const script = path.join(BRAIN_ROOT, 'scripts/cecelia-run.sh');

  it('退役闸位于参数校验与一切副作用之前', () => {
    const src = readFileSync(script, 'utf8');
    const guard = src.indexOf('claude_channel_retired');
    expect(guard).toBeGreaterThan(-1);
    for (const marker of ['mkdir -p "$(dirname "$LOG_FILE")"', 'TASK_ID="${1:?', 'mkdir -p "$LOCK_DIR"', 'send_webhook "', 'setsid bash -c']) {
      const at = src.indexOf(marker);
      if (at > -1) expect(guard).toBeLessThan(at);
    }
  });

  it('真实执行：以非零码退出并报 claude_channel_retired，不建锁目录', () => {
    const src = readFileSync(script, 'utf8');
    if (!src.includes('claude_channel_retired')) throw new Error('退役闸缺失，拒绝执行旧脚本（它会回调生产 Brain）');
    const sandbox = mkdtempSync(path.join(os.tmpdir(), 'cecelia-run-retired-'));
    try {
      const promptFile = path.join(sandbox, 'p.prompt');
      writeFileSync(promptFile, 'prompt');
      const lockDir = path.join(sandbox, 'locks');
      const r = spawnSync('/bin/bash', [script, 'task-1', 'cp-1', promptFile], {
        encoding: 'utf8', timeout: 15000,
        env: { PATH: process.env.PATH, HOME: sandbox, LOCK_DIR: lockDir },
      });
      expect(r.status).not.toBe(0);
      expect(r.stdout + r.stderr).toContain('claude_channel_retired');
      expect(readdirSync(sandbox)).toEqual(['p.prompt']);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
