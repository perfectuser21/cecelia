# DoD 清单 — Pool C 等待态（waiting_ci）改革
> Sprint: 07180826-poolc-waiting-state
> Task ID: 327bdebb-0067-4065-9ab4-ed2e0fc372db
> 日期: 2026-07-18

---

## [BEHAVIOR] 条目

### [BEHAVIOR] [BEHAVIOR-1] waiting_ci 任务不计入 Pool C used 槽位

**描述**：`countAutoDispatchInProgress()` 在 WHERE 子句中排除 `status = 'waiting_ci'` 的行，使 waiting_ci 任务不影响 Pool C 的 used 计数。

**验证方式**：
- 单元测试：场景1（3 waiting_ci + 1 in_progress → used=1）
- 单元测试：场景2（0 in_progress + 3 waiting_ci → used=0，available=effectiveSlots）
- E2E：`manual:bash curl localhost:5221/api/brain/slots | jq '.pools.task_pool.used'` 返回 1（非 4）

**相关代码**：`packages/brain/src/slot-allocator.js:countAutoDispatchInProgress()`

**测试文件**：`packages/brain/src/__tests__/pool-c-waiting-state.test.js` 场景1、场景2

---

### [BEHAVIOR] [BEHAVIOR-2] slots API 返回 waiting 字段

**描述**：`GET /api/brain/slots` 响应的 `pools.task_pool` 对象中包含 `waiting` 字段（整数，非 null），代表当前 waiting_ci 状态的 auto-dispatch 任务数。

**验证方式**：
- E2E：`manual:bash curl localhost:5221/api/brain/slots | jq '.pools.task_pool.waiting'` 返回数值（非 null）
- 响应结构断言：`{ budget, used, waiting, available }` 四字段齐全

**相关代码**：`packages/brain/src/slot-allocator.js:getSlotStatus()`

**测试文件**：E2E 验收脚本 验收2

---

### [BEHAVIOR] [BEHAVIOR-3] waiting_ci 任务在 dispatcher 去重列表中可见（防重派）

**描述**：dispatcher 的派发候选去重查询覆盖 `status = 'waiting_ci'`，使已有 PR 的等待态任务不被重复派发。

**验证方式**：
- 单元测试：场景3（waiting_ci 任务 T1 出现在 dispatcher 去重集合中，`duplicateSet.has(T1) === true`）
- 代码审计：`packages/brain/src/dispatcher.js:535,563` 的去重查询 WHERE 子句包含 waiting_ci

**相关代码**：`packages/brain/src/dispatcher.js`

**测试文件**：`packages/brain/src/__tests__/pool-c-waiting-state.test.js` 场景3

---

### [BEHAVIOR] [BEHAVIOR-4] waiting_ci 僵尸守卫：6h 超时检测与处置

**描述**：`zombie-reaper.js` 新增守卫分支，扫描 `waiting_ci_since < NOW() - INTERVAL '6 hours'` 的 waiting_ci 任务，依据 `gh pr view` 结果分别处置：MERGED→completed，CLOSED→failed(pr_closed)，OPEN+running→续期，超 24h 总窗口→failed(waiting_ci_timeout)。

**验证方式**：
- 单元测试：场景4（4 个子场景：MERGED/CLOSED/OPEN/超24h）
- E2E：`manual:bash curl localhost:5221/api/brain/tasks?status=failed | jq '.[] | select(.error_message | contains("waiting_ci_timeout"))'` 返回非空（插入 7h 前 waiting_ci 任务触发 reaper 后验证）

**相关代码**：`packages/brain/src/zombie-reaper.js`

**测试文件**：`packages/brain/src/__tests__/pool-c-waiting-state.test.js` 场景4（含4个子场景）

---

### [BEHAVIOR] [BEHAVIOR-5] waiting_ci 转入时写 pr_url（INV-e90c0fbb 合规）

**描述**：`harness-relay-watchdog.js` 在转入 waiting_ci 时同步写 `payload.waiting_pr_url` 和 `payload.waiting_ci_since`，确保 watchdog 再次扫到时不因缺 pr_url 而误判重复 spawn。

**验证方式**：
- 代码审计：`harness-relay-watchdog.js` 转入逻辑包含 `payload.waiting_pr_url = <pr_url>` 赋值
- DB 直查：转入 waiting_ci 后 `SELECT payload->>'waiting_pr_url' FROM tasks WHERE id=$1` 非空

**相关代码**：`packages/brain/src/harness-relay-watchdog.js`

**测试文件**：`packages/brain/src/__tests__/pool-c-waiting-state.test.js`（转入场景断言）

---

### [BEHAVIOR] [BEHAVIOR-6] VALID_STATUSES 白名单包含 waiting_ci

**描述**：`task-updater.js` 的 `VALID_STATUSES` 数组包含 `'waiting_ci'`，使所有 `UPDATE tasks SET status='waiting_ci'` 不被安全校验层拒绝。

