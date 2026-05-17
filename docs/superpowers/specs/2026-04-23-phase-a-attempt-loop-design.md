# Phase A — attempt-loop 真循环

**Date**: 2026-04-23
**Status**: Approved (Brain v2 Layer 3 收尾)
**Task**: `76530023-19bd-4879-a5f0-77161fe1162e`
**Spec refs**: `docs/design/brain-orchestrator-v2.md` §5.2 / `docs/design/brain-v2-roadmap-next.md` §Phase A

## 1. 目标

把 `spawn()` 从"一次 spawn = 一次 attempt"改成 `for (attempt in 0..MAX_ATTEMPTS)` 真循环。失败后 `classifyFailure` 判三态（success/transient/permanent），transient 且 `shouldRetry` 为 true 才继续下一轮。P2 已建未接线的 `retry-circuit.js` 激活。

## 2. 当前状态

- `packages/brain/src/spawn/spawn.js`：31 行，纯 wrapper `return executeInDocker(opts)`
- `packages/brain/src/spawn/middleware/retry-circuit.js`：`classifyFailure()` / `shouldRetry()` 已实现未被调用
- `packages/brain/src/spawn/middleware/cap-marking.js`：已在 executeInDocker 内层跑，命中 429/credit_low 时调 `markSpendingCap(account)`
- `packages/brain/src/spawn/middleware/account-rotation.js` 的 `resolveAccount`：`isSpendingCapped(explicit) → true` 时自动换号（内层自愈）

## 3. 架构

```
spawn(opts)
 │
 ├── for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++)
 │     │
 │     ├── result = await executeInDocker(opts)
 │     │     (内部已接 resolveCascade / resolveAccount / runDocker / checkCap / billing / logging)
 │     │
 │     ├── cls = classifyFailure(result)
 │     ├── if (cls.class === 'success') return result
 │     ├── if (cls.class === 'permanent') return result          // 不重试
 │     ├── if (!shouldRetry(cls, attempt, MAX_ATTEMPTS)) return result  // 额度耗尽
 │     │
 │     └── continue  // transient + 可重试 → 下一轮
 │
 └── return lastResult  // 循环自然结束（MAX_ATTEMPTS 用尽）
```

## 4. 关键决策

### 4.1 不在 spawn 层主动 `delete opts.env.CECELIA_CREDENTIALS`

**偏离原 PRD**。原 roadmap §Phase A 建议 transient 后删 env 强制换号；实际代码调研后发现：

- **cap 场景**：`cap-marking` 已把 capped account 标记；next attempt 的 `resolveAccount` 会读 `isSpendingCapped(explicit) → true → 自动换号`。spawn 层无须干预。
- **non-cap transient**（ECONNREFUSED / ETIMEDOUT / exit_code=124）：换号无益，保留同账号重试更合理（网络问题就地恢复）。

**结论**：spawn 层只做循环控制，"用哪号"交给 account-rotation middleware 自己判。此决策需在 spawn.js 顶部加 JSDoc 注释防未来被"修"回。

### 4.2 MAX_ATTEMPTS = 3（常量）

- 导出为 `SPAWN_MAX_ATTEMPTS`（或 module-level const + JSDoc），便于 spawn.test.js 引用
- JSDoc 说明：dispatch 层（executor.js）已有独立 `failure_count` retry，最坏情况 3×3=9 次。本 PR 不改 dispatch 层，仅注释风险

### 4.3 无 sleep / backoff

- docker spawn 本身 2-5s，天然节流足够
- exponential backoff 留给 Phase E Observer 统一处理

### 4.4 caller 行为保持

`harness-initiative-runner.js` 等调用方 `await spawn(opts)` → 返回结果结构（exit_code/stdout/stderr/timed_out 等）未变。调用方仍按 exit_code 判成败，不感知内部 attempt 次数。

## 5. 实施

### 5.1 改动文件

| 文件 | 变化 | 预计行数 |
|---|---|---|
| `packages/brain/src/spawn/spawn.js` | 加 for 循环 + classifyFailure/shouldRetry 调用 + JSDoc | 31 → ~75 |
| `packages/brain/src/spawn/__tests__/spawn.test.js` | 3 cases → 7 cases | 36 → ~220 |

### 5.2 spawn.js 伪码

