# Contract Draft：刀A7 OOM 感知重试

task_id: 610ecc9e-ff5b-4cee-9fac-c0c69e4af925
sprint_dir: sprints/07151630-oom-aware-retry
journey_type: harness-relay
target_environment: headless-docker
contract_version: v1.0
date: 2026-07-15

---

## 功能边界

本合同覆盖两处独立改动：

**改动 A（FR-1）**：`packages/brain/src/routes/harness-callback.js`
- relay 容器（`cecelia-relay-*`）回调时，若 body 含 `exit_code` 字段，PATCH task payload 写入 `last_container_exit_code: Number(exit_code)`
- 仅限 `orchestrator=skill-relay` 路径，不影响其他容器回调流程

**改动 B（FR-2/3/4/5）**：`packages/brain/src/harness-relay-watchdog.js` + `packages/brain/src/harness-skill-relay.js`
- watchdog 重点火路径在 attempt cap 检查前读 `task.payload.last_container_exit_code`
- exit=137 首次：以 `opts.memoryTier='oom_upgrade'`（`HARNESS_RELAY_MEMORY_OVERRIDE=4096`）spawn，日志含 `resume_oom_upgraded`，同时 PATCH `payload.oom_upgraded=true`
- `oom_upgraded=true` 后再次 exit=137：不 spawn，直接 PATCH `status=failed / failure_reason=oom_wall`，日志含 `oom_wall`
- exit=0/1/null：走既有重点火路径，无升档

---

## 不在范围内

- dispatcher 逻辑不改
- 全局 docker `--memory` 默认值不改（仍为 2048m）
- headed（tmux）路径不受影响
- `MAX_RELAY_ATTEMPTS` / `MAX_CODEX_RELAY_ATTEMPTS` 数值不变
- `last_container_exit_code` 真实取值路径（`req.body.exit_code`）不 mock

---

## Invariant 清单

| ID | 约束 | 验证方式 |
|----|------|----------|
| IN-1 | 升档最多一级（2048m→4096m），`oom_upgraded=true` 后严禁再次升档 | GP2：oom_upgraded=true + exit=137 → 直接 failed，不调 spawnFn |
| IN-2 | `oom_wall` 判定在 attempt cap 检查之前短路 | GP2：attempts=0 时也能触发 oom_wall |
| IN-3 | 全局 docker 默认内存不变 | spawnFn 未收到 oom_upgrade 标记时不传 HARNESS_RELAY_MEMORY_OVERRIDE |
| IN-4 | 不动 dispatcher，不动全局并发闸 | 静态代码审查 |
| IN-5 | exit_code 落库路径不 mock req.body.exit_code | GP4 测试直接调用 route handler，不 stub body |
| IN-6 | 日志三态可辨：`resume_oom_upgraded` / `oom_wall` / 正常重点火 | GP1/GP2/GP3 各自断言 console.log 内容 |

---

## Golden Path 定义

### GP1：exit=137 首次 → 升档重点火（failing test）

**前置条件**：
- `task.payload.last_container_exit_code = 137`
- `task.payload.oom_upgraded` 不存在或 false
- 容器已消失（containerRunning=false）
- attempts < MAX_RELAY_ATTEMPTS

**预期行为**：
- `spawnFn` 被调用一次
- 调用参数含升档标记（`opts.memoryTier='oom_upgrade'` 或等效 env）
- `console.log` 含 `resume_oom_upgraded`
- 不触发 attempt cap 分支

### GP2：oom_upgraded=true + exit=137 → oom_wall（failing test）

**前置条件**：
- `task.payload.last_container_exit_code = 137`
- `task.payload.oom_upgraded = true`
- 容器已消失
- attempts 任意值（含 0）

**预期行为**：
- `spawnFn` 不被调用
- DB PATCH `status=failed / failure_reason=oom_wall`
- `console.warn` 或 `console.log` 含 `oom_wall`