**验证方式**：
- 代码检查：`grep "VALID_STATUSES" packages/brain/src/task-updater.js` 结果包含 `'waiting_ci'`
- 单元测试：调用 updateTask 将 status 设为 `waiting_ci` 不抛错

**相关代码**：`packages/brain/src/task-updater.js:13`

**测试文件**：`packages/brain/src/__tests__/pool-c-waiting-state.test.js`（状态流转合法性断言）

---

### [BEHAVIOR] [BEHAVIOR-7] 既有测试全部通过（回归保护）

**描述**：`slot-allocator.test.js`（1396 行）、`slot-accounting.test.js`（173 行）、`dispatcher.test.js`、`harness-slot-check.test.js` 在本次改动后全部绿灯。

**验证方式**：
- CI 命令：`cd packages/brain && npm test -- --testPathPattern="slot|dispatcher|harness-slot" --passWithNoTests`
- 所有测试 suite pass，无新增 failure

**相关代码**：所有受影响文件

**测试文件**：上述 4 个现有测试文件

---

### [BEHAVIOR] [BEHAVIOR-8] Brain 版本 bump 至 1.268.0

**描述**：`packages/brain/package.json` 版本从 `1.267.2` 升至 `1.268.0`（minor bump，功能性变更）。

**验证方式**：
- 代码检查：`cat packages/brain/package.json | jq '.version'` 返回 `"1.268.0"`
- version-sync 检查通过：`bash scripts/check-version-sync.sh`

**相关代码**：`packages/brain/package.json`

**测试文件**：`scripts/check-version-sync.sh` 门禁

---

## FR-5 兼容性审计 DoD

以下 14 个 `in_progress` 查询点必须逐一核查并在 PR 描述中记录结论：

| # | 文件 | 行号 | 语义分类 | 要求 | 状态 |
|---|---|---|---|---|---|
| 1 | `slot-allocator.js` | 233 | Pool C 计数 | **排除** waiting_ci | □ |
| 2 | `slot-allocator.js` | 216 | Cecelia 计数 | 不变（Cecelia 任务不走 waiting_ci） | □ |
| 3 | `slot-allocator.js` | 646 | harness inflight | **排除** waiting_ci | □ |
| 4 | `harness-watchdog.js` | 150,206,272 | 健康巡检 | **纳入** waiting_ci | □ |
| 5 | `zombie-reaper.js` | 79,126,141 | 僵尸扫描 | **纳入** waiting_ci（新增独立分支） | □ |
| 6 | `startup-sync.js` | 37 | 启动恢复 | **纳入** waiting_ci（再分类逻辑） | □ |
| 7 | `dispatcher.js` | 535,563 | 去重防重派 | **纳入** waiting_ci | □ |
| 8 | `harness-relay-watchdog.js` | 204,205,356,493,559 | 状态写回 | WHERE 扩展为 OR status='waiting_ci' | □ |
| 9 | `area-scheduler.js` | 65 | 看板统计 | waiting_ci 单独列 | □ |
| 10 | `health-monitor.js` | 65 | 健康监控 | **纳入** waiting_ci | □ |
| 11 | `eviction.js` | 132 | 驱逐候选 | **排除** waiting_ci | □ |
| 12 | `nightly-tick.js` | 29 | 夜报统计 | waiting_ci 单独统计列 | □ |
| 13 | `actions.js` | 343,369 | updateTask 校验 | 允许 in_progress → waiting_ci 转换 | □ |
| 14 | `decision.js` | 70,117,145 | OKR 进度 | **纳入** waiting_ci（视为进行中） | □ |

---

## failing-first 测试规约

**铁律**：测试文件 `packages/brain/src/__tests__/pool-c-waiting-state.test.js` 必须在 slot-allocator.js / zombie-reaper.js 改动**之前**提交，且在改动前状态下执行结果为红（4 个场景均 FAIL）。

验证方式：PR 的 commit 历史中，测试文件的 commit SHA 早于实现文件的 commit SHA。

---

## 完成标准（GoLive 门禁）

1. [ ] `pool-c-waiting-state.test.js` 存在，4 场景（含场景4的4个子场景共7个断言）全绿
2. [ ] `slot-allocator.test.js`、`slot-accounting.test.js`、`dispatcher.test.js`、`harness-slot-check.test.js` 全绿
3. [ ] `packages/brain/package.json` 版本为 `1.268.0`
4. [ ] `scripts/check-version-sync.sh` 通过
5. [ ] `scripts/facts-check.mjs` 通过
6. [ ] E2E 验收脚本在 local_api 环境执行后，验收1/2/3 全 PASS
7. [ ] FR-5 兼容性审计表 14 处全部打钩（在 PR 描述中记录）
8. [ ] INV-e90c0fbb：`waiting_pr_url` 写入确认
9. [ ] PR 合并后，Brain 任务 327bdebb 状态回写为 `completed`