```javascript
import { executeInDocker } from '../docker-executor.js';
import { classifyFailure, shouldRetry } from './middleware/retry-circuit.js';

const SPAWN_MAX_ATTEMPTS = 3;

/**
 * Brain v2 Layer 3 入口。
 * 内层 attempt-loop：对每次失败调 classifyFailure 三态判定。
 *
 * 换号策略说明：transient 失败后不主动删 opts.env.CECELIA_CREDENTIALS。
 * cap 场景由 cap-marking + account-rotation 协作自愈；
 * non-cap transient（网络/超时）保留同账号就地重试——这是刻意的。
 *
 * MAX_ATTEMPTS=3 与 dispatch 层 failure_count（也为 3）独立，最坏 3×3=9 次外层 retry。
 */
export async function spawn(opts) {
  let lastResult = null;
  for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
    const result = await executeInDocker(opts);
    lastResult = result;
    const cls = classifyFailure(result);
    if (cls.class === 'success') return result;
    if (cls.class === 'permanent') return result;
    if (!shouldRetry(cls, attempt, SPAWN_MAX_ATTEMPTS)) return result;
  }
  return lastResult;
}
```

### 5.3 spawn.test.js 7 cases

| # | 场景 | mock executeInDocker 序列 | 断言 |
|---|---|---|---|
| 1 | success first try | `[{exit_code:0}]` | 调用 1 次，返回该 result |
| 2 | transient→success | `[{timed_out:true}, {exit_code:0}]` | 调用 2 次，返回第二个 result |
| 3 | transient × 3 give up | `[{timed_out:true} × 3]` | 调用 3 次，返回最后 result |
| 4 | permanent 不重试 | `[{exit_code:137}]` | 调用 1 次，返回该 result |
| 5 | 429 transient → spawn 不删 env | `[{stderr:'429', exit_code:1}, {exit_code:0}]` | 调用 2 次；断言 `opts.env.CECELIA_CREDENTIALS` 仍 === 初始值（证明 spawn 层未主动 delete；真正的换号责任留给内层 account-rotation，在此 mock 边界外不验证） |
| 6 | shouldRetry 返回 false 提前退 | mock `shouldRetry` 固定返回 false；序列 `[{timed_out:true}, ...]` | 调用 1 次，返回该 result |
| 7 | MAX_ATTEMPTS 边界 | 每次 transient；验证 `executeInDocker.mock.calls.length === 3` | 恰好 3 次 |

Mock 模式沿用 PR #2543 建立的 `vi.mock('../../docker-executor.js')` + `vi.mock('../middleware/retry-circuit.js')`。

### 5.4 验证现有测试不退化

- `packages/brain/src/spawn/__tests__/spawn.test.js` 现有 3 cases 调整（不 retry 的场景仍需 pass，即 success first try / pass through opts / return result unchanged）
- `docker-executor-account-rotation.test.js` / `cap-marking.test.js` 等不动

## 6. 成功标准

1. attempt-loop 在 `spawn.js` 真实存在（`grep 'for (let attempt'` hit）
2. 7 cases 全 pass（vitest）
3. classifyFailure / shouldRetry 使用路径激活（retry-circuit.js 不再死代码）
4. 现有 middleware 测试不退化
5. spawn.js ≤ 150 行
6. JSDoc 注释完整（换号策略 + MAX_ATTEMPTS 关系）

## 7. 不做

- executeInDocker 内部逻辑不动
- classifyFailure / shouldRetry 实现不动（PR #2550 定稿）
- env 变量 / feature flag 不新增
- caller（harness-initiative-runner / content-pipeline）不改
- observability（metrics / 日志格式）留 Phase E
- dispatch-level retry count 不统一（留 Phase B 讨论）

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 3×3=9 外层 retry 放大 LLM 额度消耗 | JSDoc 注释说明；后续 Phase 可考虑把 dispatch failure_count 改为 2 |
| classifyFailure 对新 permanent pattern 漏判（如 skill 不存在） | 合并后 24h 监控 spawn 日志，发现即补正则 |
| 测试 mock 多层（executeInDocker + retry-circuit）易误 | 每 case 写独立 `beforeEach` 清 mock；断言调用次数而非 implementation detail |
| spawn.js 行数超标 | 目标 ~75 行，硬上限 150；超则抽 helper |

## 9. 回滚

- spawn.js 退回 `return executeInDocker(opts)` 即可（单行）
- spawn.test.js 保留 7 cases 不影响（3 cases 是其中子集）
