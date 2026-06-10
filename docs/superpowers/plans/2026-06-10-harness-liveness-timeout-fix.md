# Harness 子图等待逻辑三根因修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 harness pipeline 三个实证根因：callback 超时误杀健康 generator、401 认证失败不分类不轮换、watchdog 3min 阈值误重排。

**Architecture:** 全部改动在 packages/brain/src/。Fix 1 改 `_waitForSubGraphCompletion`（liveness 感知 + hard ceiling + docker kill）；Fix 2 在 harness-task 子图加 `accountId` channel + 失败分类纯函数 + `markAuthFailure` 熔断；Fix 3 改 watchdog 默认阈值。每个 fix 严格 TDD：commit-1 failing test，commit-2 实现。

**Tech Stack:** Node.js ESM, LangGraph Annotation channels, vitest（纯 DI mock，无真实 docker/DB）。

**Worktree:** `/Users/administrator/worktrees/cecelia/harness-liveness-timeout-fix`，分支 `cp-0610213046-harness-liveness-timeout-fix`。所有命令在 worktree 根执行。

**测试命令前缀:** `cd /Users/administrator/worktrees/cecelia/harness-liveness-timeout-fix && npx vitest run --root packages/brain <file> 2>&1 | tail -20`（若 `--root` 不被该版本支持，用 `cd packages/brain && npx vitest run <相对路径>`）。

---

### Task 1: Fix 3 — watchdog staleMinutes 3→10

**Files:**
- Modify: `packages/brain/src/harness-watchdog.js`（:94 注释、:104 jsdoc、:107 默认值）
- Test: `packages/brain/src/__tests__/harness-driver-heartbeat-watchdog.test.js`

- [ ] **Step 1: 写 failing test**

在 `harness-driver-heartbeat-watchdog.test.js` 的 `describe('resumeStalledHarnessDrivers — OPEN-2 看门狗', ...)` 块内追加（参考同文件 :41-51 用例的 mockPoolQuery 用法；若 describe 内有 beforeEach 重置 mock，跟随之）：

```js
  it('staleMinutes 默认 10 — 3min 过敏感导致活驱动被误重排（Issue 5a4faede）', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] });
    await resumeStalledHarnessDrivers({});
    // SQL 第一个参数即 staleMinutes 字符串
    const params = mockPoolQuery.mock.calls[0]?.[1];
    expect(params).toEqual(['10']);
  });
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `cd /Users/administrator/worktrees/cecelia/harness-liveness-timeout-fix/packages/brain && npx vitest run src/__tests__/harness-driver-heartbeat-watchdog.test.js 2>&1 | tail -15`
Expected: 新用例 FAIL（收到 `['3']`）。

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/__tests__/harness-driver-heartbeat-watchdog.test.js
git commit -m "test(brain): watchdog staleMinutes 默认 10 — failing test (Red)"
```

- [ ] **Step 4: 改实现**

`packages/brain/src/harness-watchdog.js` :107：

```js
export async function resumeStalledHarnessDrivers({ pool: dbPool = pool, staleMinutes = 10 } = {}) {
```

同步把 :94 注释 `>staleMinutes` 行和 :104 jsdoc `@param ... staleMinutes=3` 改成 `=10`；测试文件头 :9 的 `>3min` 改 `>10min`（属注释，随本 commit）。

