# Sprint PRD — Pool C 等待态：等 CI/等 merge 任务不占执行槽（纸面满根治第二层）

## OKR 对齐

- **对应 KR**：Cecelia 自动派发吞吐量防退化（工厂线连续 ≥24h 无因 pool_c_full 空转）
- **当前进度**：2026-07-17 夜 12h 实证：pool_c_full 拒发 25 次居榜首，slots API 显示 4/5 占用但仅 1 活容器
- **本次推进预期**：3 个等 CI 的空壳任务不再计入 Pool C 使用量，pool_c_full 拒发归零

## 背景与根因

**实证数据**：2026-07-17 夜 12h，Brain 调度日志中 pool_c_full 拒发 25 次，占拒发榜首。`/api/brain/slots` 显示 taskPool.used=4（总预算 5），但 `docker ps` 仅见 1 个活跃容器。差值 3 个任务均处于「PR 已开，等 CI 跑完 / 等 auto-merge」阶段，任务 status 仍为 `in_progress`，被 `countAutoDispatchInProgress()` 全部计入，从而把真实可用槽清零。

**根因**：`countAutoDispatchInProgress()` 统计 `status='in_progress'` 的所有非 Cecelia 任务，不区分「容器在跑真正消耗资源」vs「任务已无活跃容器，只是被动等 CI 流水线」。这两种语义的耗资源量天壤之别，却被同一个计数器合并，导致 Pool C 纸面满。

**此前修复（beeba317）**：已为 harness_initiative 专属的 harnessSlotCheck 引入真实容器计数（relay_count + inflight）。本任务把同等思路推广到通用 Pool C 计数，解决非 harness 任务（或 harness 任务的等待阶段）对 countAutoDispatchInProgress 的污染。

## Golden Path（核心场景）

**工厂调度员视角**：3 个任务 PR 已开在等 CI，1 个任务在真正跑 → Pool C available 显示 1（或更多），Brain 继续派发新任务，工厂不停摆。

具体流程：
1. 任务 PR 开出（watchdog/relay 检测到 PR_URL + CI pending/green 状态）
2. 任务 status 转入 `waiting_ci`（或 metadata 打标，由 ④ 侵入最小原则决定具体方案）
3. `countAutoDispatchInProgress()` 排除 `waiting_ci` 状态任务
4. `calculateSlotBudget()` 的 taskPool.available 正确反映真实活跃任务数
5. dispatcher 可继续派发新任务，不再产生 pool_c_full 拒发
6. PR merge / CI 失败 → 任务转回 `in_progress` 或终态，等待态槽位释放

## 功能需求（FR）

### FR-1：等待态定义与 status 方案选择

**决策原则**：侵入最小——先考古 status 枚举与所有 `status='in_progress'` 查询点（全仓 grep），再二选一：

- **方案 A（新 status 值 `waiting_ci`）**：在 task-updater.js 的 `VALID_STATUSES` 数组加入 `'waiting_ci'`；所有消费 `in_progress` 的查询点逐一分类（计数 vs 生命周期）；Pool C 计数查询改为 `status = 'in_progress'`（排除 `waiting_ci`）。**优点**：语义清晰，DB 层可直接索引；**风险**：需逐一审计 ≥30 处 in_progress 查询点，改动面广。

- **方案 B（metadata 标记 `payload->>'waiting_ci'='true'`）**：tasks status 不变，Pool C 计数查询额外过滤 `AND (payload->>'waiting_ci' IS NULL OR payload->>'waiting_ci' != 'true')`。**优点**：改动面小，不触碰 status 枚举；**风险**：DB 查询多一条 JSONB 过滤，逻辑散落 payload。

**Planner 决策**：在审计全仓 grep in_progress 结果后，以侵入最小为准则选择方案，并在实现说明中记录决策及理由。

### FR-2：转入点（marking → waiting_ci）

**触发源**：harness-relay-watchdog.js 中已存在「CI pending → continue（跳过重点火）」逻辑（第 421-424 行）。在该 continue 前写入等待标记。

转入条件（满足其一）：
- `ciStatus === 'pending'` 且非 `isDirty`（CI 跑中，等 CI）
- `ciStatus === 'green'` 且 `evaluatorDoneGreen === true`（evaluator 完成，等 merge）

