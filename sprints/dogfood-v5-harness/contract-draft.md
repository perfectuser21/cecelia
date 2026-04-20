# Sprint Contract Draft (Round 1)

## Feature 1: fetchWithRetry 带指数退避的重试包装器

**行为描述**:

调用方传入一个无参异步/同步函数 `op`。`fetchWithRetry(op)` 负责调用 `op()`，当 `op()` 抛出异常时自动重试，总共允许 3 次重试（即最多 4 次调用）。重试间隔按指数退避增长：以 100ms 为基准，每次重试前的等待时长至少是上一次的 1.5 倍。若 `op()` 在首次调用或任一次重试中返回，则 `fetchWithRetry` 将该返回值返回给调用方；若 4 次调用均失败，则抛出最后一次调用产生的异常（保持原始错误对象，不包装）。

**硬阈值**:

- 首次失败后发起 1 次重试；第 1 次重试失败后发起第 2 次；第 2 次重试失败后发起第 3 次；第 3 次重试仍失败才抛出。
- 4 次调用中任何一次返回值即作为最终结果返回（首次成功不应等待退避时间）。
- 相邻两次重试前的等待间隔 `gap[i+1] >= gap[i] * 1.5`。
- 抛出的异常必须与最后一次调用 `op()` 产生的异常一致（`rejects.toThrow` 能匹配原始 message）。
- 常量 `MAX_RETRIES` 被模块导出且其数值等于 3。

**BEHAVIOR 覆盖**（这些会在 tests/ws1/ 里落成真实 it() 块）:

- `it('returns successfully when op succeeds on the 4th attempt after 3 failures')`
- `it('throws the original error after 3 retries all fail')`
- `it('waits at least 1.5x longer between each consecutive retry')`
- `it('calls op exactly once when it succeeds on the first try')`

**ARTIFACT 覆盖**（这些会写进 contract-dod-ws1.md）:

- `packages/brain/src/retry.js` 文件存在
- 文件导出 `fetchWithRetry` 命名符号
- 文件导出 `MAX_RETRIES` 常量且字面值为 3

---

## Workstreams

workstream_count: 1

### Workstream 1: retry.js 实现与导出

**范围**: 新建 `packages/brain/src/retry.js` 文件，实现并 ES module 导出 `fetchWithRetry` 函数与 `MAX_RETRIES` 常量。不修改其他文件，不引入第三方依赖。
**大小**: S（<100 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/retry.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/retry.test.ts` | retries-to-success / throws-after-max / exponential-backoff / first-try-success | 当前（模块未实现）：`npx vitest run sprints/dogfood-v5-harness/tests/ws1/` → 1 suite FAIL（`Cannot find module '../../../../packages/brain/src/retry.js'`），4 个 it 全部因 import 失败阻塞。|

## Mutation Evidence（Proposer 先手自测）

以弱 stub（`export const MAX_RETRIES=3; export async function fetchWithRetry(op){return op();}`）运行测试：

- Tests: 3 failed / 1 passed（共 4）
- 抓出：retries-to-success（`attempts === 4` 断言挂）、throws-after-max（`attempts === 4` 断言挂）、exponential-backoff（`timestamps.length === 4` 断言挂）
- 误放：无。"first-try-success" 在弱 stub 下 PASS 是正确的——stub 恰好满足该条件，不算漏网。

证明 4 个测试对"无重试"这类常见假实现具备区分能力。