- [ ] **Step 5: 跑测试确认 pass + 该文件全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-driver-heartbeat-watchdog.test.js 2>&1 | tail -10`
Expected: 全部 PASS。

- [ ] **Step 6: commit**

```bash
git add packages/brain/src/harness-watchdog.js packages/brain/src/__tests__/harness-driver-heartbeat-watchdog.test.js
git commit -m "fix(brain): watchdog staleMinutes 3→10 — 事件循环短暂阻塞不再误重排活驱动 (Green)"
```

---

### Task 2: Fix 2 — 401 auth 分类 + accountId channel + markAuthFailure 熔断

**Files:**
- Modify: `packages/brain/src/workflows/harness-task.graph.js`（channel :112 后、spawnNode return :340-352、awaitCallbackNode :364-395、routeAfterCallback :645-649、import 区）
- Modify: `packages/brain/src/workflows/__tests__/await-callback-retry.test.js`（:19-21 断言随源码演进）
- Create: `packages/brain/src/workflows/__tests__/await-callback-auth.test.js`

- [ ] **Step 1: 写 failing test（新文件）**

`packages/brain/src/workflows/__tests__/await-callback-auth.test.js`：

```js
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
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `cd packages/brain && npx vitest run src/workflows/__tests__/await-callback-auth.test.js 2>&1 | tail -15`
Expected: FAIL（`_classifyCallbackFailure` 未导出，import 报错）。

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/workflows/__tests__/await-callback-auth.test.js
git commit -m "test(brain): callback 401 auth 分类 + 账号熔断 — failing test (Red)"
```

- [ ] **Step 4: 实现**

`packages/brain/src/workflows/harness-task.graph.js` 四处改动：

(a) import 区（与现有 `import { resolveAccount } from '../spawn/middleware/account-rotation.js';` 相邻处）加：

```js
import { markAuthFailure } from '../account-usage.js';
```

(b) TaskState（:112 `daemonUrl` 行后）加 channel：

```js
  // 误杀修复（Issue 5a4faede）：spawn 时 resolveAccount 选中的 claude 账号 id。
  // awaitCallbackNode 收到 401 callback 时据此 markAuthFailure 熔断，下一轮 spawn 自动轮换。
  accountId:        Annotation({ reducer: (_o, n) => n, default: () => null }),
```

(c) spawnNode 成功 return（:340-352，`executor:`/`daemonUrl:` 同一个 return 对象内）加一行：

```js
    accountId: accountEnv.CECELIA_CREDENTIALS || null,
```

注意：仅本地 claude 路径有 accountEnv；若 codex 分支有独立 return（不经过 accountEnv），该分支不加（accountId 默认 null 即可）。

(d) awaitCallbackNode 前加纯函数，并改写 exit≠0 分支：

```js
/**
 * 误杀修复（Issue 5a4faede）：callback 失败分类。
 * exit≠0 时检测 stdout 的 auth 特征（OAuth token 容器内过期 → claude 中途 401）：
 * 'auth_failure' → awaitCallbackNode 熔断账号让 fix loop 轮换；其余 'container_exit'。
 */
export function _classifyCallbackFailure(payload = {}) {
  const stdout = String(payload.stdout || '');
  const authPatterns = [
    /"api_error_status"\s*:\s*401/,
    /failed\s+to\s+authenticate/i,
    /invalid\s+authentication\s+credentials/i,
  ];
  return authPatterns.some((re) => re.test(stdout)) ? 'auth_failure' : 'container_exit';
}
```

awaitCallbackNode（:364-395）签名加 `opts = {}` 第二参（与 spawnNode :153 同模式，LangGraph 传 RunnableConfig 不撞自定义 key），exit≠0 分支改为：

```js
  if (exitCode !== 0) {
    const errMsg = payload.error || payload.stderr || `container exit_code=${exitCode}`;
    const failType = _classifyCallbackFailure(payload);
    if (failType === 'auth_failure' && state.executor !== 'codex' && state.accountId) {
      // 熔断该账号：isAuthFailed 置位后，fix loop 重 spawn 时 resolveAccount 自动轮换
      const markFn = opts.markAuthFailureImpl || markAuthFailure;
      try {
        markFn(state.accountId);
        console.warn(`[harness-task.graph] auth_failure 检出 account=${state.accountId} → 已熔断，fix loop 将轮换账号`);
      } catch (e) {
        console.warn(`[harness-task.graph] markAuthFailure(${state.accountId}) failed: ${e.message}`);
      }
    }
    // B18: 不设 state.error（fatal）→ 转 ci_fail 路径让 fix loop 重试
    return {
      ci_status: 'fail',
      ci_fail_type: failType,
      failed_checks: [errMsg],
    };
  }
