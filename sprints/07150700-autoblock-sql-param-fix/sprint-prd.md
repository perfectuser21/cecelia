# Sprint PRD：autoblock 计数 SQL 参数类型修复

**Sprint ID**: 07150700-autoblock-sql-param-fix
**Task ID**: ba0a2bdc-ed83-4091-9cef-7269a95be658
**日期**: 2026-07-15
**状态**: READY
**前序 Sprint**: 07141332-dispatch-fail-autoblock

---

## 一、背景与症状

### 07-15 晨实证

task `008c23db`（research 类型）派发连炸 **16 次**，熔断 OPEN，队列瘫痪 **4.5 小时**
（刀A1/A3 排队无人处理），靠人工 `block` 止血——这是第二次重演。

Brain 日志每 tick 出现：

```
[dispatch] dispatch-fail-autoblock counter update failed (non-fatal):
could not determine data type of parameter $2
```

根因：#07141332-dispatch-fail-autoblock 虽已实现 autoblock 骨架，但计数 SQL 的
**`$2` 参数类型 PostgreSQL 无法自动推断**，每次计数写入必然抛出 `PGError`。
由于 catch 块把异常标记为 `non-fatal`，程序不崩溃但计数从未写入，
阻断条件永远不满足，导致 autoblock 整体形同虚设。

### 问题 SQL（`dispatcher.js` line 800）

```sql
UPDATE tasks
SET metadata = COALESCE(metadata, '{}'::jsonb)
           || jsonb_build_object('dispatch_fail_consecutive', $2)
WHERE id = $1
```

参数：`[nextTask.id, newCount]`（`newCount` 为 JS `number`）

`jsonb_build_object` 的 value 参数在没有显式类型约束时，PostgreSQL 无法从函数签名
推断 `$2` 的类型，抛出 `could not determine data type of parameter $2`。

---

## 二、目标与约束

### 目标
修复计数 SQL 的参数类型错误，使 autoblock 自动隔离真正生效，并以真实 SQL 集成测试
永久锁死，杜绝同类哑火回归。

### 铁律（不可违反）
1. **只改计数 SQL 与其测试**——不动阈值、熔断、候选选择任何语义
2. **非 fatal 吞错保留**——catch 块必须保留，但 `console.error` 改为
   `console.warn` + 附带 `task_id`，方便告警定位
3. **不 mock `pool.query` 的 SQL 执行**——新集成测试必须走真实 pg 或 pg-mem；
   正是 mock 屏蔽了这次 bug（既有 dispatch-fail-autoblock.test.js 全 mock 未能捕获）
4. **既有测试全过**——既有 `dispatch-fail-autoblock.test.js` + dispatcher 其他测试不得变红

---

## 三、功能需求（FR）

### FR-1 修复失败计数 SQL（`$2` 类型推断）

**现状**（line 800，有 bug）：
```sql
UPDATE tasks
SET metadata = COALESCE(metadata, '{}'::jsonb)
           || jsonb_build_object('dispatch_fail_consecutive', $2)
WHERE id = $1
```
参数：`[nextTask.id, newCount]`

**修复方案 A（推荐）——显式 cast**：
```sql
UPDATE tasks
SET metadata = COALESCE(metadata, '{}'::jsonb)
           || jsonb_build_object('dispatch_fail_consecutive', $2::int)
WHERE id = $1
```

**修复方案 B（备选）——整合进 jsonb 对象参数**：
```sql
UPDATE tasks
SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
WHERE id = $1
```
参数：`[nextTask.id, JSON.stringify({ dispatch_fail_consecutive: newCount })]`

实现选 A 或 B 均可，须在 PR 描述中注明选择理由。

### FR-2 修复成功重置 SQL（同类风险确认）

成功路径重置 SQL（line 859）：
```sql
UPDATE tasks
SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
WHERE id = $2
```
参数：`[{ dispatch_fail_consecutive: 0 }, nextTask.id]`

此处已有 `$1::jsonb` 显式 cast，传入 JS 对象会被 pg 驱动序列化为 JSON 字符串再 cast，
**不触发类型推断失败**——但需在集成测试中验证路径确实执行成功，不得依赖 mock。

### FR-3 新增集成测试（真 pg 或 pg-mem，禁止 mock SQL）

测试文件：`packages/brain/src/__tests__/autoblock-sql-integration.test.js`

覆盖以下 3 个路径：
- **GP-1**：调用计数函数（或直接执行该 SQL）N 次 → 不抛类型错误，`metadata.dispatch_fail_consecutive` 为正确整数
- **GP-2**：连续 3 次失败路径（不 mock SQL）→ task `status='blocked'`，`blocked_reason='dispatch_fail_autoblock'`
- **GP-3**：成功路径 reset SQL → `dispatch_fail_consecutive` 归零，不抛错

