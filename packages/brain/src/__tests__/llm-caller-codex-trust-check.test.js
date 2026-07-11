/**
 * 回归测试：codex exec 缺 --skip-git-repo-check 导致 fallback #1 必失败
 *
 * 背景：brain 容器内进程 cwd 不是 git 仓库，codex CLI 默认要求"trusted directory"
 * （git 仓库或已显式信任的目录），缺这个 flag 时 codex exec 直接 exit 1
 * （"Not inside a trusted directory and --skip-git-repo-check was not specified"）。
 * 该错误文本被 300 字符截断规则挡在前面无害的 PATH 只读 WARNING 之后，
 * 曾被误读成"Read-only file system"导致排查方向跑偏。
 *
 * 实测验证（2026-07-11，容器 cecelia-node-brain 内）：
 *   缺 flag → exit 1, stderr含 "Not inside a trusted directory"
 *   加 flag → exit 0, stdout = 真实模型响应
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../llm-caller.js', import.meta.url), 'utf8');

describe('callCodexHeadless — --skip-git-repo-check（codex 信任检查修复）', () => {
  it('源码含 --skip-git-repo-check', () => {
    expect(SRC).toContain('--skip-git-repo-check');
  });
});

describe('callCodexHeadless — spawn 参数行为验证', () => {
  let capturedArgs = null;
  let closeHandler = null;
  let stdoutDataHandler = null;

  // 注：用 vi.doMock（非 hoisted）而非 vi.mock —— vi.mock 会被 Vitest 静态提升到
  // 文件最顶部（早于 import），导致上面模块级 `const SRC = readFileSync(...)` 也被
  // mock 拦截而抛错，整个测试文件直接 collection 失败（实测复现）。doMock 只在
  // 运行到这里之后对后续的 `await import('../llm-caller.js')` 生效，行为等价但不
  // 提前污染模块作用域。
  //
  // spawn mock 模拟 codex 进程成功返回（stdout 写数据 + exit 0），而不是失败退出：
  // 失败退出会让 callLLM 级联到 anthropic-api / anthropic bridge 兜底，其中 bridge
  // 兜底会发起真实网络调用（~6s，非确定），CI 里不能有这种依赖。模拟成功让 callLLM
  // 直接在 codex 分支 return，不会碰任何 fallback。
  vi.doMock('child_process', () => ({
    spawn: (...args) => {
      capturedArgs = args;
      return {
        stdout: { on: (event, handler) => { if (event === 'data') stdoutDataHandler = handler; } },
        stderr: { on: vi.fn() },
        on: (event, handler) => { if (event === 'close') closeHandler = handler; },
      };
    },
  }));

  vi.doMock('../model-profile.js', () => ({
    getActiveProfile: vi.fn(() => ({
      config: {
        rumination: { provider: 'codex', model: 'codex/gpt-5.4-mini' },
      },
    })),
  }));

  vi.doMock('../account-usage.js', () => ({
    selectBestAccount: vi.fn(async () => ({ accountId: 'account1', model: 'haiku' })),
    markAuthFailure: vi.fn(),
  }));

  vi.doMock('../langfuse-reporter.js', () => ({
    reportCall: vi.fn(async () => {}),
  }));

  vi.doMock('fs', () => ({
    readFileSync: vi.fn(() => { throw new Error('no team home in test'); }),
  }));

  let prevOpenAIKey;

  beforeEach(() => {
    capturedArgs = null;
    closeHandler = null;
    stdoutDataHandler = null;
    vi.clearAllMocks();
    // fs 被 mock 成必抛错，getNextCodexTeamHome()/getOpenAIKey() 的 readFileSync 分支
    // 都会失败；没有这个 env fallback，callCodexHeadless 会在"无可用 OAuth team 账号，
    // 且 OpenAI API key 不存在"这一步提前抛错，spawn 永远不会被调用，断言无法验证目标行为。
    prevOpenAIKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-fake-key';
  });

  afterEach(() => {
    vi.resetModules();
    if (prevOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAIKey;
  });

  it('callLLM(codex provider) 调用 spawn 时参数含 --skip-git-repo-check', async () => {
    const { callLLM } = await import('../llm-caller.js');

    const callPromise = callLLM('rumination', '测试 prompt');

    // 等待 spawn 被调用（microtask 队列）
    await new Promise((r) => setTimeout(r, 10));

    expect(capturedArgs).not.toBeNull();
    const [, spawnArgs] = capturedArgs;
    expect(spawnArgs).toContain('--skip-git-repo-check');

    // 模拟 codex 进程成功返回：写 stdout，再 exit 0
    if (stdoutDataHandler) stdoutDataHandler('测试回复');
    if (closeHandler) closeHandler(0);

    const result = await callPromise;
    expect(result.text).toBe('测试回复');
    expect(result.provider).toBe('codex');
  });
});