```

(e) routeAfterCallback（:645-649）：

```js
export function routeAfterCallback(state) {
  if (state.error) return 'end';
  if (state.ci_status === 'fail' && ['container_exit', 'auth_failure'].includes(state.ci_fail_type)) return 'fix';
  return 'parse';
}
```

(f) `await-callback-retry.test.js` :19-21 用例随源码演进（B18 契约不变：exit≠0 走 ci_fail 路径）：

```js
  it('awaitCallback exit≠0 改设 ci_status=fail + ci_fail_type 由分类器决定', () => {
    expect(src).toMatch(/ci_fail_type:\s*failType/);
    expect(src).toMatch(/_classifyCallbackFailure/);
  });
```

- [ ] **Step 5: 跑测试确认 pass**

Run: `cd packages/brain && npx vitest run src/workflows/__tests__/await-callback-auth.test.js src/workflows/__tests__/await-callback-retry.test.js src/workflows/__tests__/spawn-credentials.test.js 2>&1 | tail -15`
Expected: 全部 PASS。

- [ ] **Step 6: commit**

```bash
git add packages/brain/src/workflows/harness-task.graph.js packages/brain/src/workflows/__tests__/await-callback-retry.test.js
git commit -m "fix(brain): callback 401 分类为 auth_failure + markAuthFailure 熔断轮换账号 (Green)"
```

---

### Task 3: Fix 1 — liveness 感知 callback timeout + hard ceiling + docker kill + 外层 deadline

**Files:**
- Modify: `packages/brain/src/harness-container-cleanup.js`（新增 `killContainerById`）
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`（:840-842 常量区、:938-1054 `_waitForSubGraphCompletion`、import 区）
- Modify: `packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js`（改写 :48-84 用例 + 新增 3 用例）

- [ ] **Step 1: 改写/新增测试（failing）**

`harness-subgraph-wait-failfast.test.js`：

(a) 把 :48-84 用例 `'containerId 存在 + 容器活着但 callback 永不来 → callback_timeout 提前 fail'` **整体替换**为：

```js
  it('spawnedAt 超 CALLBACK_TIMEOUT 但容器仍 running → 不误杀，继续等到正常完成', async () => {
    const livenessCheck = vi.fn(async () => null); // docker inspect: running
    const invoke = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call === 1) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r1-alive-working',
              // 超 CALLBACK_TIMEOUT(100min) 但远未到 hard ceiling(240min)
              spawnedAt: Date.now() - 101 * 60 * 1000,
              status: 'queued',
            },
          };
        }
        return { next: [], values: { status: 'merged' } };
      }),
      invoke,
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 90 * 60 * 1000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      _checkLiveness: livenessCheck,
      _checkPrMerged: async () => false,
      _killContainer: vi.fn(async () => {}),
      heartbeatPool: { query: async () => ({}) },
    });

    // Line 07 r1 实证：容器活着有 5 个 commit 在干活，旧逻辑 100min 判死。
    // 新逻辑：liveness 确认 running → 不 resume failed，继续 poll 到正常完成。
    expect(invoke).not.toHaveBeenCalled();
    expect(result.status).toBe('merged');
  });

  it('spawnedAt 超 hard ceiling（240min）→ kill 容器 + resume failed(callback_hard_timeout)', async () => {
    const livenessCheck = vi.fn(async () => null); // 容器活着（可能 hang 死循环）
    const killContainer = vi.fn(async () => {});
    const invoke = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call === 1) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r1-hung',
              spawnedAt: Date.now() - 241 * 60 * 1000, // 超 hard ceiling
              status: 'queued',
            },
          };
        }
        return { next: [], values: { status: 'failed', error: 'callback_hard_timeout' } };
      }),
      invoke,
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 90 * 60 * 1000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      _checkLiveness: livenessCheck,
      _checkPrMerged: async () => false,
      _killContainer: killContainer,
      heartbeatPool: { query: async () => ({}) },
    });

    expect(killContainer).toHaveBeenCalledWith('harness-task-ws1-r1-hung');
    const resumeArg = invoke.mock.calls[0][0];
    expect(resumeArg.resume.status).toBe('failed');
    expect(resumeArg.resume.error).toBe('callback_hard_timeout');
    expect(result.status).toBe('failed');
  });

  it('executor=codex 超 hard ceiling → fail 但不 kill（远程容器本地杀不到）', async () => {
    const killContainer = vi.fn(async () => {});
    const invoke = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call === 1) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r0-remote',
              spawnedAt: Date.now() - 241 * 60 * 1000,
              executor: 'codex',
              daemonUrl: 'http://100.86.57.69:3458',
              status: 'queued',
            },
          };
        }
        return { next: [], values: { status: 'failed', error: 'callback_hard_timeout' } };
      }),
      invoke,
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 90 * 60 * 1000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      _checkLiveness: vi.fn(async () => null),
      _checkPrMerged: async () => false,
      _killContainer: killContainer,
      heartbeatPool: { query: async () => ({}) },
    });

    expect(killContainer).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
  });
```

