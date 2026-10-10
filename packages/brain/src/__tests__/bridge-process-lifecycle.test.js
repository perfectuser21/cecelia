import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const scriptDir = fileURLToPath(new URL('../../scripts/', import.meta.url));

// 执行真正的入口，只替换系统边界，禁止启动Claude/HTTP或读取凭据。
function loadBridge(entry, env = {}) {
  let handler;
  const children = [], groups = new Set();
  const fs = { mkdirSync: vi.fn(), writeFileSync: vi.fn(), unlinkSync: vi.fn(), accessSync: vi.fn(), constants: { X_OK: 1 } };
  const server = { listen: vi.fn(), close: vi.fn((cb) => cb?.()), closeIdleConnections: vi.fn() };
  const proc = new EventEmitter();
  proc.env = { HOME: '/fake', CLAUDE_BIN: '/fake/claude', ...env };
  proc.exit = vi.fn();
  proc.kill = vi.fn((pid) => {
    if (!groups.has(-pid)) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    return true;
  });
  const spawn = vi.fn(() => {
    const child = new EventEmitter();
    Object.assign(child, { pid: 1000 + children.length, stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, signalCode: null, kill: vi.fn() });
    children.push(child); groups.add(child.pid);
    return child;
  });
  const execSync = vi.fn(() => '');
  const modules = { http: { createServer: (cb) => { handler = cb; return server; } }, fs, child_process: { spawn, execSync, exec: vi.fn(), execFile: vi.fn() } };
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const cache = new Map();
  function evaluate(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const localRequire = (id) => {
      if (modules[id]) return modules[id];
      if (id.startsWith('.')) return evaluate(path.resolve(path.dirname(filename), id));
      return require(id);
    };
    vm.runInNewContext(readFileSync(filename, 'utf8'), {
      module, exports: module.exports, require: localRequire, process: proc, Buffer, Date,
      console: logger, setTimeout, clearTimeout, setInterval, clearInterval,
    }, { filename });
    return module.exports;
  }
  evaluate(path.join(scriptDir, entry));
  function request(payload = {}, url = '/llm-call') {
    const req = new EventEmitter(); Object.assign(req, { method: 'POST', url, aborted: false });
    const res = new EventEmitter(); Object.assign(res, { writableEnded: false, headersSent: false, destroyed: false });
    res.writeHead = vi.fn((status) => { res.statusCode = status; res.headersSent = true; });
    res.end = vi.fn((body) => { res.body = JSON.parse(body); res.writableEnded = true; res.emit('close'); });
    handler(req, res); req.emit('data', JSON.stringify({ prompt: '测试', ...payload })); req.emit('end');
    return { req, res };
  }
  return { request, children, spawn, execSync, handler };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

// 原「进程生命周期」用例组（并发槽/超时/进程组 KILL/输出上限/信号回收等，测的是 /llm-call 拉起 claude -p）
// 已随 Claude 通道退役删除（任务 76a160b3）；bridge-lifecycle.cjs 模块本身仍由下方真实 OS 进程组验收覆盖。
for (const entry of ['cecelia-bridge.cjs', 'cecelia-bridge.js']) {
  describe(`${entry} Claude 通道退役`, () => {
    it.each(['/llm-call', '/trigger-cecelia'])('%s 一律 410 claude_channel_retired，不创建任何进程', (url) => {
      const b = loadBridge(entry);
      const { res } = b.request({ task_id: 't', checkpoint_id: 'c', model: 'sonnet' }, url);
      expect(res.statusCode).toBe(410);
      expect(res.body).toEqual({ ok: false, error: 'claude_channel_retired' });
      expect(b.spawn).not.toHaveBeenCalled();
      expect(b.execSync).not.toHaveBeenCalled();
      expect(b.children).toHaveLength(0);
    });
    it('重复请求不受并发上限影响，始终 410（无槽位概念）', () => {
      const b = loadBridge(entry, { CECELIA_BRIDGE_MAX_CONCURRENT: '1' });
      for (let i = 0; i < 3; i++) expect(b.request().res.statusCode).toBe(410);
      expect(b.spawn).not.toHaveBeenCalled();
    });
    it('/health 仍返回 200 healthy', () => {
      const b = loadBridge(entry);
      const req = new EventEmitter(); Object.assign(req, { method: 'GET', url: '/health' });
      const res = new EventEmitter();
      res.writeHead = vi.fn((status) => { res.statusCode = status; });
      res.end = vi.fn((body) => { res.body = JSON.parse(body); });
      b.handler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ ok: true, status: 'healthy' });
    });
  });
}
describe('入口功能保留与部署依赖', () => {
  // 原「cjs图片清理/Read工具」「旧js任务触发保留GOAL_SETTINGS」用例已随 Claude 通道退役删除（任务 76a160b3）。
  it('部署js入口时同步生命周期模块至bin/lib', () => {
    const deploy = readFileSync(path.resolve(scriptDir, '../../../scripts/brain-deploy.sh'), 'utf8');
    const begin = deploy.indexOf('    BRIDGE_SRC=');
    const end = deploy.indexOf('      # 重启 bridge', begin);
    const destination = mkdtempSync(path.resolve(scriptDir, '../src/__tests__/.bridge-deploy-'));
    try {
      // 只执行受限复制段，不执行真实部署、迁移或服务重启。
      execFileSync('/bin/bash', ['-eu', '-c', deploy.slice(begin, end) + '\nfi'], {
        env: { ...process.env, ROOT_DIR: path.resolve(scriptDir, '../../..'), HOST_HOME: destination, VERSION: 'fixture' },
      });
      const installed = path.join(destination, 'bin/cecelia-bridge.js');
      expect(readFileSync(path.join(destination, 'bin/lib/bridge-lifecycle.cjs'), 'utf8'))
        .toBe(readFileSync(path.join(scriptDir, 'lib/bridge-lifecycle.cjs'), 'utf8'));
      const b = loadBridge(path.relative(scriptDir, installed));
      const retired = b.request();
      expect(retired.res.statusCode).toBe(410);
      expect(retired.res.body).toEqual({ ok: false, error: 'claude_channel_retired' });
      expect(b.spawn).not.toHaveBeenCalled();
      // 内容一致时应完全避免cp；macOS的同文件cp会返回非零。
      const unchanged = spawnSync('/bin/bash', ['-eu', '-c',
        'cp() { echo unexpected-copy >&2; return 1; }\n' + deploy.slice(begin, end) + '\nfi'], {
        encoding: 'utf8',
        env: { ...process.env, ROOT_DIR: path.resolve(scriptDir, '../../..'), HOST_HOME: destination, VERSION: 'fixture' },
      });
      expect(unchanged.status).toBe(0);
      expect(unchanged.stdout + unchanged.stderr).not.toContain('unexpected-copy');
    } finally { rmSync(destination, { recursive: true, force: true }); }
  });
  it.each(['bridge-lifecycle.cjs', 'cecelia-bridge.js'])('部署复制%s失败必须退出并留下失败状态', (failedFile) => {
    const deploy = readFileSync(path.resolve(scriptDir, '../../../scripts/brain-deploy.sh'), 'utf8');
    const begin = deploy.indexOf('    BRIDGE_SRC=');
    const end = deploy.indexOf('      # 重启 bridge', begin);
    const destination = mkdtempSync(path.resolve(scriptDir, '../src/__tests__/.bridge-deploy-'));
    try {
      const script = `DEPLOY_SUCCESS=true
trap 'printf "deploy-success=%s\\n" "$DEPLOY_SUCCESS"' EXIT
cp() {
  case "$1" in
    */"$FAIL_COPY") echo simulated-copy-failure >&2; return 1 ;;
    *) command cp "$@" ;;
  esac
}
` + deploy.slice(begin, end) + '\nfi';
      const result = spawnSync('/bin/bash', ['-eu', '-c', script], {
        encoding: 'utf8',
        env: { ...process.env, ROOT_DIR: path.resolve(scriptDir, '../../..'), HOST_HOME: destination, VERSION: 'fixture', FAIL_COPY: failedFile },
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain('deploy-success=false');
      expect(result.stdout).not.toContain('  Updated ');
    } finally { rmSync(destination, { recursive: true, force: true }); }
  });
});

describe('真实OS进程组验收（仅受控Node，无Claude/网络）', () => {
  it('leader退出后，忽略TERM的孙进程仍在5秒后被组KILL回收', async () => {
    vi.useRealTimers();
    const { createBridgeLifecycle } = require('../../scripts/lib/bridge-lifecycle.cjs');
    const lifecycle = createBridgeLifecycle();
    const req = new EventEmitter();
    const res = new EventEmitter();
    let resolveReply;
    const reply = new Promise((resolve) => { resolveReply = resolve; });
    res.writeHead = () => { res.headersSent = true; };
    res.end = (body) => { res.writableEnded = true; resolveReply(JSON.parse(body)); res.emit('close'); };
    let resolveCleanup;
    const cleaned = new Promise((resolve) => { resolveCleanup = resolve; });
    const grandchild = "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000); setTimeout(()=>process.exit(0),12000)";
    const leader = `const {spawn}=require('child_process');
      const child=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore','pipe','ignore']});
      child.stdout.once('data',()=>process.stdout.write(JSON.stringify({leader:process.pid,grandchild:child.pid}),()=>process.exit(0)));
      setTimeout(()=>process.exit(1),10000);`;
    let group;
    try {
      lifecycle.run(req, res, {
        command: process.execPath, args: ['-e', leader], timeout: 15000, model: 'fixture',
        options: { stdio: ['ignore', 'pipe', 'pipe'] }, cleanup: resolveCleanup,
      });
      const response = await reply;
      expect(response.ok).toBe(true);
      group = JSON.parse(response.text);
      expect(() => process.kill(group.grandchild, 0)).not.toThrow();
      expect(() => process.kill(-group.leader, 0)).not.toThrow();
      await cleaned;
      expect(() => process.kill(group.grandchild, 0)).toThrow();
      expect(() => process.kill(-group.leader, 0)).toThrow();
    } finally {
      if (group) {
        try { process.kill(-group.leader, 'SIGKILL'); } catch { /* 已完成回收 */ }
      }
    }
  }, 20000);
});