转入操作：
- 方案 A：`UPDATE tasks SET status='waiting_ci' WHERE id=$1 AND status='in_progress'`
- 方案 B：`UPDATE tasks SET payload=payload || '{"waiting_ci":"true"}'::jsonb WHERE id=$1`

同时写入活性判据字段（PR 号 + 最后检查时间），用于 reaper 存活检测（见 FR-4）。

### FR-3：转出点（waiting_ci → 终态或 in_progress）

| 触发事件 | 目标状态 |
|---|---|
| PR MERGED（`_finalizeMergedRun` 已有路径） | `completed`（已有逻辑，无需改动） |
| PR CLOSED（工作否决） | `failed`（已有逻辑，确认 waiting_ci 情况下也能触发） |
| CI 失败（red）→ 需重点火 | 回 `in_progress`（清除等待标记），watchdog 走重点火分支 |
| Brain 重启（startup-sync.js）→ 扫 waiting_ci | 重分类：green_waiting_merge → 回 waiting_ci 保持；ci_red → 回 in_progress；unknown → 保守保持 waiting_ci |

### FR-4：守卫——等待态僵尸防护

**问题背景**：worktree-reaper 案底（memory worktree-reaper-active-issue）显示，「全 commit 干净 worktree」是守卫盲区——仅看 worktree 状态无法判断任务是否真在推进。等待态任务如果 PR 被意外 close 且 watchdog 未追到，将永久滞留。

**守卫机制**：
- 转入 waiting_ci 时，同步写入 `payload.waiting_ci_since`（Unix timestamp）和 `payload.waiting_pr_url`
- zombie-reaper.js 新增一条检测分支：扫描 `waiting_ci` 状态（或 `payload.waiting_ci='true'`）且 `waiting_ci_since < NOW() - INTERVAL '6 hours'` 的任务
- 对命中任务：调用 `gh pr view` 核查 PR 真实状态；MERGED → 走 finalizeMergedRun；CLOSED → 标 failed；OPEN 且 CI 仍在跑 → 更新 waiting_ci_since 续期（最长 24h 总守卫窗口）；超过 24h 强制标 failed + error_message 注明 waiting_ci_timeout

### FR-5：兼容性逐点核对（全仓 grep in_progress）

以下查询点需分类确认「是否需要纳入/排除 waiting_ci」：

| 文件 | 位置 | 语义 | waiting_ci 处理 |
|---|---|---|---|
| slot-allocator.js:233 | `countAutoDispatchInProgress` Pool C 计数 | 资源占用计数 | **排除**（核心改动） |
| slot-allocator.js:216 | `countCeceliaInProgress` | Cecelia 内部任务计数 | 排除（Cecelia 任务不走 waiting_ci） |
| slot-allocator.js:646 | `harnessSlotCheck` inflight grace 查询 | 超短宽限期防超发 | **排除**（waiting_ci 不在宽限期内） |
| harness-watchdog.js:150,206,272 | 巡检活跃任务 | 健康检测，应看 all in-flight | **纳入**（waiting_ci 任务需被 watchdog 看到） |
| zombie-reaper.js:79,126,141 | 扫僵尸 | 生命周期管理 | **纳入**（waiting_ci 需独立守卫逻辑，见 FR-4） |
| startup-sync.js:37 | 启动恢复 | 重点火候选扫描 | **纳入** waiting_ci（需做再分类，green → 保持等待，red → 重点火） |
| dispatcher.js:535,563 | 派发候选/去重 | 派发防重 | **纳入**（waiting_ci 任务已有 PR，禁止重派） |
| harness-relay-watchdog.js:204,205,356,493,559 | 状态更新 | 完成/失败写回 | **兼容**（WHERE status='in_progress' 需扩展为 OR status='waiting_ci'） |
| area-scheduler.js:65 | 看板统计 running | 展示 | 按需——waiting_ci 可单独计一列 |
| health-monitor.js:65 | 健康监控 in_progress | 监控指标 | **纳入**（waiting 也是活跃任务） |
| eviction.js:132 | 驱逐 | 高优抢占 | 排除（waiting_ci 不应被驱逐） |
| nightly-tick.js:29 | 夜报统计 | 报表展示 | waiting_ci 单独统计列 |
| actions.js:343,369 | updateTask 校验 | 状态流转 | 需允许 in_progress → waiting_ci 转换 |
| decision.js:70,117,145 | OKR 进度计算 | OKR 统计 | **纳入**（waiting_ci 视为进行中） |
| task-updater.js:13 | VALID_STATUSES 校验 | 安全白名单 | 方案 A：加入 'waiting_ci' |