(b) 在 `describe('CALLBACK_TIMEOUT_MS 常量', ...)` 后新增外层 deadline describe：

```js
describe('_waitForSubGraphCompletion — 外层 deadline 与 queued 透传', () => {
  it('deadline 到期 + 容器活着且未到 hard ceiling → 延长等待，不返回 queued', async () => {
    const invoke = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call <= 2) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r0-deadline-alive',
              spawnedAt: Date.now() - 1000, // 刚 spawn，远未到 hard ceiling
              status: 'queued',
            },
          };
        }
        return { next: [], values: { status: 'merged' } };
      }),
      invoke,
    };

    // timeoutMs=1 → 外层 deadline 立即到期；旧逻辑直接返回 status='queued'（Serial gate
    // 报 "did not merge (status=queued)" — 06-08 b249b808 实证）。新逻辑：容器活着 → 延长。
    const result = await _waitForSubGraphCompletion(compiled, {}, 1, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1000, // 关掉周期 liveness 干扰，只测 deadline 路径
      _checkLiveness: vi.fn(async () => null),
      _checkPrMerged: async () => false,
      _killContainer: vi.fn(async () => {}),
      heartbeatPool: { query: async () => ({}) },
    });

    expect(result.status).toBe('merged');
  });

  it('deadline 到期 + 容器已死 → 返回 failed（不再透传 status channel 默认值 queued）', async () => {
    const compiled = {
      getState: vi.fn(async () => ({
        next: ['await_callback'],
        values: {
          containerId: 'harness-task-ws1-r0-deadline-dead',
          spawnedAt: Date.now() - 1000,
          status: 'queued',
        },
      })),
      invoke: vi.fn(async () => {}),
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 1, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1000,
      _checkLiveness: vi.fn(async () => 'container_exited_without_callback'),
      _checkPrMerged: async () => false,
      _killContainer: vi.fn(async () => {}),
      heartbeatPool: { query: async () => ({}) },
    });

    expect(result.status).toBe('failed');
  });
});
```

(c) 文件顶部 import 增加 `CALLBACK_HARD_TIMEOUT_MS`，并在常量 describe 加一条：

