# 合同草案 — A8-3：金丝雀故障注入演习

- Sprint：A8-3
- 任务 ID：56d677a8-65e8-485c-9ec3-1ade28716ae9
- 挂靠 PRD：sprints/07161400-a8-3-canary-drill/sprint-prd.md
- 起草日期：2026-07-16
- 依赖：A8-1（分类器+路由骨架）、A8-2（新处置器+S0）已 merge

---

## 功能行为描述

### FR-07：canary-death-drill.mjs 金丝雀注入器

**输入**：
- 命令行参数：`--mode <oom|kill9|interactive_stuck|random>`（默认 random）
- 环境变量：`STAGING_BRAIN_URL`（默认 `http://localhost:5222`）
- 环境变量：`BARK_URL`（可选，演习失败告警用）

**行为**：
1. 向 staging brain（5222）POST `/api/brain/tasks` 注册 harness 任务，payload 含 `canary: true`、`canary_mode: <mode>`
2. 等待 staging brain 返回 task_id
3. 触发注入死法（OOM / kill-9 / 卡交互 三选一）
4. 轮询 GET `/api/brain/tasks/<task_id>` 每 10s 一次，上限 15 分钟（90 次）
5. 断言：watchdog 正确分类并处置（根据死法断言具体 cause + action）
6. 演习结束后调用 Brain API 落档（FR-11）
7. 若任意断言失败，通过 BARK_URL 发 Bark 告警（FR-13）

**守卫**：脚本开头强制校验 Brain URL 不包含 `:5221`；若检测到生产端口则立即 exit 1

**状态**：演习完成后 exit 0（全部通过）或 exit 1（任意失败）

---

### FR-08：OOM 注入

**输入**：
- staging brain 已注册 canary:true 任务（task_id 已得）

**行为**：
1. `docker run --rm --memory 128m --memory-swap 128m python:3-slim python3 -c "bytearray(200*1024*1024)"` — 容器 OOM 自动退出码 137
2. 将 task 的 `last_exit_code=137`、`stdout_tail=""` 更新到 staging brain（通过 PATCH `/api/brain/tasks/<task_id>`）
3. 等待 watchdog 处置

**断言**：
- `task.payload.cause === 'oom'`
- 若 `task.payload.oom_upgraded` 为 falsy（首次）→ attempt 递增，`task.payload.oom_upgraded = true`
- 若 `task.payload.oom_upgraded` 已为 true → `task.status === 'failed'`（oom_wall）
- canary 任务 ID 不出现在 `/api/brain/dev-records` 返回列表中

---

### FR-09：kill-9 注入

**输入**：
- staging brain 已注册 canary:true 任务
- docker 容器正在运行（`sleep infinity`）

**行为**：
1. `docker run -d --name canary-<task_id> alpine sleep infinity` 启动容器
2. 更新 staging task 关联容器 ID
3. `docker kill canary-<task_id>` — 强杀，容器退出码 137

**断言**：
- watchdog 检测容器消失，`task.payload.cause` 为 `oom`（exit 137）或 `unknown`
- attempt 递增（重点火触发）
- canary 任务不出现在统计接口返回

---

### FR-10：卡交互注入

**输入**：
- staging brain 已注册 canary:true 任务

**行为**：
1. `tmux new-session -d -s canary-<task_id> "bash -c 'echo Press enter to continue; read'"` — tmux 挂起
2. 更新 staging task 关联 tmux session 名
3. 等待 watchdog 检测

**断言**：
- watchdog 检测到 tmux pane 含 `Press enter to continue`
- `task.payload.cause === 'interactive_stuck'`
- `tmux kill-session -t canary-<task_id>` 被调用（session 消失）
- attempt 递增

---

### FR-11：演习结果落档

**输入**：
- 演习完成（全通过或有失败）

**行为**：
1. 尝试 POST `/api/brain/incidents`（body 含 drill_type、injected_modes、results、task_ids）
2. 若 incidents 路由返回 404（刀5a 未就绪），降级写 design_docs：
   ```
   POST /api/brain/design-docs
   { type: 'drill_report', title: 'canary-drill-<date>', content: <json结果> }
   ```
