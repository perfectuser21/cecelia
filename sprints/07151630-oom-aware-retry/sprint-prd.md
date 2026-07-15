# Sprint PRD：刀A7 OOM 感知重试

task_id: 610ecc9e-ff5b-4cee-9fac-c0c69e4af925
sprint_dir: sprints/07151630-oom-aware-retry
journey_type: harness-relay
target_environment: headless-docker

---

## 背景

task 5e9c0496 实证：容器 `exit=137`（cgroup OOM kill）×5，watchdog 每次以相同参数（`--memory 2048m`）重点火，5 次同死因烧光 attempt cap，最终标 `failed`。确定性 OOM 墙面前重试=复读，必须识别并升档内存后再重点火，第二次仍 OOM 则直接放弃。

---

## 改动范围（两处）

### 改动 A：exit code 落库（callback → task payload）

**文件**：`packages/brain/src/routes/harness-callback.js`

harness-callback 路由（`/api/brain/harness/callback/:containerId`）已从 entrypoint 回调 body 取 `exit_code`（line 75），但未写回 task payload。

**新增逻辑**：relay 容器回调时（`orchestrator=skill-relay`），若 `exit_code` 非 undefined，PATCH task payload 写入 `last_container_exit_code: Number(exit_code)`。

---

### 改动 B：OOM 感知重点火（watchdog → spawn 升档）

**文件**：`packages/brain/src/harness-relay-watchdog.js`

重点火路径（line 499-502）读取 `task.payload.last_container_exit_code`：

- 若为 `137`（首次）：spawn 时传 `opts.memoryTier='oom_upgrade'`（env `HARNESS_RELAY_MEMORY_OVERRIDE=4096`），日志输出 `resume_oom_upgraded`
- 若已升档后再次 `137`（`payload.oom_upgraded=true`）：不再 spawn，直接 PATCH task `status=failed`，`failure_reason=oom_wall`，日志输出 `oom_wall`
- exit_code=0/1/null：走既有重点火路径，无升档

**文件**：`packages/brain/src/harness-skill-relay.js`

`spawnSkillRelaySession` 读取 `deps.opts?.memoryTier` 或 env `HARNESS_RELAY_MEMORY_OVERRIDE`，若为 `oom_upgrade`，则将 docker `--memory` 从默认 `2048m` 升到 `4096m`（仅该 initiative 当次 spawn 生效，全局默认不变）。同时 PATCH task payload `oom_upgraded=true`。

---

## 测试覆盖（Golden Path 4 条）

### GP1（failing test，先 commit）
`task payload.last_container_exit_code=137` + 容器消失 + 需重点火
→ `spawnFn` 收到含 `oom_upgrade` 的升档标记，日志含 `resume_oom_upgraded`
→ 当前版本 **failing**（无此分支）

### GP2（failing test，先 commit）
已升档（`payload.oom_upgraded=true`）再次 exit=137
→ 不调用 `spawnFn`，task PATCH `status=failed / failure_reason=oom_wall`
→ 当前版本 **failing**

### GP3（不回归测试）
exit_code=0/1/null → 走既有重点火路径，`spawnFn` 无升档参数

### GP4（不回归测试）
`harness-callback` 收到 exit=137 → task payload 写入 `last_container_exit_code=137`

### GP5（既有测试全过）
现有 `harness-relay-watchdog.test.js` + `harness-relay-watchdog-gates.test.js` 全绿

---

## Invariant 约束

1. **IN-1**：OOM 升档最多一级（2048m → 4096m），`oom_upgraded=true` 后严禁再次升档
2. **IN-2**：`attempt cap`（`MAX_RELAY_ATTEMPTS`）数值不变，`oom_wall` 判定在 cap 检查之前短路
3. **IN-3**：全局 docker 默认内存不变（仅该 initiative 当次 spawn 受 `HARNESS_RELAY_MEMORY_OVERRIDE` 影响）
4. **IN-4**：不动 dispatcher，不动全局并发闸
5. **IN-5**：`last_container_exit_code` 落库路径不得 mock 掉 entrypoint 回调 body 的真实取值（`req.body.exit_code`）
6. **IN-6**：日志三态必须可辨：`resume_oom_upgraded` / `oom_wall` / 正常重点火（无 OOM 前缀）

---

## 累积 FR

| # | 文件 | 变更 |
|---|------|------|
| FR-1 | `routes/harness-callback.js` | relay 回调落库 `last_container_exit_code` |
| FR-2 | `harness-relay-watchdog.js` | 读 payload.last_container_exit_code，exit=137 → OOM 分支 |
| FR-3 | `harness-relay-watchdog.js` | oom_upgraded=true + 再次 exit=137 → 直接 failed/oom_wall |
| FR-4 | `harness-skill-relay.js` | spawnSkillRelaySession 读 opts/env 升档 --memory 4096m |
| FR-5 | `harness-skill-relay.js` | spawn 成功后 PATCH payload.oom_upgraded=true |
| FR-6 | 测试 GP1 | failing test 先 commit（exit=137 → 升档断言） |
| FR-7 | 测试 GP2 | failing test 先 commit（oom_upgraded + exit=137 → oom_wall） |

---

## NFR

- **NFR-1 性能**：`last_container_exit_code` 落库为单次 JSONB merge，不增加额外 DB 轮询
- **NFR-2 可观测性**：三态日志前缀（`[relay-watchdog][OOM]`）使 grep 可直接定位
- **NFR-3 安全降级**：`HARNESS_RELAY_MEMORY_OVERRIDE` 未设时读 `4096`，env 可覆盖（测试/生产均可）
- **NFR-4 不扩大影响面**：headed 路径（tmux）不受本改动影响，OOM 升档仅适用 headless docker 路径

---

## 实施顺序

1. 先写 GP1/GP2 failing tests → commit
2. 改 harness-callback.js（FR-1）→ 改 harness-relay-watchdog.js（FR-2/3）→ 改 harness-skill-relay.js（FR-4/5）
3. 跑全量 watchdog 测试（GP3-5）确认无回归
4. PR → CI → 合并

---

## 串行依赖

若刀A5（PR #3986，watchdog execTolerant）尚未合并入 main，本任务须在 A5 merge 后才能开始改 `harness-relay-watchdog.js`（同文件，避免冲突）。
当前 git log 显示 A5 已于本分支前合并（7b0d268da），无阻塞。
