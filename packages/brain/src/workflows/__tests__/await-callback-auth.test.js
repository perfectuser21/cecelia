/**
 * 误杀修复（Issue 5a4faede）：callback 401 auth 失败分类 + 账号熔断。
 * 实证：r0 容器跑 80 turns 后 OAuth 401（"Failed to authenticate"），被当普通
 * container_exit 进 fix round，账号不熔断不轮换 → 同账号重试大概率复发。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { _classifyCallbackFailure } from '../harness-task.graph.js';

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

  it('stdout 含 "Failed to authenticate" 文本（无 JSON 结构）→ auth_failure', () => {
    expect(_classifyCallbackFailure({
      exit_code: 1,
      stdout: 'blah Failed to authenticate blah',
    })).toBe('auth_failure');
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