3. 代码保留 `// TODO: incidents 表就绪后移除 design_docs 降级分支`

**断言**：
- Brain API 返回 2xx（incidents 或 design_docs 二选一）

---

### FR-12：nightly 定时触发

**选项 A（tick job）**：
- `packages/brain/src/canary-drill-scheduler.js` 在 tick loop 中注册 cron job：03:30 CST（UTC 19:30 前日）
- tick 检测时间窗口（±5min），满足则调用 `scripts/canary-death-drill.mjs --mode random`

**选项 B（launchd）**：
- `launchd/cecelia.canary-drill.plist` — StartCalendarInterval hour=19 minute=30（UTC，等于 CST 03:30）
- `launchctl load` 注册后 `launchctl list cecelia.canary-drill` 验证存在

本合同采用选项 A（tick job）作为主路线，选项 B 作为 macOS 备选。

**断言**：
- `GET /api/brain/tasks?type=canary_drill&status=scheduled` 返回当日计划任务

---

### FR-13：Bark 告警

**输入**：
- 演习任意断言失败

**行为**：
1. 复用 `packages/brain/src/notifier.js` 的 `sendBark(title, body)` 函数
2. 告警标题：`[CanaryDrill Failed] <mode>`
3. 告警内容：`task_id=<> 失败断言=<> 死法=<>`
4. 调用 `BARK_URL`（从环境变量读，缺失则 log warn + skip）

**断言**：
- `sendBark` 被调用一次
- 告警内容包含 task_id 和失败断言描述

---

### FR-14：canary:true 隔离过滤

**输入**：
- DB 中存在 `payload->>'canary' = 'true'` 的任务记录

**行为**：
在以下查询点加过滤条件 `AND (payload->>'canary' IS DISTINCT FROM 'true')`：
1. `GET /api/brain/dev-records`（`pr-callback-handler.js` INSERT + 查询）
2. `battle-report.js` — dev_records 24h 统计
3. `diary-scheduler.js` — dev_records count
4. 回归池入池逻辑（`harness-promote-regression.js`）
5. task 统计 dashboard API（如有聚合计数接口）

**断言**：
- 插入一条 `payload: { canary: true }` 的任务后，上述所有接口返回结果中不出现该任务

---

## E2E 验收

> 本 sprint 的 E2E 以演习脚本手跑为准（需 staging brain 5222 在线）；隔离过滤行为以 L1 vitest 为准。

**E2E 验收命令**（需 staging 在线）：

```bash
# OOM 演习（要求 docker 可用）
STAGING_BRAIN_URL=http://localhost:5222 \
  node scripts/canary-death-drill.mjs --mode oom

# kill-9 演习
STAGING_BRAIN_URL=http://localhost:5222 \
  node scripts/canary-death-drill.mjs --mode kill9

# 卡交互演习（要求 tmux 可用）
STAGING_BRAIN_URL=http://localhost:5222 \
  node scripts/canary-death-drill.mjs --mode interactive_stuck
```

**技术可验证断言**：

1. **OOM 演习** — 脚本 exit 0；Brain 任务 cause=oom；staging `/api/brain/tasks/<id>` 返回 `payload.oom_upgraded=true`（首次）或 `status=failed`（oom_wall）
2. **kill-9 演习** — 脚本 exit 0；Brain 任务 cause=oom 或 unknown；attempt 递增
3. **卡交互演习** — 脚本 exit 0；Brain 任务 cause=interactive_stuck；tmux session 消失（`tmux ls` 不含 `canary-<task_id>`）
4. **落档验证** — `curl http://localhost:5222/api/brain/design-docs?type=drill_report | jq '.[0].title'` 含 canary-drill 字样
5. **隔离验证** — `curl http://localhost:5222/api/brain/dev-records | jq '[.[] | select(.payload.canary == true)] | length'` 返回 0
6. **nightly 注册验证** — `curl http://localhost:5222/api/brain/tasks?type=canary_drill | jq '.[0].status'` 返回 scheduled 或 pending

