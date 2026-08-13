# Contract Draft — Harness 入口旁路修复：kernel-v1 绕过 Session Controller 门禁

## Sprint 信息
- TASK_ID: 89210ba1-a0d7-4b26-b3f3-2b90efec7783
- SPRINT_DIR: sprints/08131623-relay-89210ba1
- 关联 PR: #4860（已合并 79ad1b3a76，前置任务）

---

## 问题陈述

`harness-skill-relay.js` 第 363-366 行对 `harness_runtime=kernel-v1` 做提前 return，绕过了外层两道门禁：

```js
// 当前有问题的代码（第 363-366 行）
if (task.payload?.harness_runtime === 'kernel-v1') {
  return _spawnKernelRuntime(task, { dbPool, now, initiativeId, deps });
}
```

此提前 return 导致：
1. **INV-6 violation**：executor='auto' 等非法值进入 kernel-v1 路径时，绕过白名单校验，静默启动 Kernel
2. **INV-5 violation**：kernel-v1 路径缺少 `findActiveRunBlockingSpawn` DB 幂等防重，活跃 run 存在时不拒绝

---

## 被改边（Edges Under Change）

| 边 | 修改方向 | mock 禁令 |
|---|---|---|
| `harness-skill-relay.js` 第 363-366 行 executor 白名单校验 | 新增：early return 前插入 executor 白名单 | 集成测试禁 mock `pool.query` |
| `harness-skill-relay.js` kernel-v1 路径 DB 幂等防重 | 新增：early return 前插入 `findActiveRunBlockingSpawn` | 集成测试禁 mock `findActiveRunBlockingSpawn` |

---

## 验收断言（4 个判定点）

### AP-1：executor='auto' + kernel-v1 → 白名单拦截

**用户语言**："当任务带有非法的 executor='auto' 且 harness_runtime=kernel-v1 时，系统应该拦截并报错，不能悄悄启动 Kernel"

**技术断言**：
- 调用 `spawnSkillRelaySession` 返回 `{ok: false, error: 'unsupported executor: auto'}`
- 真实 DB（initiative_runs 表）对该 task_id 的 count = 0（不写任何 run）
- 日志含 `[skill-relay][ALERT]` 字样
- task 回滚：tasks 表该行 status='queued', claimed_by IS NULL

### AP-2：活跃 run + kernel-v1 重打 → DB 幂等防重拦截

**用户语言**："当同一任务已经有一个正在运行的 run 时，再次触发 kernel-v1 路径，系统应该拒绝，不产生第二个 run"

**技术断言**：
- 先在 initiative_runs 插入一条非终态 run（phase='planning', deadline_at=future）
- 再次调用 `spawnSkillRelaySession`（kernel-v1）返回 `{ok: false, deferred: true, reason: 'active_run_guard'}`
- DB initiative_runs count 仍为 1（不新增 run）

### AP-3：合法路径 + kernel-v1 → 成功创建 run + controller_session_id 非空

**用户语言**："正常情况下，带有 kernel-v1 的任务（无 executor 或 executor='claude'）应该成功启动，且系统记录 ownership"

**技术断言**：
- 调用 `spawnSkillRelaySession`（executor 缺省 或 'claude', harness_runtime='kernel-v1'）返回 `{ok: true, mode: 'kernel-v1'}`
- DB initiative_runs 该 task_id 下存在 1 条记录
- 该记录 controller_session_id IS NOT NULL 且不为空串
- controller_lease_expires_at > started_at（ownership 先于 Kernel 可执行态写入）

### AP-4：createKernelRun 无 controllerSessionId → fail-closed

**用户语言**："如果系统在创建 run 时忘记写入 controller ownership，必须立刻报错，不能创建没有主人的 run"

**技术断言**：
- 直接调用 `createKernelRun(pool, {..., controllerSessionId: undefined})` 抛出匹配 `/missing controller ownership/` 的错误
- DB initiative_runs 对该 task_id count = 0

---

## 边界情况覆盖

| 场景 | 预期行为 | 对应 INV |
|---|---|---|
| executor='auto' + kernel-v1 | loud-fail + task 回滚 + count=0 | INV-6 |
| executor=undefined + kernel-v1 | 合法路径，正常创建 run | INV-6 |
| executor='claude' + kernel-v1 | 合法路径，正常创建 run | INV-6 |
| 活跃 run 存在 + kernel-v1 重打 | deferred, reason='active_run_guard' | INV-5 |
| BRAIN_PREVIEW=1 + kernel-v1 | preview_brain_harness_spawn_forbidden（已有，回归） | INV-10 |
| createKernelRun 无 controllerSessionId | fail-closed 抛错 | INV-4 |

