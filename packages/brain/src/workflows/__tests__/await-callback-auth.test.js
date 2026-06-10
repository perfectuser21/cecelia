/**
 * 误杀修复（Issue 5a4faede）：callback 401 auth 失败分类 + 账号熔断。
 * 实证：r0 容器跑 80 turns 后 OAuth 401（"Failed to authenticate"），被当普通
 * container_exit 进 fix round，账号不熔断不轮换 → 同账号重试大概率复发。
 *
 * review issue ②：文本 pattern 锚定在 claude result JSON 的 result 字段值内，
 * 防止 generator 跑登录类任务时 transcript 引用的业务输出误熔断健康账号。
 * review issue ③：awaitCallbackNode 的 markAuthFailure 调用与 codex/null guard
 * 用行为级测试覆盖（DI 注入 markAuthFailureImpl + mock interrupt）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// mock @langchain/langgraph：让 awaitCallbackNode 里的 interrupt() 直接返回注入的
// callback payload（真 interrupt 在 graph 外调用会 throw）。模式照抄
// harness-task.graph.xian-spawn.test.js。vi.mock 被 hoist 到 import 之前，
// 对下方同一 import 拿到的 _classifyCallbackFailure（纯函数）无影响。
vi.mock('@langchain/langgraph', () => {
  const Annotation = vi.fn((opts) => opts);
  Annotation.Root = vi.fn((fields) => fields);
  return {
    StateGraph: vi.fn(() => ({
      addNode: vi.fn(),
      addEdge: vi.fn(),
      addConditionalEdges: vi.fn(),
      compile: vi.fn(() => ({ invoke: vi.fn() })),
    })),
    Annotation,
    START: '__start__',
    END: '__end__',
    interrupt: vi.fn(),
  };
});

import { interrupt } from '@langchain/langgraph';
import { _classifyCallbackFailure, awaitCallbackNode } from '../harness-task.graph.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../harness-task.graph.js'), 'utf8');

describe('_classifyCallbackFailure — callback 失败分类', () => {
  it('stdout 含 api_error_status 401 → auth_failure', () => {
    const stdout = JSON.stringify({
      type: 'result', is_error: true, api_error_status: 401,
      result: 'Failed to authenticate. API Error: 401 Invalid authentication credentials',
    });
    expect(_classifyCallbackFailure({ exit_code: 1, stdout })).toBe('auth_failure');
  });

  it('result 字段含 "Failed to authenticate" → auth_failure；裸文本不在 result 字段内 → container_exit（防误熔断）', () => {
    expect(_classifyCallbackFailure({
      exit_code: 1,
      stdout: '{"type":"result","is_error":true,"result":"Failed to authenticate. API Error: 401"}',
    })).toBe('auth_failure');
    expect(_classifyCallbackFailure({
      exit_code: 1,
      stdout: 'e2e output: user login failed to authenticate with test credentials',
    })).toBe('container_exit');
  });

  it('普通非 auth 失败 → container_exit', () => {
    expect(_classifyCallbackFailure({ exit_code: 1, stdout: 'TypeError: x is not a function' })).toBe('container_exit');
  });

  it('stdout 缺失 → container_exit（不抛错）', () => {
    expect(_classifyCallbackFailure({ exit_code: 1 })).toBe('container_exit');
  });
});

describe('auth_failure 接线（源码断言）', () => {
  it('TaskState 有 accountId channel，spawnNode 写入 resolveAccount 选中账号', () => {
    expect(src).toMatch(/accountId:\s*Annotation\(/);
    expect(src).toMatch(/accountId:\s*accountEnv\.CECELIA_CREDENTIALS\s*\|\|\s*null/);
  });

  it('awaitCallbackNode 用分类结果写 ci_fail_type，auth_failure 时调 markAuthFailure（codex/null guard）', () => {
    expect(src).toMatch(/ci_fail_type:\s*failType/);
    expect(src).toMatch(/markAuthFailure/);
    expect(src).toMatch(/executor\s*!==\s*['"]codex['"]/);
  });

  it('routeAfterCallback 对 auth_failure 也走 fix（respawn 轮换账号）', () => {
    expect(src).toMatch(/['"]container_exit['"]\s*,\s*['"]auth_failure['"]|['"]auth_failure['"]\s*,\s*['"]container_exit['"]/);
  });
});

describe('awaitCallbackNode — auth_failure 行为（DI 注入 markAuthFailure）', () => {
  const AUTH_STDOUT = '{"type":"result","is_error":true,"api_error_status":401,"result":"Failed to authenticate"}';

  beforeEach(() => {
    interrupt.mockReset();
    interrupt.mockReturnValue({ exit_code: 1, stdout: AUTH_STDOUT });
  });

  async function runNode(state) {
    const calls = [];
    const result = await awaitCallbackNode(state, {
      markAuthFailureImpl: (accountId) => calls.push(accountId),
    });
    return { result, calls };
  }

  it('claude executor + accountId + 401 callback → 调 markAuthFailure 且 ci_fail_type=auth_failure', async () => {
    const { result, calls } = await runNode({ executor: 'claude', accountId: 'account1' });
    expect(calls).toEqual(['account1']);
    expect(result.ci_fail_type).toBe('auth_failure');
    expect(result.ci_status).toBe('fail');
  });

  it('executor=codex → 不熔断（calls 空）但 ci_fail_type 仍 auth_failure', async () => {
    const { result, calls } = await runNode({ executor: 'codex', accountId: 'account1' });
    expect(calls).toEqual([]);
    expect(result.ci_fail_type).toBe('auth_failure');
  });

  it('accountId null → 不熔断不抛错', async () => {
    const { result, calls } = await runNode({ executor: 'claude', accountId: null });
    expect(calls).toEqual([]);
    expect(result.ci_fail_type).toBe('auth_failure');
  });
});