**L1 vitest（隔离行为测试）**：

```bash
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/canary-isolation.test.js \
  sprints/07161400-a8-3-canary-drill/tests/ \
  --reporter=verbose 2>&1 | tail -40
```

---

## Test Contract

| BEHAVIOR | Test File | it() 名称（子串） |
|----------|-----------|-----------------|
| BEHAVIOR-1 canary 隔离过滤 dev-records | packages/brain/src/__tests__/canary-isolation.test.js | canary 隔离过滤 dev-records |
| BEHAVIOR-2 canary 隔离过滤回归池 | packages/brain/src/__tests__/canary-isolation.test.js | canary 隔离过滤回归池 |
| BEHAVIOR-3 canary 隔离过滤统计计数 | packages/brain/src/__tests__/canary-isolation.test.js | canary 隔离过滤统计计数 |
| BEHAVIOR-4 演习脚本生产端口守卫 | tests/regression/a8-3-canary-drill/canary-drill.contract.test.js | 演习脚本生产端口守卫 |
| BEHAVIOR-5 OOM 注入分类断言 | tests/regression/a8-3-canary-drill/canary-drill.contract.test.js | OOM 注入分类断言 |
| BEHAVIOR-6 演习落档降级写 design_docs | tests/regression/a8-3-canary-drill/canary-drill.contract.test.js | 演习落档降级 |
| BEHAVIOR-7 Bark 失败告警 | tests/regression/a8-3-canary-drill/canary-drill.contract.test.js | Bark 失败告警 |
| BEHAVIOR-8 nightly tick job 注册 | tests/regression/a8-3-canary-drill/canary-drill.contract.test.js | nightly tick job 注册 |

---

## 未覆盖真实链路清单

| 链路 | Mock 范围 | 豁免理由 |
|------|-----------|---------|
| `docker run --memory 128m` OOM 容器 | execFn stub（L1 测试） | L1 无 Docker 守护进程；OOM 真实行为在 E2E 演习脚本手跑中验证 |
| `docker kill <container>` | execFn stub（L1 测试） | 同上 |
| `tmux new-session` / `tmux kill-session` | execFn stub（L1 测试） | 测试环境无 tmux；真实行为在 E2E 演习中验证 |
| Bark HTTP 推送（`BARK_URL`） | sendBark stub（vi.fn） | 无 Bark token；L1 仅验证调用参数 |
| staging brain 5222 HTTP API | fetch stub（L1 测试） | staging 环境仅在 E2E 时在线 |
| `design_docs` / `incidents` 写库 | dbPool stub | 无测试数据库；验证 SQL 正确性即可 |
| launchd plist 注册（`launchctl load`） | 不在 L1 范围 | macOS 系统级操作，在部署验收中手动验证 |

**未 mock 的边（真实执行）**：
- `classifyDeath()` 纯函数（INV-07）
- canary 隔离过滤 SQL 条件构造（WHERE 子句正确性）
- Bark 告警消息内容构造（task_id、模式、失败断言文本）
- 演习结果 JSON 序列化（落档内容正确性）

---

## 铁律符合性确认

| 铁律 | 合同对应覆盖 |
|------|------------|
| INV-04：禁 mock 真实外部命令行为 | 未覆盖真实链路清单明确所有 mock 点；classifyDeath 必须真实执行 |
| INV-15：金丝雀只打 staging 5222 | 脚本开头校验 URL 不含 `:5221`；测试 stub 全指向 5222 |
| INV-16：canary 任务禁污染真实统计 | FR-14 + canary-isolation.test.js 行为测试锁死 |
| INV-17：三种注入方式固定 | FR-08/09/10 各一种，脚本不引入第四种注入方式 |
| INV-18：脚本禁执行真实 harness 逻辑 | 脚本只注册任务 + 轮询断言；不导入 harness 执行模块 |
