# Contract Draft: 刀A5 — gh pr checks 非零退出码容错

**Task ID**: b5162377-4012-424a-ba2f-0b33003eb602
**Sprint Dir**: sprints/07151530-watchdog-ghchecks-exitcode
**Target Environment**: local_api（纯 Node.js 单测，vitest）
**Date**: 2026-07-15

---

## 背景

`harness-relay-watchdog.js` 在处理 PR OPEN 死局时，需要调用 `gh pr checks` 查询 CI 状态。但 `gh pr checks` 在 CI 有 pending 或 failure 时会以**非零退出码**结束（exit 8 / exit 1），`execSync` 遇到非零退出会 `throw`，Error 对象携带 `stdout` 属性（含 JSON 格式的检查数据）。

第 30-37 行已实现 `execTolerant` 函数来兜底：

```js
function execTolerant(execFn, cmd) {
  try {
    return execFn(cmd);
  } catch (err) {
    if (typeof err.stdout === 'string' && err.stdout.length > 0) return err.stdout;
    throw err;
  }
}
```

**问题**：现有测试的 `makeDeps.execFn` mock 对 `gh pr checks` 始终正常返回字符串，从未模拟非零退出抛出 `err.stdout` 的场景。`execTolerant` 兜底路径无测试覆盖，导致 PR #3971（BEHIND+容器消亡死局）被误判为查询失败而保守跳过，重点火未触发。

**Brain 日志实录**：
```
[relay-watchdog] CI 状态查询失败，initiative=5e9c0496… 保守跳过: Command failed: gh pr checks "…/pull/3971" --json state
```

---

## Golden Path Steps

### GP-A：execFn 抛 err + err.stdout 含 FAILURE → ciStatus='fail' → spawnFn 被调用（resume_ci_red）

| # | 步骤 | 验证命令 |
|---|------|----------|
| A-1 | 构造 execFn：`gh pr checks` 抛出 `{ message: '...', stdout: JSON.stringify([{ state: 'FAILURE' }]) }` | 目测 execFn mock 定义 |
| A-2 | `gh pr view` 正常返回 `{ state: 'OPEN', mergeStateStatus: 'CLEAN' }` | 目测 execFn mock 定义 |
| A-3 | `docker ps` 返回空（容器消失） | 目测 execFn mock 定义 |
| A-4 | `execTolerant` 捕获错误，用 `err.stdout` 兜底返回 JSON 字符串 | `expect(spawnFn).toHaveBeenCalledOnce()` 间接验证 |
| A-5 | `mapCiStatus([{ state: 'FAILURE' }])` 返回 `'fail'` | `expect(r.resumed).toBe(1)` |
| A-6 | `spawnFn` 被调用一次 | `expect(spawnFn).toHaveBeenCalledOnce()` |

### GP-B：execFn 抛 err + err.stdout 全 pending → ciStatus='pending' → spawnFn 不调用（wait_ci_running）

| # | 步骤 | 验证命令 |
|---|------|----------|
| B-1 | 构造 execFn：`gh pr checks` 抛出 `{ stdout: JSON.stringify([{ state: 'IN_PROGRESS' }]) }` | 目测 execFn mock 定义 |
| B-2 | `gh pr view` 正常返回 `{ state: 'OPEN', mergeStateStatus: 'CLEAN' }` | 目测 execFn mock 定义 |
| B-3 | `execTolerant` 捕获错误，用 `err.stdout` 兜底 | `expect(spawnFn).not.toHaveBeenCalled()` 间接验证 |
| B-4 | `mapCiStatus([{ state: 'IN_PROGRESS' }])` 返回 `'pending'` | `expect(r.resumed).toBe(0)` |
| B-5 | `spawnFn` 不被调用 | `expect(spawnFn).not.toHaveBeenCalled()` |

### GP-C：execFn 抛 err + 无 stdout（真查询失败）→ 保守跳过 → spawnFn 不调用（skip_query_failure）

| # | 步骤 | 验证命令 |
|---|------|----------|
| C-1 | 构造 execFn：`gh pr checks` 抛出无 `stdout` 属性的错误 | 目测 execFn mock 定义 |
| C-2 | `gh pr view` 正常返回 `{ state: 'OPEN' }` | 目测 execFn mock 定义 |
| C-3 | `execTolerant` 无兜底数据，rethrow 原错误 | `expect(spawnFn).not.toHaveBeenCalled()` 间接验证 |
| C-4 | 外层 `catch (ciErr)` 触发保守跳过 | `expect(r.resumed).toBe(0)` |
| C-5 | `spawnFn` 不被调用 | `expect(spawnFn).not.toHaveBeenCalled()` |

### GP-R：既有正常路径测试全过（回归）

| # | 步骤 | 验证命令 |
|---|------|----------|
| R-1 | 运行既有 harness-relay-watchdog.test.js 所有用例 | `npx vitest run src/__tests__/harness-relay-watchdog.test.js` |
| R-2 | 0 failures | 退出码 0 |

---

## 真实调用方请求 shape

```js
// 真实场景：execSync 抛出非零退出码错误
const err = new Error('Command failed: gh pr checks "https://github.com/org/repo/pull/3971" --json state\nexit code 1');
err.stdout = JSON.stringify([{ name: 'brain-ci', state: 'FAILURE', conclusion: 'FAILURE' }]);
err.stderr = '';
err.status = 1;
throw err;
```

`execTolerant` 预期行为：
- `err.stdout` 非空字符串 → 返回 `err.stdout`（兜底）
- `err.stdout` 为空字符串 / undefined → `throw err`（rethrow）

---

## 运行时守卫（probe 或 waiver）