### FR-4 console.warn 带 task_id

`catch (autoblockErr)` 块改为：
```js
console.warn(`[dispatch] dispatch-fail-autoblock counter update failed (task ${nextTask.id}) (non-fatal): ${autoblockErr.message}`);
```

---

## 四、Golden Path（测试先行）

### GP-1：计数 SQL 写入不抛类型错误（集成，真 pg）

```
arrange: 真实 pg 连接 + 测试 DB，tasks 表有一行 id=test_id, metadata={}
act:     直接执行修复后的 UPDATE SQL，参数 [test_id, 1]
assert:  不抛 PGError
         SELECT metadata FROM tasks WHERE id=test_id → dispatch_fail_consecutive = 1
act:     再执行一次，参数 [test_id, 2]
assert:  dispatch_fail_consecutive = 2
```

### GP-2：真实 DB 路径——3 次失败 → task blocked（集成，真 pg）

```
arrange: 真实 pg 连接，task 处于 queued 状态
act:     模拟 triggerCeceliaRun 失败 3 次（不 mock SQL，只 mock executor 返回值）
assert:  SELECT status, blocked_reason FROM tasks WHERE id=...
         → status='blocked', blocked_reason='dispatch_fail_autoblock'
```

### GP-3：成功重置 SQL 同样无类型错误（集成，真 pg）

```
arrange: task metadata.dispatch_fail_consecutive = 2
act:     执行成功路径 reset SQL
assert:  dispatch_fail_consecutive = 0，无抛错
```

---

## 五、验收标准（DoD）

| # | 条件 | 验证方式 |
|---|------|---------|
| 1 | failing 集成测试先 commit（GP-1/2/3 全红） | CI `packages/brain` test suite |
| 2 | 修复 SQL cast 后集成测试全绿 | GP-1/2/3 通过 |
| 3 | 既有 `dispatch-fail-autoblock.test.js` 全过 | CI 不红 |
| 4 | `console.warn` 输出含 task_id | 代码审查 |
| 5 | CI 全绿（brain-ci.yml） | GitHub Actions |

---

## 六、非功能需求（NFR）

- **回归保护**：新集成测试进 CI，永久运行（不允许删除）
- **修复范围**：仅 SQL 参数类型；autoblock 阈值/熔断/候选选择语义保持不变
- **可观测**：`console.warn` 在异常时必须含 task_id，便于日志搜索定位

---

## 七、实现范围

### 改动文件

| 文件 | 改动说明 |
|------|---------|
| `packages/brain/src/dispatcher.js` | line 800：`$2` 改为 `$2::int`（或 B 方案整体重排）；catch 块加 task_id |
| `packages/brain/src/__tests__/autoblock-sql-integration.test.js` | 新增集成测试（GP-1/2/3，真 pg 或 pg-mem） |

### 不动文件

- `dispatch-fail-autoblock.test.js`：既有单测继续运行，不改
- `circuit-breaker.js`、`dispatch-helpers.js`、`task-updater.js`：不动
- `alerting.js`：不动

---

## 八、不变量（Invariants）

1. **IN-1**：计数 SQL 执行后不抛 `could not determine data type of parameter` 错误
2. **IN-2**：`metadata.dispatch_fail_consecutive` 写入值为整数类型
3. **IN-3**：连续 3 次失败（非 configError、非 spawn_deduplicated）必然触发 blockTask
4. **IN-4**：非 fatal 异常路径（catch 块）保留，但输出 `console.warn` 含 task_id
5. **IN-5**：成功重置 SQL（line 859，`$1::jsonb`）保持不变（已正确 cast）
6. **IN-6**：集成测试不 mock `pool.query` 的 SQL 执行层

共 **6 条不变量**，**4 条 FR**。

---

## 九、累积 FR 追踪

| Sprint | FR | 描述 |
|--------|-----|------|
| 07141331-research-dispatch-payload | FR-A | buildCodexBridgePayload 补 callback_url |
| 07141332-dispatch-fail-autoblock | FR-1~5 | dispatcher 坏任务自动隔离（骨架实现）|
| **07150700-autoblock-sql-param-fix** | **FR-1~4** | 计数 SQL $2 参数类型修复（本 Sprint）|

累积 FR 总数：**10**（含前序 Sprint 6 条）

---

*生成时间：2026-07-15 | Brain Task: ba0a2bdc*

journey_type: bugfix
target_environment: local_api