```js
  it('hard ceiling 默认 240min 且 > CALLBACK_TIMEOUT_MS', () => {
    expect(CALLBACK_HARD_TIMEOUT_MS).toBe(240 * 60 * 1000);
    expect(CALLBACK_HARD_TIMEOUT_MS).toBeGreaterThan(CALLBACK_TIMEOUT_MS);
  });
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `cd packages/brain && npx vitest run src/workflows/__tests__/harness-subgraph-wait-failfast.test.js 2>&1 | tail -15`
Expected: FAIL（`CALLBACK_HARD_TIMEOUT_MS` 未导出 import 报错）。

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js
git commit -m "test(brain): callback timeout liveness 感知 + hard ceiling + deadline queued 透传 — failing tests (Red)"
```

- [ ] **Step 4: 实现 killContainerById**

`packages/brain/src/harness-container-cleanup.js` 末尾追加：

```js
/**
 * 按 docker --name 直杀单个容器（spawn/detached.js 以 containerId 作 --name 启动）。
 * 误杀修复（Issue 5a4faede）：hard ceiling 放弃等待时止血，防容器继续烧配额。
 *
 * @param {string} containerId
 */
export async function killContainerById(containerId) {
  if (!containerId) return;
  try {
    await dockerCmd(['rm', '-f', containerId]);
    console.log(`[harness-container-cleanup] killed container ${containerId} (hard ceiling)`);
  } catch (err) {
    console.warn(`[harness-container-cleanup] rm -f ${containerId} failed: ${err.message}`);
  }
}
```

- [ ] **Step 5: 实现 _waitForSubGraphCompletion 改动**

`packages/brain/src/workflows/harness-initiative.graph.js`：

(a) import 区：该文件已 import harness-container-cleanup（killInitiativeContainers，:1289/:1394 调用方）。在同一 import 语句加 `killContainerById`。

(b) :842 `CALLBACK_TIMEOUT_MS` 定义后加：

```js
// 误杀修复（2026-06-10，Issue 5a4faede）：CALLBACK_TIMEOUT 到点时若 docker inspect 确认
// 容器仍 running，说明 generator 还在干活（claude -p --output-format json 只在结束时输出，
// 无中间输出 ≠ 挂死；Line 07 r1 实证：被判死时 worktree 已有 5 个真实 commit）→ 不杀，继续等。
// 真正的放弃线是 hard ceiling：超过即使容器活着也 kill + fail，防 generator 真挂死永占驱动器。
export const CALLBACK_HARD_TIMEOUT_MS = parseInt(
  process.env.CECELIA_CALLBACK_HARD_TIMEOUT_MS || `${240 * 60 * 1000}`, 10,
);
```

(c) 函数顶部 DI 区（:942-943 之后）加：

```js
  const killContainer = opts._killContainer ?? killContainerById;
```

(d) 把 Fix #3 callback_timeout 块（:981-1007，从 `// Fix #3: await_callback 独立总超时` 到该 if 块结束）替换为：

```js
      // Fix #3 改（误杀修复）：await_callback 超时 ≠ 失败。callback 只在 generator 跑完才
      // POST，容器 running = 还在干活。超 CALLBACK_TIMEOUT 后先验 liveness：
      //   running 且未到 hard ceiling → 继续等（旧逻辑在这里误杀了健康 generator）；
      //   running 但超 hard ceiling   → kill（codex 跳过）+ resume failed；
      //   已死                        → 落到下方既有死亡分支统一处理（含 PR merged 救场）。
      const spawnedAt = state.values?.spawnedAt;
      if (spawnedAt && (Date.now() - spawnedAt) > CALLBACK_TIMEOUT_MS) {
        const prUrl = state.values?.pr_url;
        if (prUrl) {
          const alreadyMerged = await checkPrMerged(prUrl).catch(() => false);
          if (alreadyMerged) {
            console.log(
              `[harness-liveness] callback_timeout 但 PR 已 merged（${prUrl}），判 success`,
            );
            return { ...(state.values), status: 'merged' };
          }
        }
        const aliveReason = await checkLiveness(containerId, {
          executor: state.values?.executor,
          daemonUrl: state.values?.daemonUrl,
        });
        const overHardCeiling = (Date.now() - spawnedAt) > CALLBACK_HARD_TIMEOUT_MS;
        if (aliveReason === null && !overHardCeiling) {
          console.log(
            `[harness-liveness] callback 超 CALLBACK_TIMEOUT 但容器 ${containerId} 仍 running`
            + `（hard ceiling 未到）→ 继续等待`,
          );
        } else if (aliveReason === null && overHardCeiling) {
          if (state.values?.executor !== 'codex') {
            await killContainer(containerId);
          }
          console.warn(
            `[harness-liveness] await_callback 超 hard ceiling（${CALLBACK_HARD_TIMEOUT_MS}ms）`
            + ` containerId=${containerId} → kill + fail`,
          );
          await compiled.invoke(
            { resume: { status: 'failed', error: 'callback_hard_timeout' } },
            config,
          ).catch((e) => console.warn(`[harness-liveness] resume invoke failed: ${e.message}`));
          const fs = await compiled.getState(config);
          return { ...(fs.values || {}), status: 'failed' };
        }
        // aliveReason 非 null（已死）→ 不在此处理，由下方死亡分支统一走
      }
```

