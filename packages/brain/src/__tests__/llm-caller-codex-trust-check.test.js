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

  // 2026-09-02：callCodexHeadless 的 API Key fallback 已被禁止（生产曾因此静默烧钱
  // ~24 美元且无告警，见 commit 5e59d2151）——无可用 OAuth team 账号时现在直接 throw，
  // 不再碰 OPENAI_API_KEY。要让执行到达 spawn()，mock 必须让 getNextCodexTeamHome()
  // 找到一个"真实可用"的 team 账号（team1），而不是继续依赖已被禁止的 fallback 路径。
  // auth.json 只要求 `tokens` 字段有值（见 llm-caller.js getNextCodexTeamHome()）。
  vi.doMock('fs', () => ({
    readFileSync: vi.fn((path) => {
      if (String(path).includes('.codex-team1')) {
        return JSON.stringify({
          tokens: { access_token: 'test-access-token', refresh_token: 'test-refresh-token' },
        });
      }
      throw new Error(`unexpected readFileSync path in test: ${path}`);
    }),
  }));

  beforeEach(() => {
    capturedArgs = null;
    closeHandler = null;
    stdoutDataHandler = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
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