### GP3：exit=0/1/null → 正常重点火（不回归测试，作为参照）

**预期行为**：
- `spawnFn` 被调用，无升档标记
- 日志无 `resume_oom_upgraded` / `oom_wall` 前缀

### GP4：callback 落库 last_container_exit_code（不回归测试）

**前置条件**：
- POST `/api/brain/harness/callback/cecelia-relay-xxx` body `{exit_code: 137}`
- containerId 对应 task 存在

**预期行为**：
- DB PATCH `payload.last_container_exit_code = 137`
- 返回 200 `{ok:true, relayAck:true}`

---

## E2E 验收

### E2E-1：OOM 升档路径（headless-docker 集成验证）

**可观测断言**（非 mock，真实执行路径）：

```bash
# 1. 查询 task payload 确认 last_container_exit_code 落库
curl -s localhost:5221/api/brain/tasks/610ecc9e-ff5b-4cee-9fac-c0c69e4af925 \
  | jq '.payload.last_container_exit_code'
# 预期: 137

# 2. 查询 initiative_runs 确认 oom_upgraded 写入
psql $DATABASE_URL -c \
  "SELECT payload->>'oom_upgraded' FROM tasks WHERE id='610ecc9e-ff5b-4cee-9fac-c0c69e4af925';"
# 预期: true

# 3. 确认第二次 137 时 task 标 failed + failure_reason=oom_wall
curl -s localhost:5221/api/brain/tasks/610ecc9e-ff5b-4cee-9fac-c0c69e4af925 \
  | jq '{status: .status, failure_reason: .payload.failure_reason}'
# 预期: {"status":"failed","failure_reason":"oom_wall"}

# 4. 日志三态验证（在 Brain 容器日志中可 grep）
docker logs cecelia-brain 2>&1 | grep -E "resume_oom_upgraded|oom_wall|relay-watchdog" | tail -20
# 预期: 含 [relay-watchdog][OOM] resume_oom_upgraded 或 oom_wall 行
```

### E2E-2：正常路径不受影响（回归验证）

```bash
# 既有 watchdog 测试全绿
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-relay-watchdog.test.js \
  packages/brain/src/__tests__/harness-relay-watchdog-gates.test.js --reporter=verbose
# 预期: 0 failures
```

---

## 测试文件清单

| 文件 | 类型 | 状态 |
|------|------|------|
| `sprints/07151630-oom-aware-retry/tests/oom-aware-retry.test.js` | GP1/GP2 单测骨架 | failing（待 impl） |
| `packages/brain/src/__tests__/harness-relay-watchdog.test.js` | 既有测试 | 全绿不回归 |
| `packages/brain/src/__tests__/harness-relay-watchdog-gates.test.js` | 既有测试 | 全绿不回归 |

> **CI 常驻路径约定**：`sprints/` 目录的骨架仅作参照；实施阶段真实 failing tests 必须放 `packages/brain/src/__tests__/oom-aware-retry.test.js` 才进 CI 回归。

## Test Contract

| BEHAVIOR | Test File | Test Name Pattern |
|----------|-----------|-------------------|
| BEHAVIOR-1 exit=137 首次升档 | packages/brain/src/__tests__/oom-aware-retry.test.js | GP1 |
| BEHAVIOR-2 oom_wall 禁止 spawn | packages/brain/src/__tests__/oom-aware-retry.test.js | GP2 |
| BEHAVIOR-3 callback 落库 exit_code | 手工集成验收（E2E bash）| N/A |
| BEHAVIOR-4 oom_wall 在 cap 前短路 | packages/brain/src/__tests__/oom-aware-retry.test.js | attempts=0 |
| BEHAVIOR-5 exit=0/1/null 回归 | packages/brain/src/__tests__/harness-relay-watchdog.test.js | 既有测试 |
| BEHAVIOR-6 日志三态 | packages/brain/src/__tests__/oom-aware-retry.test.js | 日志三态 |
