# Sprint PRD — A8-1 死因分类器 + 路由骨架

- task_id: 431d24b1-de5e-4002-8581-8740c8a73232
- sprint_dir: sprints/07152230-a8-1-cause-classifier
- 挂靠 PRD: docs/prd/2026-07-15-self-healing-golden-path.prd.md（S2/S3/L1）
- 日期: 2026-07-15

---

## Invariant 约束

来源：PRD §5 铁律 + 现有代码不变量（harness-relay-watchdog.js）

| ID | 约束 |
|----|------|
| INV-01 | 不改 attempt cap 数值（MAX_RELAY_ATTEMPTS=5 / MAX_CODEX_RELAY_ATTEMPTS=2）与全局并发闸 |
| INV-02 | OOM 升档最多一级（GP2：oom_upgraded=true + exit=137 → 直接 oom_wall，禁二次升档）|
| INV-03 | 分类器判不出 → 保守走 unknown → 现行路径（不盲目重点火也不修改 attempt 计数）|
| INV-04 | 禁 mock 真实外部命令行为；mock 必须复现真实退出码/输出语义（非零退出不得被 mock 掉）|
| INV-05 | 新增死因场景必须先补 L1 链路用例再写处置器（无闸不成文的链路版）|
| INV-06 | 每次收尸必打审计日志 `cause=<分类> action=<处置> initiative=<id>` |
| INV-07 | 分类器是纯函数，无副作用，无 DB 调用，可独立单测 |

---

## 累积 FR

| ID | 功能需求 | 来源 |
|----|----------|------|
| FR-01 | 新增 `packages/brain/src/harness-death-classifier.js`：导出 `classifyDeath({exitCode, stdoutTail, tmuxPane})` → `{cause, action}` | PRD S2 |
| FR-02 | cause 枚举：`oom \| auth \| rate_limit \| interactive_stuck \| ci_red \| green_waiting_merge \| unknown` | PRD S2 |
| FR-03 | 取证源1：`exitCode`（task.payload.last_container_exit_code，A7 已落库）→ exit=137 判 oom | PRD S2 |
| FR-04 | 取证源2：`stdoutTail`（callback stdout 尾巴）→ 401/403 → auth；429/quota/rate limit/overloaded → rate_limit | PRD S2 |
| FR-05 | 取证源3：`tmuxPane`（headed 任务 tmux capture-pane 输出）→ "Press enter"/"press esc"/"choose" 类交互提示 → interactive_stuck | PRD S2 |
| FR-06 | 取证源综合：gh CI 状态（已存在 mapCiStatus 逻辑）→ ci_red；绿灯容器消失 → green_waiting_merge | PRD S3 |
| FR-07 | watchdog 收尸路径接分类器：`oom` → 现有 A7 升档路径（spawnOpts.memoryTier='oom_upgrade'）| PRD S3 |
| FR-08 | watchdog 收尸路径接分类器：`ci_red` → 现有 A1 重点火路径（fall through 到 spawn）| PRD S3 |
| FR-09 | watchdog 收尸路径接分类器：其余 cause（auth/rate_limit/interactive_stuck/green_waiting_merge/unknown）→ 打日志 `action=log_only`，走现行路径 | PRD S3 |
| FR-10 | 每次收尸在分类后打审计日志：`cause=<X> action=<Y> initiative=<id>`（console.log 格式，持久化留给 A8-2）| PRD §4 |
| FR-11 | L1 串链测试文件：`packages/brain/src/__tests__/harness-death-chain.test.js`，覆盖 oom/ci_red/unknown 三条全链（S1死亡→S2分类→S3路由→spawn参数）| PRD L1 |
| FR-12 | 测试相邻环节真调用（分类器→路由→处置器→spawn）；只 mock 外部命令面（docker ps/gh pr/tmux capture-pane）| PRD L1 |
| FR-13 | 必须先写 failing test，再写实现（TDD 顺序）| PRD §5 |

---

## NFR

| ID | 非功能需求 |
|----|-----------|
| NFR-01 | 分类器模块行数 ≤ 120 行（thin-slice 上限）|
| NFR-02 | 分类器执行无 I/O，耗时 < 1ms（纯函数）|
| NFR-03 | 测试文件进 CI（engine-ci.yml 或 brain-ci.yml 已覆盖 `__tests__` 路径）|

---

## 实现范围（A8-1 边界）

**本件做**：
- harness-death-classifier.js（纯函数，三源取证）
- harness-relay-watchdog.js 收尸路径接分类器（oom/ci_red 接既有处置器，其余 log_only）
- L1 串链测试 oom/ci_red/unknown 三条用例（先写 failing test）

**本件不做**（留 A8-2/A8-3）：
- 401 换号处置器、限流 defer、绿灯死收尾棒、S0 批量恢复
- L2 金丝雀演习（A8-3）
- 审计日志持久化到 DB

---

journey_type: harness_sprint
target_environment: brain_ci