---

## 不变量覆盖矩阵

| INV | 描述 | 覆盖状态 | 覆盖测试 |
|---|---|---|---|
| INV-1 | 活跃 Kernel Run 前必先有 controller ownership | 覆盖 | AP-3 |
| INV-2 | Kernel fatal 只结束 Kernel，Controller 存活 | 已验收（PR #4860） | kernel-controller-lifecycle.pg |
| INV-3 | 无主 run fail-closed，不静默放行 | 覆盖 | AP-4 |
| INV-4 | createKernelRun 无 controllerSessionId → fail-closed | 覆盖 | AP-4 |
| INV-5 | 活跃 run 存在时禁止同 task 二次 spawn | **本 sprint 新增** | AP-2 |
| INV-6 | executor 非白名单值 → loud-fail + task 回滚 | **本 sprint 新增** | AP-1 |
| INV-7 | derive.js 四档 change_kind Profile | 已验收（PR #4860） | kernel-gear-dispatch.pg |
| INV-8 | controller_session_id 先于 Kernel 可执行态写入 | 覆盖 | AP-3 |
| INV-9 | failure_reason 结构化 + 脱敏 | 已验收（PR #4860） | kernel-controller-lifecycle.pg |
| INV-10 | BRAIN_PREVIEW=1 下所有路径拒绝 | 已验收（PR #4860，回归检查） | harness-skill-relay.test.js |

---

## 禁 mock 清单（集成测试铁律）

以下边在集成测试中 **禁止 mock**：
- `pool.query`（initiative_runs INSERT/SELECT）
- `createKernelRun`（fail-closed 边）
- `findActiveRunBlockingSpawn`（DB 幂等防重边）

允许替身（与被改边无关的外层依赖）：
- `deps.launchKernel`（最外层 Kernel 启动器）
- `deps.ensureWt`（worktree ensure）

---

## 假设

- [ASSUMPTION] migration 415 已在 main 分支落库，集成测试直跑 migrate.js 可用
- [ASSUMPTION] `findActiveRunBlockingSpawn` 判据（phase NOT IN ('done','failed') AND deadline_at > NOW()）与本场景语义一致
- [ASSUMPTION] executor 白名单插入 early return 之前，executor=undefined/null 仍走合法路径

---

## 铁律

- fail-closed：executor 非法值不得静默降级，必须 loud-fail + task 回滚
- 幂等：活跃 run 存在时，kernel-v1 再打必须返回 `{ok:false, deferred:true, reason:'active_run_guard'}`
- 可观测：executor 白名单拦截必须打 `[skill-relay][ALERT]` 日志
- 测试隔离：集成测试真打 spawnSkillRelaySession + 真 DB，禁 mock createKernelRun / pool.query

---

## E2E 验收

**验收脚本**：`sprints/08131623-relay-89210ba1/e2e-verify.sh`

**验收步骤**：
1. 确保 Brain 服务运行（localhost:5221）
2. 执行集成测试套件
3. 验证 4 个判定点全部通过

**通过标准**：
- AP-1: executor=auto + kernel-v1 → {ok:false, error:'unsupported executor: auto'}
- AP-2: 活跃 run + kernel-v1 重打 → {ok:false, deferred:true, reason:'active_run_guard'}
- AP-3: 合法路径 + kernel-v1 → {ok:true} + controller_session_id 非空
- AP-4: createKernelRun 无 controllerSessionId → 抛 /missing controller ownership/

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| ws1 | `packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js` | `INV-6: executor=auto + kernel-v1 → 白名单拦截 loud-fail，initiative_runs count=0，task 回滚` / `INV-5: 活跃 run 存在 + kernel-v1 重打 → DB 幂等防重拦截，不产生第二条 run` / `createKernelRun 带 controllerSessionId → 建 run 且 ownership 先于 Kernel 可执行态落库` / `createKernelRun 无 controllerSessionId fail-closed` | 修复前 harness-skill-relay.js 第 363-366 行 early return 绕过门禁，INV-6 白名单未校验、INV-5 findActiveRunBlockingSpawn 未调用，断言失败 |
| ws1-e2e | `sprints/08131623-relay-89210ba1/e2e-verify.sh` | `E2E 验收：4 个判定点集成跑通` | 实现前测试套件报错（entry-point 缺失） |
