# Contract Draft: headless-dispatch-smoke

Sprint: sprints/07172032-relay-d744a719
Task ID: d744a719-0247-4b15-b91d-882fae1838a5
Date: 2026-07-17

---

## Golden Path

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | `curl localhost:5221/healthz` | HTTP 200，Brain 在线 |
| 2 | `POST /api/brain/tasks` `{mode:"headless", executor:"claude"}` | 200/201 + 响应含 `id` 字段（UUID 字符串） |
| 3 | `POST /api/brain/tasks` `{mode:"headless", executor:"codex"}` | 200/201（另一 executor 同样放行） |
| 4 | `POST /api/brain/tasks` `{mode:"invalid"}` | 400，响应含 error 字段说明非法 mode |
| 5 | `grep "CECELIA_HEADLESS: 'true'" packages/brain/src/docker-executor.js` | 找到注入行（代码检查） |
| 6 | `grep "PPID.*CECELIA_HEADLESS\|CECELIA_HEADLESS.*PPID" packages/brain/src/slot-allocator.js` | 找到 PPID 检测逻辑（代码检查） |
| 7 | `grep "headless\|spawnFn\|docker" packages/brain/src/harness-skill-relay.js` | 找到 headless → docker spawnFn 路径（代码检查） |
| 8 | `bash packages/brain/scripts/smoke/headless-dispatch-smoke.sh` | 全部 ✅，`PASS: N  FAIL: 0`，exit 0 |
| 9 | `grep "headless-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt` | 找到该行，exit 0 |

---

## Test Contract 表格

| FR ID | 描述 | 验证方式 | 通过条件 |
|-------|------|---------|---------|
| FR1 | 新建 headless-dispatch-smoke.sh | 文件存在 + 可执行 | `ls -la packages/brain/scripts/smoke/headless-dispatch-smoke.sh` exit 0 |
| FR2-a | `task-tasks.js` mode=headless → 放行 | API 调用 | POST 返回 200/201 + id 字段 |
| FR2-b | `task-tasks.js` mode=invalid → 拒绝 | API 调用 | POST 返回 400 |
| FR3 | `docker-executor.js` 含 `CECELIA_HEADLESS: 'true'` 注入 | 源码 grep | grep 命中行（第 285 行） |
| FR4 | `slot-allocator.js` 含 PPID CECELIA_HEADLESS 检测 | 源码 grep | grep 命中逻辑块（第 104-138 行） |
| FR5 | `harness-skill-relay.js` headless → docker spawnFn | 源码 grep | grep 命中相关路径注释/逻辑 |
| FR6 | 加入 smoke-allowlist.txt | 文件 grep | grep 命中 headless-dispatch-smoke.sh |

---

## E2E 验收

### 主验收命令

```bash
# 验收 1：smoke 脚本全通过
bash packages/brain/scripts/smoke/headless-dispatch-smoke.sh
# 预期：输出含 "PASS: N  FAIL: 0"，exit 0

# 验收 2：allowlist 已收录
grep "headless-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt
# 预期：找到该行，exit 0

# 验收 3：脚本文件存在且可执行
ls -la packages/brain/scripts/smoke/headless-dispatch-smoke.sh
# 预期：文件存在，权限含 x

# 验收 4：源码检查——docker-executor 注入
grep "CECELIA_HEADLESS: 'true'" packages/brain/src/docker-executor.js
# 预期：找到第 285 行注入

# 验收 5：源码检查——slot-allocator PPID 检测
grep -E "PPID|CECELIA_HEADLESS" packages/brain/src/slot-allocator.js | head -5
# 预期：找到 PPID 检测逻辑

# 验收 6：源码检查——harness-skill-relay headless 路径
grep -c "headless\|spawnFn\|docker" packages/brain/src/harness-skill-relay.js
# 预期：计数 > 0（多处引用）
```

### 预期输出示例

```
── headless dispatch smoke ──
  ✅ Brain API 健康检查 → 200
  ✅ POST tasks(mode=headless, executor=claude) → 200/201 + id 字段存在
  ✅ POST tasks(mode=headless, executor=codex) → 200/201 放行
  ✅ POST tasks(mode=invalid) → 400 拒绝
  ✅ docker-executor.js 含 CECELIA_HEADLESS: 'true' 注入
  ✅ slot-allocator.js 含 PPID CECELIA_HEADLESS 检测逻辑
  ✅ harness-skill-relay.js 含 headless → docker spawnFn 路径

PASS: 7  FAIL: 0
✅ 全部通过
```

---

## 未覆盖链路清单

以下链路在本 smoke 脚本中不验证（超出范围 / NFR 约束）：

| 链路 | 未覆盖原因 |
|------|-----------|
| docker 容器真实运行 + CECELIA_HEADLESS 实际注入到进程环境 | NFR：无需 Docker 真实运行，code-inspection 方式已足够；真实运行验证留给 E2E |
| slot-allocator PPID 检测的运行时行为（真实 docker 进程树） | 需要 docker 容器 + 真实进程，超出 smoke 范围 |
| harness-skill-relay.js 完整执行路径（skill 加载、回调注册） | 由 harness-skill-relay 专属 smoke 脚本覆盖 |
| task-tasks.js mode=headed（headed 路径） | 由 claude-headed-dispatch-smoke.sh / codex-headed-dispatch-smoke.sh 覆盖 |
| CI 集成回归（brain-ci.yml smoke job glob 收集验证） | 由 CI 运行本身验证 |
