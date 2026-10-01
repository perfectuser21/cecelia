import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
const { readFileSync: readSource } = await vi.importActual('node:fs');

const io = vi.hoisted(() => ({ read: vi.fn(), spawn: vi.fn(), select: vi.fn(), fetch: vi.fn() }));
vi.mock('fs', () => ({ readFileSync: io.read }));
vi.mock('child_process', () => ({ spawn: io.spawn }));
vi.mock('../model-profile.js', () => ({ getActiveProfile: () => ({ config: {} }) }));
vi.mock('../account-usage.js', () => ({ selectBestAccount: io.select, markAuthFailure: vi.fn(), verifyAccountTokenLive: vi.fn() }));
vi.mock('../llm-capacity.js', () => ({ CODEX_ACCOUNTS: [] }));
vi.mock('../langfuse-reporter.js', () => ({ reportCall: vi.fn().mockResolvedValue(undefined) }));
import { callLLM, callLLMStream } from '../llm-caller.js';
import { isIsolatedRuntime, assertExternalExecutionAllowed } from '../runtime-safety.js';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ['NODE_ENV', 'VITEST', 'BRAIN_PREVIEW', 'BRAIN_EVALUATOR_MODE', 'DB_NAME', 'PGDATABASE', 'DATABASE_URL', 'CECELIA_LLM_DISABLED']) vi.stubEnv(key, '');
  io.read.mockReturnValue('{"api_key":"fixture-only"}');
  io.select.mockResolvedValue({ accountId: 'account1' });
  io.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ text: 'fixture', content: [{ text: 'fixture' }] }) });
  vi.stubGlobal('fetch', io.fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('隔离实例不得调用真实模型或读取账号凭据', () => {
  it.each([
    ['NODE_ENV', 'test'], ['NODE_ENV', 'development'], ['VITEST', 'true'], ['BRAIN_PREVIEW', '1'], ['BRAIN_PREVIEW', 'true'],
    ['BRAIN_EVALUATOR_MODE', 'true'], ['DB_NAME', 'cecelia_test'],
    ['DB_NAME', 'cecelia_scratch'], ['DB_NAME', 'cecelia_preview_123'],
    ['DB_NAME', 'cecelia_dev'], ['PGDATABASE', 'cecelia_test'],
    ['DATABASE_URL', 'postgresql://localhost/cecelia_test'], ['CECELIA_LLM_DISABLED', 'true'],
  ])('%s=%s 时非流式调用在所有副作用前拒绝', async (key, value) => {
    vi.stubEnv(key, value);
    await expect(callLLM('thalamus', 'fixture')).rejects.toMatchObject({ code: 'LLM_RUNTIME_ISOLATED' });
    expect(io.select).not.toHaveBeenCalled();
    expect(io.read).not.toHaveBeenCalled();
    expect(io.fetch).not.toHaveBeenCalled();
    expect(io.spawn).not.toHaveBeenCalled();
  });
  it('VITEST 标记不能解锁真实调用', async () => {
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('VITEST', 'true');
    await expect(callLLM('thalamus', 'fixture')).rejects.toMatchObject({ code: 'LLM_RUNTIME_ISOLATED' });
    expect(io.fetch).not.toHaveBeenCalled();
  });
  it('流式入口同样拒绝，并且不触发输出回调', async () => {
    vi.stubEnv('BRAIN_PREVIEW', '1');
    const onChunk = vi.fn();
    await expect(callLLMStream('thalamus', 'fixture', { provider: 'anthropic' }, onChunk)).rejects.toMatchObject({ code: 'LLM_RUNTIME_ISOLATED' });
    expect(onChunk).not.toHaveBeenCalled(); expect(io.fetch).not.toHaveBeenCalled();
  });
  it('生产实例保持正常调用，使用本测试的模拟传输', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('DB_NAME', 'cecelia');
    expect(isIsolatedRuntime()).toBe(false);
    expect(await callLLM('thalamus', 'fixture')).toMatchObject({ text: 'fixture' });
    expect(io.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('服务器实际监听回调的隔离位置', () => {
  it('持有测试服务的父进程断开 IPC 时立即退出', async () => {
    const source = readSource(new URL('../../server.js', import.meta.url), 'utf8');
    const body = source.match(/async function onBrainListening\(\) \{([\s\S]*?)^\}/m)[1];
    const once = vi.fn(), send = vi.fn(), exit = vi.fn();
    await vm.runInNewContext(`(async () => { ${body} })()`, {
      process: { env: {}, once, send, exit }, console: { log() {} }, PORT: 5299,
      isIsolatedRuntime: () => true, initWebSocketServer: vi.fn(), server: {},
    });
    expect(send).toHaveBeenCalledWith({ type: 'brain-test-ready' });
    const disconnect = once.mock.calls.find(([event]) => event === 'disconnect');
    expect(disconnect).toBeDefined();
    disconnect[1]();
    expect(exit).toHaveBeenCalledWith(0);
  });
  it('测试实例在恢复/资源轮询/自动派发等启动动作之前返回', async () => {
    const source = readSource(new URL('../../server.js', import.meta.url), 'utf8');
    const body = source.match(/async function onBrainListening\(\) \{([\s\S]*?)^\}/m)[1];
    const firstAutomation = vi.fn(() => false);
    const context = { process: { env: { NODE_ENV: 'test' } }, console: { log() {} }, PORT: 5299,
      isIsolatedRuntime: () => isIsolatedRuntime({ NODE_ENV: 'test' }), shouldStartAttemptCleanupLoop: firstAutomation,
      initWebSocketServer: vi.fn(), server: {} };
    // 只执行真实回调，所有模块导入均不提供，旧实现触及第一个自动化动作即留下证据。
    await vm.runInNewContext(`(async () => { ${body} })()`, context);
    expect(firstAutomation).not.toHaveBeenCalled();
  });
  it('监听前不启动 durable、孤儿任务恢复和公网服务，但内部 HTTP 仍可启动', async () => {
    const source = readSource(new URL('../../server.js', import.meta.url), 'utf8');
    const body = source.match(/if \(!process.env.VITEST\) \{([\s\S]*?)^\}\n\nasync function onBrainListening/m)[1];
    const bootDurable = vi.fn(), startAcceptancePublicServer = vi.fn(), listenWithRetry = vi.fn();
    await vm.runInNewContext(`(async () => { ${body} })()`, {
      process: { env: { NODE_ENV: 'test' } }, console, PORT: 5299, server: {}, pool: {},
      isIsolatedRuntime: () => true, waitForPortFree: vi.fn(), bootDurable,
      listenWithRetry, startAcceptancePublicServer, onBrainListening: vi.fn(),
    });
    expect(bootDurable).not.toHaveBeenCalled();
    expect(startAcceptancePublicServer).not.toHaveBeenCalled();
    expect(listenWithRetry).toHaveBeenCalledTimes(1);
  });
});

describe('隔离环境不能通过手动派发绕过启动保护', () => {
  it.each([
    ['executor.js', 'triggerCeceliaRun'],
    ['harness-skill-relay.js', 'spawnSkillRelaySession'],
    ['script-executor.js', 'triggerScriptRun'],
  ])('%s 的 %s 在访问执行依赖之前拒绝', async (file, name) => {
    const source = readSource(new URL(`../${file}`, import.meta.url), 'utf8');
    const expression = source.match(new RegExp(`async function ${name}\\([^]*?^\\}`, 'm'))[0];
    const context = { assertExternalExecutionAllowed: () => assertExternalExecutionAllowed({ NODE_ENV: 'test' }) };
    const fn = vm.runInNewContext(`(${expression})`, context);
    await expect(fn({ id: 'fixture', payload: {} })).rejects.toMatchObject({ code: 'EXECUTION_RUNTIME_ISOLATED' });
  });
});