### FR-6：Slots API 扩展

`GET /api/brain/slots` 返回的 `task_pool` 段新增 `waiting` 字段：

```json
{
  "task_pool": {
    "budget": 5,
    "used": 1,
    "waiting": 3,
    "available": 4
  }
}
```

- `waiting`：当前 waiting_ci 状态任务数
- `used`：仅计 `in_progress`（活跃执行）任务数
- `available = budget - used - userReserve`（不含 waiting）

### FR-7：Brain 版本 bump

改动涉及 slot-allocator.js（核心计数逻辑），按 semver bump patch 版本：`1.267.2 → 1.268.0`（功能性变更，minor bump）。

## Invariant 约束

### 关联 Pool C / 调度 / Slot / Waiting 的系统 Invariant

- INV-cec579d2: 产能配比政策线（本周）：工厂 70% / 业务 30%——planner/排序官按此配比取格子；本次 waiting_ci 改动使更多格子真正可用，不得打破此配比约束。
- INV-7ccfa168: 单 slot 串行任务，并行只许跨 slot——同一 slot 内严格串行，等待态任务（waiting_ci）占槽不跑实际代码，仍算「占用该 slot」，不得用 waiting_ci 绕过此串行规则在同 slot 塞入第二个活跃任务。
- INV-dc18d43d: 无闸不成文——pipeline 生命周期/记账/验收判据一律下沉代码——waiting_ci 状态转入/转出逻辑、Pool C 计数排除逻辑必须写进代码（slot-allocator.js / harness-relay-watchdog.js），不得靠运行时人工操作或文档约定替代。
- INV-c1d0abce: 替换核心驱动/调度器必清孤儿——改动 countAutoDispatchInProgress() 时，必须 grep 所有消费 `in_progress` 的查询点逐一确认兼容（本 PRD FR-5 已枚举），不得留下孤立的旧计数点。
- INV-e90c0fbb: relay watchdog pr_url 未写回缺口——转入 waiting_ci 时必须同步写 pr_url 到 tasks 表，否则 watchdog 再次扫到该任务时因缺 pr_url 误判，导致重复 spawn。
- INV-b0b2d702: harness pipeline 禁用于 infrastructure 仓库——本 sprint 属 infrastructure 类改动（Brain 后端调度），验收走 local_api，不套 harness-controller 完整流水线（已在 journey_type 段确认）。

### 代码层约束（slot-allocator.js / task-updater.js）

- **VALID_STATUSES 白名单（task-updater.js:13）**：当前枚举为 `['queued', 'in_progress', 'completed', 'failed', 'pending_postdeploy']`，不含 `waiting_ci`——方案 A 必须在此处新增，否则所有 `UPDATE … SET status='waiting_ci'` 会被安全校验层拒绝并抛错。
- **countAutoDispatchInProgress 查询边界（slot-allocator.js:229-241）**：当前 WHERE 子句 `status = 'in_progress'` 不区分「容器活跃」vs「passive 等 CI」——本次核心改动即修改此处，修改后必须保证排除 waiting_ci 行（方案 A）或排除 `payload->>'waiting_ci'='true'` 行（方案 B）。
- **三池优先级约束（slot-allocator.js:9）**：`Priority: User (B) > Cecelia (A) > Task Pool (C)`，Pool C available 计算必须在 B、A 扣除后进行，waiting_ci 任务不得影响 B/A 池计数，只影响 C 池的 used 字段（改动后 C.used 减少，C.available 增加）。

### 其余系统 Invariant（43 条）已在设计中遵守

其余 43 条系统 invariant（含凭据安全、租户隔离、鉴权、PII 脱敏、真环境验证等）与本次 Pool C 等待态改动无直接交叉，设计已默认遵守，不逐条展开。

## 铁律

1. **禁 mock 判定与数据源的边**：测试中不允许通过 mock 让「waiting_ci 任务」凭空变成「不存在的任务」——DB mock 必须真实返回 waiting_ci 行，Pool C 计数函数必须真实排除它。

