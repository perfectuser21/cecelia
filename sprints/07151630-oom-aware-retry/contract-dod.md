# Contract DoD：刀A7 OOM 感知重试

task_id: 610ecc9e-ff5b-4cee-9fac-c0c69e4af925
contract_version: v1.0
date: 2026-07-15

---

## [BEHAVIOR] 条目

### [BEHAVIOR-1] exit=137 首次触发升档重点火

**描述**：watchdog 读取 `task.payload.last_container_exit_code === 137` 且 `payload.oom_upgraded` 不为 true 时，调用 spawnFn 并传入升档标记，日志含 `resume_oom_upgraded`。

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run sprints/07151630-oom-aware-retry/tests/oom-aware-retry.test.js \
  --reporter=verbose -t "GP1"
# 预期: ✓ GP1 测试通过，spawnFn 收到 oom_upgrade 标记
```

**失败判定**：spawnFn 未被调用 / 调用时无升档标记 / 日志无 `resume_oom_upgraded`

---

### [BEHAVIOR-2] oom_upgraded=true + exit=137 → 直接标 failed/oom_wall，禁止 spawn

**描述**：watchdog 读取 `payload.oom_upgraded === true` 且 `last_container_exit_code === 137` 时，不调用 spawnFn，直接 PATCH task `status=failed / failure_reason=oom_wall`，日志含 `oom_wall`。

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run sprints/07151630-oom-aware-retry/tests/oom-aware-retry.test.js \
  --reporter=verbose -t "GP2"
# 预期: ✓ GP2 测试通过，spawnFn 未被调用，DB PATCH 含 oom_wall
```

**失败判定**：spawnFn 被调用 / DB PATCH 未写 failure_reason=oom_wall / 日志无 `oom_wall`

---

### [BEHAVIOR-3] callback 路由将 exit_code=137 写入 task payload

**描述**：relay 容器（`cecelia-relay-*`）POST callback 时若 body 含 `exit_code`，路由将 `last_container_exit_code: Number(exit_code)` 合并写入 task payload，不影响 200 ack 响应。

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run sprints/07151630-oom-aware-retry/tests/oom-aware-retry.test.js \
  --reporter=verbose -t "GP4"
# 预期: ✓ GP4 测试通过，DB query 含 last_container_exit_code=137 写入
```

**失败判定**：DB PATCH 未调用 / `last_container_exit_code` 未写入 / 回调返回非 200

---

### [BEHAVIOR-4] oom_wall 判定在 attempt cap 之前短路

**描述**：当 `oom_upgraded=true + exit=137` 时，即使 attempts=0（远低于上限），也立即触发 oom_wall 路径，不等待 cap 耗尽。

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run sprints/07151630-oom-aware-retry/tests/oom-aware-retry.test.js \
  --reporter=verbose -t "GP2.*attempts=0"
# 预期: ✓ attempts=0 时也触发 oom_wall，不走 attempt cap 分支
```

**失败判定**：attempts=0 时未触发 oom_wall（被 cap 检查拦住或进入 spawn 分支）

---

### [BEHAVIOR-5] exit=0/1/null 走既有路径，无升档副作用（回归守护）

**描述**：`last_container_exit_code` 为 0/1/null/undefined 时，watchdog 行为与改动前完全一致，spawnFn 被调用但无升档参数，既有测试全绿。

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/harness-relay-watchdog.test.js \
  packages/brain/src/__tests__/harness-relay-watchdog-gates.test.js \
  --reporter=verbose
# 预期: 0 failures，所有既有测试通过
```

**失败判定**：任何既有测试 FAIL

---

### [BEHAVIOR-6] 日志三态可用 grep 区分

**描述**：OOM 升档时输出含 `resume_oom_upgraded`，OOM 二次撞墙时含 `oom_wall`，普通重点火无此前缀。三态在 Brain 日志中可用 `grep -E "resume_oom_upgraded|oom_wall"` 精确定位。

**验收命令（manual:bash）**：
```bash
# 验证日志三态（单测级别）
cd /workspace && npx vitest run sprints/07151630-oom-aware-retry/tests/oom-aware-retry.test.js \
  --reporter=verbose -t "日志三态"
# 预期: ✓ GP1 日志含 resume_oom_upgraded，GP2 含 oom_wall，GP3 无 OOM 前缀
```

**失败判定**：日志无法 grep 区分三态

---

## 全量 DoD 通过条件

所有 [BEHAVIOR-1..6] 验收命令返回 0 failures，且 CI brain-ci.yml 全绿。

---

## 禁止事项（合同红线）

- 禁止 mock `req.body.exit_code`（IN-5）
- 禁止在 `oom_upgraded=true` 后再次升档内存（IN-1）
- 禁止修改 `MAX_RELAY_ATTEMPTS` 数值（IN-2）
- 禁止在 oom_wall 路径调用 spawnFn（IN-1）
- 禁止修改 headed 路径逻辑（NFR-4）