| 守卫 | 类型 | 内容 |
|------|------|------|
| execTolerant 存在 | probe | `grep -n "execTolerant" packages/brain/src/harness-relay-watchdog.js` 第 30 行 |
| execTolerant 在 gh pr checks 调用处生效 | probe | `grep -n "execTolerant(execFn" packages/brain/src/harness-relay-watchdog.js` 含 gh pr checks |
| 测试框架 | probe | `packages/brain/package.json` 含 `"vitest": "^1.6.1"` |
| N/A: 不依赖外部 gh CLI | waiver | 测试完全 mock execFn，不调用真实 gh |

---

## 未覆盖真实链路清单

| 链路 | 状态 | 原因 |
|------|------|------|
| 真实 `gh pr checks` CLI 调用 | N/A | local_api 单测不调用真实 gh，完全 mock execFn |
| Docker 容器存活真实探测 | N/A | execFn mock 控制 `docker ps` 返回 |
| DB 真实写入 | N/A | pool mock 控制，local_api 单测不连真实 DB |
| `spawnSkillRelaySession` 真实 spawn | N/A | spawnFn mock 验证调用行为 |

---

## E2E 验收

target_environment: local_api（vitest 单测）

```bash
# E2E 验收命令（在 /workspace/packages/brain 执行）

# Step 1：运行新增合同测试（TDD Red → 期望当前为红）
cd /workspace/packages/brain
npx vitest run ../../sprints/07151530-watchdog-ghchecks-exitcode/tests/harness-relay-watchdog-exitcode.test.js

# Step 2：实现修复后，运行合同测试（期望全绿）
npx vitest run ../../sprints/07151530-watchdog-ghchecks-exitcode/tests/harness-relay-watchdog-exitcode.test.js
# 期望：GP-A / GP-B / GP-C 全部 PASS

# Step 3：运行既有测试（回归保护）
npx vitest run src/__tests__/harness-relay-watchdog.test.js
# 期望：0 failures，所有 describe 块全过

# Step 4：一次性全套验收
npx vitest run src/__tests__/harness-relay-watchdog.test.js ../../sprints/07151530-watchdog-ghchecks-exitcode/tests/harness-relay-watchdog-exitcode.test.js
```

**E2E 断言清单**：
1. GP-A：`spawnFn` 调用次数 === 1，`r.resumed === 1`，日志含 `resume_ci_red`
2. GP-B：`spawnFn` 调用次数 === 0，`r.resumed === 0`，日志含 `wait_ci_running`
3. GP-C：`spawnFn` 调用次数 === 0，`r.resumed === 0`，日志含 `CI 状态查询失败`
4. GP-R：既有全部测试用例 0 failures

---

## 八要素 checklist

| # | 要素 | 状态 | 备注 |
|---|------|------|------|
| 1 | 背景（问题根因） | ✅ | execFn mock 从未抛出，execTolerant 路径无覆盖 |
| 2 | Golden Path Steps（含验证） | ✅ | GP-A/B/C/R 四条，每条含表格式步骤 |
| 3 | 真实调用方请求 shape | ✅ | err.stdout 结构 + execTolerant 预期行为 |
| 4 | 运行时守卫 | ✅ | grep probe + waiver 清单 |
| 5 | 未覆盖真实链路清单 | ✅ | gh CLI / Docker / DB / spawn 全部 N/A |
| 6 | E2E 验收（含可执行 bash） | ✅ | local_api vitest，4 步验收命令 |
| 7 | 判定点登记表 | ✅ | 见下节 |
| 8 | 失败语义声明 | ✅ | 见下节 |

---

## 判定点登记表

| 判定点 ID | 描述 | 判定条件 | 通过标准 |
|-----------|------|----------|----------|
| DP-1 | execTolerant 兜底路径（GP-A） | `gh pr checks` 抛 err，err.stdout 含 FAILURE | `spawnFn` 被调用，`r.resumed === 1` |
| DP-2 | execTolerant 兜底路径（GP-B） | `gh pr checks` 抛 err，err.stdout 含 IN_PROGRESS | `spawnFn` 不被调用，`r.resumed === 0` |
| DP-3 | execTolerant rethrow 路径（GP-C） | `gh pr checks` 抛 err，无 err.stdout | `spawnFn` 不被调用，外层 catch 保守跳过 |
| DP-4 | 正常路径不回归（GP-R） | `gh pr checks` 正常返回（不抛） | 既有测试 0 failures |
| DP-5 | ciStatus 语义映射正确 | FAILURE → 'fail'，IN_PROGRESS → 'pending' | `mapCiStatus` 结果正确 |

---

## 失败语义声明

| 失败场景 | 语义 | 系统行为 | 可接受？ |
|----------|------|----------|---------|
| `gh pr checks` exit 1（有 FAILURE） + execTolerant 失效（未兜底） | 测试红（实现缺陷） | 保守跳过，死局不触发重点火 | ❌ 不可接受 |
| `gh pr checks` exit 8（全 pending） + execTolerant 失效（未兜底） | 测试红（实现缺陷） | 保守跳过（行为与正确一致，但路径错误） | ❌ 不可接受（路径正确性必须保证） |
| `gh pr checks` 真实网络/auth 失败（无 stdout） + 错误被吞 | 测试红（实现缺陷） | 可能误触发重点火 | ❌ 不可接受 |
| 既有 GP-1～GP-4 回归 | 新测试引入副作用 | 原有 resumeStalledRelayRuns 行为改变 | ❌ 不可接受 |
| TDD Red 阶段测试失败（当前状态） | 预期失败 | 测试驱动：红→绿流程正在进行 | ✅ 可接受（Red 阶段） |