(e) 外层循环：`while (Date.now() < deadline)`（:952）改为 `while (true)`，并把 `const deadline = Date.now() + timeoutMs;`（:945）改为 `let deadline = Date.now() + timeoutMs;`，循环体开头（heartbeat 之前）插入：

```js
    if (Date.now() >= deadline) {
      const st = await compiled.getState(config);
      if (!st.next || st.next.length === 0) return st.values;
      const awaitingCb = Array.isArray(st.next) && st.next.includes('await_callback');
      const cid = st.values?.containerId;
      const sp = st.values?.spawnedAt;
      const underHard = sp ? (Date.now() - sp) < CALLBACK_HARD_TIMEOUT_MS : false;
      const aliveReason = (awaitingCb && cid)
        ? await checkLiveness(cid, { executor: st.values?.executor, daemonUrl: st.values?.daemonUrl })
        : 'not_awaiting_callback';
      if (aliveReason === null && underHard) {
        // 误杀修复：generator 还活着 → 延长等待，不再把 status channel 默认值 'queued'
        // 透传给 Serial gate（06-08 b249b808 "did not merge (status=queued)" 实证）。
        console.log('[harness-liveness] 外层 deadline 到期但容器仍 running 且未到 hard ceiling → 延长等待');
        deadline = Date.now() + Math.max(pollIntervalMs * livenessCheckEveryN, pollIntervalMs);
      } else {
        const finalStatus = (st.values?.status && st.values.status !== 'queued') ? st.values.status : 'failed';
        return { ...(st.values || {}), status: finalStatus };
      }
    }
```

(f) 删除原循环后的 :1051-1053 兜底返回（逻辑已并入循环内 deadline 分支；`while(true)` 无自然出口）。

- [ ] **Step 6: 跑测试确认 pass（含相邻套件防回归）**

Run: `cd packages/brain && npx vitest run src/workflows/__tests__/harness-subgraph-wait-failfast.test.js src/__tests__/harness-container-liveness.test.js src/__tests__/harness-serial-gate.test.js 2>&1 | tail -15`
Expected: 全部 PASS。（harness-container-liveness.test.js 现有用例不设 spawnedAt，timeout 分支被 `spawnedAt &&` guard 短路，不受影响；若个别用例因 getState 次数变化挂掉，按新轮询次序修 mock 序列，不改断言语义。）

- [ ] **Step 7: commit**

```bash
git add packages/brain/src/harness-container-cleanup.js packages/brain/src/workflows/harness-initiative.graph.js packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js
git commit -m "fix(brain): callback timeout liveness 感知 — running 不误杀，hard ceiling 240min kill+fail，deadline 不透传 queued (Green)"
```

---