2. **先写 failing test**：在改动 slot-allocator.js 前，先在 `slot-accounting.test.js`（或新建 `pool-c-waiting-state.test.js`）写入 4 个场景验证（红状态）：
   - 场景1：3 个 waiting_ci + 1 个 in_progress → Pool C available 按 1 计算（排除 waiting）
   - 场景2：0 个 in_progress + 3 个 waiting_ci → available = effectiveSlots（不被 waiting 拖零）
   - 场景3：waiting_ci 任务在 dispatcher 去重列表中仍可见（防止重复派发）
   - 场景4：waiting_ci 超过 6h 守卫窗口时，reaper 能扫到并处理

3. **既有测试不能破**：slot-allocator.test.js（1396 行）、slot-accounting.test.js（173 行）、dispatcher.test.js、harness-slot-check.test.js 全部通过。

## NFR 约束

- **侵入最小**：方案选择以改动影响文件数最少为准则（方案 B 预计影响 3 文件，方案 A 预计影响 8+ 文件）
- **DB 查询开销**：JSONB 过滤（方案 B）在 tasks 表行数 < 10k 时无性能问题；若超过，需在 payload 上建部分索引
- **等待态窗口**：单任务 waiting_ci 最长存活 24h，超时强制 failed，防止守卫盲区永久阻塞
- **Brain 重启安全**：startup-sync.js 扫描 waiting_ci 任务时，green_waiting_merge 保持等待，ci_red 回 in_progress，其余保守保持（不盲目重点火）
- **可观测**：slots API 新增 waiting 字段，看板可区分「在跑」vs「等 CI」计数

## 预期受影响文件

**核心改动（必须）**：
- `packages/brain/src/slot-allocator.js`：`countAutoDispatchInProgress()` 排除 waiting 态；`getSlotStatus()` 新增 waiting 字段
- `packages/brain/src/task-updater.js`：`VALID_STATUSES` 加 `'waiting_ci'`（方案 A）
- `packages/brain/src/harness-relay-watchdog.js`：转入点标记（CI pending / green+evaluatorDone → waiting_ci）
- `packages/brain/src/__tests__/pool-c-waiting-state.test.js`（新建）或扩展 slot-accounting.test.js：4 场景 failing-first 测试

**兼容性审计（按 grep 结果确认是否改动）**：
- `packages/brain/src/zombie-reaper.js`：新增 waiting_ci 守卫分支
- `packages/brain/src/startup-sync.js`：扩展扫描范围到 waiting_ci，加再分类逻辑
- `packages/brain/src/eviction.js`：确认 waiting_ci 不在驱逐范围
- `packages/brain/src/harness-watchdog.js`：确认 WHERE 子句覆盖 waiting_ci（健康巡检需看到）
- `packages/brain/package.json`：版本 bump 1.267.2 → 1.268.0

## E2E 验收

> target_environment=local_api，Brain 本地运行，验收通过 Brain API + DB 直查。

```bash
# 验收 1：Pool C 等待态不计入 available（核心）
# 前置：向 DB 插入 3 条 status='waiting_ci' 的 auto-dispatch 任务 + 1 条 status='in_progress'
# 期望：GET /api/brain/slots → task_pool.used=1, task_pool.waiting=3, task_pool.available≥1
# 实现：由 Proposer 产出完整 curl+jq 断言脚本

# 验收 2：生产复现消失
# 前置：模拟 4 个任务 3 个 PR 已开（等 CI），Brain 派发触发
# 期望：pool_c_full 不再出现在 dispatch_stats 日志
# 实现：curl localhost:5221/api/brain/dispatch/stats?window=1h | jq '.reasons.pool_c_full // 0' == 0

# 验收 3：slots API waiting 字段
# GET /api/brain/slots | jq '.pools.task_pool.waiting' → 数值（非 null/undefined）

# 验收 4：waiting_ci 守卫（6h 超时）
# DB 插入 waiting_ci_since = NOW() - INTERVAL '7 hours' 的任务
# 触发 zombie-reaper tick
# 期望：任务转为 failed，error_message 包含 'waiting_ci_timeout'
```

## journey_type: infrastructure
## journey_type_reason: 纯 Brain 后端调度逻辑变更，无前端界面，验收通过 API + DB 直查，target_environment=local_api
## target_environment: local_api
## target_environment_reason: Brain 本地运行（localhost:5221），不涉及浏览器/UI，验收走 curl/jq 脚本直打 Brain API
