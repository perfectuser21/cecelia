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
  function finish(child, code = 0) {
    groups.delete(child.pid); child.exitCode = code; child.emit('exit', code); child.emit('close', code);
  }
  return { request, children, spawn, proc, groups, finish, fs, server, execSync, logger };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

for (const entry of ['cecelia-bridge.cjs', 'cecelia-bridge.js']) {
  describe(`${entry} 进程生命周期`, () => {
    it('默认并发2，第三次请求立即拒绝且不创建进程', () => {
      const b = loadBridge(entry); b.request(); b.request();
      expect(b.request().res.statusCode).toBe(503);
      expect(b.children).toHaveLength(2);
      expect(b.spawn.mock.calls[0][2].detached).toBe(true);
    });
    it.each([['1', 1], ['99', 4], ['Infinity', 2], ['invalid', 2], ['-3', 2], ['0', 2]])('并发配置%s安全归一化为%s', (value, count) => {
      const b = loadBridge(entry, { CECELIA_BRIDGE_MAX_CONCURRENT: value });
      for (let i = 0; i < count; i++) b.request();
      expect(b.request().res.statusCode).toBe(503);
      expect(b.children).toHaveLength(count);
    });
    it('超时立即回复，TERM后5秒KILL整组，组消失前保持槽位', () => {
      const b = loadBridge(entry, { CECELIA_BRIDGE_MAX_CONCURRENT: '1' });
      const { res } = b.request({ timeout: 100 }); const child = b.children[0];
      vi.advanceTimersByTime(100);
      expect(res.body).toMatchObject({ ok: false, status: 'timeout', degraded: true });
      expect(b.proc.kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM');
      expect(b.request().res.statusCode).toBe(503);
      child.exitCode = 0; child.emit('exit', 0); child.emit('close', 0);
      vi.advanceTimersByTime(4999);
      expect(b.proc.kill).not.toHaveBeenCalledWith(-child.pid, 'SIGKILL');
      vi.advanceTimersByTime(1);
      expect(b.proc.kill).toHaveBeenCalledWith(-child.pid, 'SIGKILL');
      expect(b.request().res.statusCode).toBe(503);
      b.groups.delete(child.pid); vi.advanceTimersByTime(100); b.request();
      expect(b.children).toHaveLength(2); expect(res.end).toHaveBeenCalledTimes(1);
    });
    it('leader先退出也回收存活孙进程，不等待close', () => {
      const b = loadBridge(entry); b.request(); const child = b.children[0];
      child.exitCode = 0; child.emit('exit', 0);
      expect(b.proc.kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM');
      vi.advanceTimersByTime(5000);
      expect(b.proc.kill).toHaveBeenCalledWith(-child.pid, 'SIGKILL');
    });
    it('req.close不误杀，响应连接断开立即回收', () => {
      const b = loadBridge(entry); const { req, res } = b.request();
      req.emit('close'); expect(b.proc.kill).not.toHaveBeenCalledWith(-b.children[0].pid, 'SIGTERM');
      res.destroyed = true; res.emit('close');
      expect(b.proc.kill).toHaveBeenCalledWith(-b.children[0].pid, 'SIGTERM');
      vi.advanceTimersByTime(5000);
      expect(b.proc.kill).toHaveBeenCalledWith(-b.children[0].pid, 'SIGKILL');
      expect(res.end).not.toHaveBeenCalled();
    });
    it('req.aborted回收，error/close重复事件不重复回复或释放槽位', () => {
      const b = loadBridge(entry, { CECELIA_BRIDGE_MAX_CONCURRENT: '1' });
      const { req, res } = b.request(); req.aborted = true; req.emit('aborted');
      const child = b.children[0]; expect(b.proc.kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM');
      child.emit('error', new Error('cancelled')); child.emit('close', 1);
      expect(b.request().res.statusCode).toBe(503);
      b.groups.delete(child.pid); vi.advanceTimersByTime(100); b.request();
      expect(b.request().res.statusCode).toBe(503);
      expect(b.children).toHaveLength(2); expect(res.end).not.toHaveBeenCalled();
    });
    it('spawn同步失败不占槽，异步ENOENT与后续close幂等', () => {
      const b = loadBridge(entry, { CECELIA_BRIDGE_MAX_CONCURRENT: '1' });
      b.spawn.mockImplementationOnce(() => { throw new Error('spawn failed'); });
      expect(b.request().res.body.error).toBe('spawn failed');
      const failed = b.request();
      const child = b.children[0]; b.groups.delete(child.pid); child.pid = undefined;
      child.emit('error', new Error('ENOENT')); child.emit('close', -2);
      expect(failed.res.statusCode).toBe(500); expect(failed.res.end).toHaveBeenCalledTimes(1);
      b.request(); expect(b.request().res.statusCode).toBe(503);
      expect(b.children).toHaveLength(2);
    });
    it('成功输出在UTF8字符跨数据块时仍保持完整', () => {
      const b = loadBridge(entry); const { res } = b.request();
      const text = Buffer.from('图片');
      b.children[0].stdout.emit('data', text.subarray(0, 1));
      b.children[0].stdout.emit('data', text.subarray(1));
      b.finish(b.children[0]); expect(res.body.text).toBe('图片');
    });
    it('生命周期日志带ISO时间和原因，不记录prompt/账号凭据/模型输出', () => {
      const b = loadBridge(entry, { CECELIA_BRIDGE_MAX_CONCURRENT: '1' });
      b.request({ prompt: 'private-prompt', model: 'sonnet', accountId: 'private-account', timeout: 100 });
      const child = b.children[0];
      child.stdout.emit('data', Buffer.from('private-model-output'));
      b.request();
      expect(b.logger.log).toHaveBeenCalledWith('[bridge] /llm-call start', expect.objectContaining({
        at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/), pid: child.pid, model: 'sonnet', timeout_ms: 100, active: 1,
      }));
      expect(b.logger.warn).toHaveBeenCalledWith('[bridge] /llm-call rejected', expect.objectContaining({ reason: 'capacity', active: 1 }));
      vi.advanceTimersByTime(5100);
      expect(b.logger.warn).toHaveBeenCalledWith('[bridge] /llm-call timeout', expect.objectContaining({ pid: child.pid, reason: 'timeout' }));
      expect(b.logger.warn).toHaveBeenCalledWith('[bridge] /llm-call kill', expect.objectContaining({ pid: child.pid, reason: 'timeout' }));
      b.groups.delete(child.pid); vi.advanceTimersByTime(100);
      expect(b.logger.log).toHaveBeenCalledWith('[bridge] /llm-call reaped', expect.objectContaining({ pid: child.pid, active: 0 }));
      expect(JSON.stringify(Object.values(b.logger).flatMap(fn => fn.mock.calls))).not.toMatch(/private-prompt|private-account|private-model-output/);
    });
    it('正常结束保持协议并释放槽位', () => {
      const b = loadBridge(entry, { CECELIA_BRIDGE_MAX_CONCURRENT: '1' });
      const { res } = b.request({ model: 'sonnet' });
      b.children[0].stdout.emit('data', Buffer.from(' 完成 ')); b.finish(b.children[0]);
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ ok: true, text: '完成', model: 'sonnet' });
      b.request(); expect(b.children).toHaveLength(2); expect(res.end).toHaveBeenCalledTimes(1);
    });
    it.each(['SIGTERM', 'SIGINT'])('%s回收所有组，KILL后才能退出Bridge', (signal) => {
      const b = loadBridge(entry); b.request(); b.request(); b.proc.emit(signal);
      expect(b.server.close).toHaveBeenCalledTimes(1);
      for (const child of b.children) expect(b.proc.kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM');
      expect(b.proc.exit).not.toHaveBeenCalled(); expect(b.request().res.statusCode).toBe(503);
      vi.advanceTimersByTime(5000);
      for (const child of b.children) expect(b.proc.kill).toHaveBeenCalledWith(-child.pid, 'SIGKILL');
      b.groups.clear(); vi.advanceTimersByTime(100); expect(b.proc.exit).toHaveBeenCalledWith(0);
    });
    it.each(['stdout', 'stderr'])('%s超过1MiB后停止缓冲并回收组', (stream) => {
      const b = loadBridge(entry); const { res } = b.request(); const child = b.children[0];
      child[stream].emit('data', Buffer.alloc(1024 * 1024 + 1, 'x'));
      expect(res.statusCode).toBe(500); expect(res.body.error).toMatch(/output.*limit/i);
      expect(b.proc.kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM');
      child[stream].emit('data', Buffer.alloc(16, 'y')); b.finish(child);
      expect(res.end).toHaveBeenCalledTimes(1);
    });
    it.each([-1, 'Infinity', 'invalid', 0])('非法timeout%s安全回落120秒', (timeout) => {
      const b = loadBridge(entry, { CECELIA_BRIDGE_TIMEOUT_MS: 'invalid', CECELIA_BRIDGE_MAX_TIMEOUT_MS: '-1' });
      const { res } = b.request({ timeout }); vi.advanceTimersByTime(119999);
      expect(res.end).not.toHaveBeenCalled(); vi.advanceTimersByTime(1); expect(res.body.status).toBe('timeout');
    });
    it('大timeout硬封600秒，合法300秒不被默认120秒截断', () => {
      const b = loadBridge(entry, { CECELIA_BRIDGE_MAX_TIMEOUT_MS: 'Infinity' });
      const first = b.request({ timeout: 300000 }), second = b.request({ timeout: 999999999 });
      vi.advanceTimersByTime(299999); expect(first.res.end).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1); expect(first.res.body.status).toBe('timeout');
      vi.advanceTimersByTime(300000); expect(second.res.body.status).toBe('timeout');
    });
  });
}
describe('入口功能保留与部署依赖', () => {
  it('cjs图片在进程组消失后清理，仍放行Read工具', () => {
    const b = loadBridge('cecelia-bridge.cjs'); b.request({ image_base64: 'AAAA', image_mime: 'image/png', timeout: 100 });
    expect(b.spawn.mock.calls[0][1]).toContain('--allowedTools'); expect(b.spawn.mock.calls[0][1]).toContain('Read');
    vi.advanceTimersByTime(100); expect(b.fs.unlinkSync).not.toHaveBeenCalled();
    b.finish(b.children[0]); expect(b.fs.unlinkSync).toHaveBeenCalledTimes(1);
  });
  it('旧js任务触发保留GOAL_SETTINGS原始JSON', () => {
    const b = loadBridge('cecelia-bridge.js'), settings = '{"steps":2}';
    const { res } = b.request({ task_id: 't', checkpoint_id: 'c', extra_env: { CECELIA_GOAL_SETTINGS: settings } }, '/trigger-cecelia');
    expect(res.body.ok).toBe(true); expect(b.execSync.mock.calls.at(-1)[0]).toContain(`CECELIA_GOAL_SETTINGS='${settings}'`);
  });
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
      b.request(); b.request(); expect(b.request().res.statusCode).toBe(503);
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