### Task 4: 收尾 — brain 全量测试 + PRD/DoD/Learning + DevGate

**Files:**
- Create: `cp-0610213046-harness-liveness-timeout-fix.prd.md`（worktree 根）
- Create: `cp-0610213046-harness-liveness-timeout-fix.dod.md`（worktree 根）
- Create: `docs/learnings/cp-06102130-harness-liveness-timeout-fix.md`

- [ ] **Step 1: brain 全量单测**

Run: `cd packages/brain && npx vitest run 2>&1 | tail -25`
Expected: 全绿（若有与本次改动无关的既有红灯，记录文件名，不在本 PR 修）。

- [ ] **Step 2: 写 PRD**

`cp-0610213046-harness-liveness-timeout-fix.prd.md`：

```markdown
# PRD: harness 子图等待逻辑三根因修复

## 背景
harness_initiative 连续失败（Line 07 a2463d95、Agent 模块化 b249b808）。实证三根因：
1. callback 超时（100min）排在 liveness 检查前，docker inspect 确认 running 的 generator
   被误杀（被判死时 worktree 已有 5 个真实 commit）；判死后容器不 kill 继续烧配额。
2. 容器内 OAuth 401 被当普通 container_exit，账号不熔断不轮换，fix round 同账号复发。
3. watchdog staleMinutes=3 过敏感，活驱动被 re-claim 5 次，并发 poller 的 90min deadline
   到期透传 status channel 默认值 'queued' → Serial gate 误判。

## 方案
- `_waitForSubGraphCompletion`：超时先验 liveness；running 且未到 hard ceiling
  （CECELIA_CALLBACK_HARD_TIMEOUT_MS，默认 240min）→ 继续等；超 hard ceiling →
  killContainerById（codex 跳过）+ resume failed；外层 deadline 同理且不再透传 queued。
- `awaitCallbackNode`：`_classifyCallbackFailure` 识别 401 → ci_fail_type='auth_failure'
  + markAuthFailure(state.accountId) 熔断轮换；routeAfterCallback 对 auth_failure 走 fix。
- watchdog staleMinutes 默认 3→10。

## 成功标准
- 三组 regression test 全绿（见 DoD），brain 套件无回归。
```

- [ ] **Step 3: 写 DoD（push 前全部勾 [x]）**

`cp-0610213046-harness-liveness-timeout-fix.dod.md`：

```markdown
# DoD: harness 子图等待逻辑三根因修复

## 验收清单

- [x] [BEHAVIOR] 容器 running 时 callback 超时不误杀（继续等待到正常完成）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js','utf8');if(!c.includes('不误杀，继续等到正常完成'))process.exit(1)"

- [x] [BEHAVIOR] 超 hard ceiling 时 kill 容器并 resume failed(callback_hard_timeout)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js','utf8');if(!c.includes('callback_hard_timeout'))process.exit(1)"

- [x] [BEHAVIOR] 外层 deadline 到期不再透传 status=queued（容器死 → failed；活 → 延长）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js','utf8');if(!c.includes('不再透传 status channel 默认值 queued')&&!c.includes('queued 透传'))process.exit(1)"

- [x] [BEHAVIOR] callback 401 分类为 auth_failure 并 markAuthFailure 熔断
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/await-callback-auth.test.js','utf8');if(!c.includes('auth_failure'))process.exit(1)"

- [x] [BEHAVIOR] watchdog staleMinutes 默认 10
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-driver-heartbeat-watchdog.test.js','utf8');if(!c.includes(\"['10']\"))process.exit(1)"

- [x] [ARTIFACT] CALLBACK_HARD_TIMEOUT_MS 常量存在（env CECELIA_CALLBACK_HARD_TIMEOUT_MS）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('CECELIA_CALLBACK_HARD_TIMEOUT_MS'))process.exit(1)"

- [x] [ARTIFACT] killContainerById 导出
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-container-cleanup.js','utf8');if(!c.includes('export async function killContainerById'))process.exit(1)"

## Learning 路径

docs/learnings/cp-06102130-harness-liveness-timeout-fix.md
```

- [ ] **Step 4: 写 Learning（含 `### 根本原因` + `### 下次预防` + checklist，全新 per-branch 文件名）**

`docs/learnings/cp-06102130-harness-liveness-timeout-fix.md`：

```markdown
# Learning: harness callback 超时误杀健康 generator

## 现象
Line 07 initiative 失败 "Serial gate: ws1 did not merge (status=failed)"，但 generator
worktree 里有 5 个真实 commit —— 它被判死时还在干活。

### 根本原因
1. 超时检查（CALLBACK_TIMEOUT_MS）排在 liveness 检查之前：`claude -p --output-format json`
   只在结束时输出一次，"没有 callback" ≠ "挂死"，必须先问 docker inspect。
2. "没有输出的等待" 与 "真挂死" 的区分只能靠容器活性 + hard ceiling 双信号，单一时长
   阈值必然在长任务上误杀（设计注释自己写了 generator 合法跑 11-89min，real-world
   sprint + fix round 轻松超 100min）。
3. 401 等基础设施失败混在 container_exit 里，fix loop 同账号重试 → 系统性复发。
4. watchdog staleMinutes=3 假设心跳永不抖动；任何 >3min 的事件循环阻塞（execSync 调
   gh/git）都触发 re-claim，产生并发 poller 和 queued 透传。

### 下次预防
- [ ] 任何 "超时 → 判死" 的逻辑必须先验执行体活性（docker inspect / daemon health），
      超时只配 hard ceiling 用
- [ ] LLM 容器失败必须分类（auth / quota / 业务），auth 类要熔断账号再重试
- [ ] 看门狗阈值必须 >> 心跳间隔的最坏抖动（含事件循环阻塞），并在误杀路径留 log
- [ ] 放弃等待时必须回收执行体（docker kill），不许留孤儿容器烧配额
```

- [ ] **Step 5: DevGate 三件套**

```bash
cd /Users/administrator/worktrees/cecelia/harness-liveness-timeout-fix
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全部通过（facts-check 校验 DEFINITION.md 与代码一致；本次未改 PORT/tick/whitelist 等事实，应直接绿）。失败则按报错修复后重跑。

- [ ] **Step 6: commit 收尾产物**

```bash
git add cp-0610213046-harness-liveness-timeout-fix.prd.md cp-0610213046-harness-liveness-timeout-fix.dod.md docs/learnings/cp-06102130-harness-liveness-timeout-fix.md
git commit -m "docs: PRD/DoD/Learning — harness 等待逻辑三根因修复"
```

---

### Task 5: push + PR（由 finishing → engine-ship → engine-pr-watchdog 链执行）

- [ ] push 分支 + 开 PR（title: `fix(brain): harness 子图等待逻辑三根因修复 — liveness 感知超时 + 401 熔断轮换 + watchdog 阈值`，body 关联 Issue 5a4faede 与 Brain Task bdc5f75a）
- [ ] CI 全绿后 merge（squash），禁止 --admin 绕过
- [ ] PATCH Brain task bdc5f75a 状态 completed + pr_url
- [ ] Notion Issue 5a4faede 置 Closed 附 PR 链接

## Self-Review 结论

- Spec 覆盖：Fix 1/2/3 ↔ Task 3/2/1，spec 的"不做"清单未被越界。
- 占位符：无 TBD；Task 3 Step 6 对 harness-container-liveness.test.js 的"按需修 mock 序列"是
  明确的条件动作（断言语义不变），非占位。
- 类型一致：`_classifyCallbackFailure` / `killContainerById` / `CALLBACK_HARD_TIMEOUT_MS` /
  `opts._killContainer` / `opts.markAuthFailureImpl` 命名全文一致。
