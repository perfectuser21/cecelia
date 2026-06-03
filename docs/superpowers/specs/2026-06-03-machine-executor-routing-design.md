# 设计：DB 驱动的「机器 + 执行器」统一路由

日期：2026-06-03
分支：cp-06031027-machine-executor-routing
状态：设计已确认，待实现

## 背景与目标

Brain 现在有**两套**任务路由：

1. **能力标签路由**（`task-router.js` `TASK_REQUIREMENTS` + `executor.js` 静态 `MACHINE_REGISTRY`）：按 `task_type → 标签` 选机器，`has_git` 类只有 us-m4 能跑，`general` 类任意机器。
2. **harness 专用全局开关**（`harness-task.graph.js` 的 `HARNESS_XIAN_ENABLED`）：一刀切把所有 harness 任务派到西安 codex bridge。

问题：harness 不走注册表、用全局开关粗暴；静态 `MACHINE_REGISTRY` 加机器要改代码；一台机器现在能跑多种执行器（worker-daemon 支持 claude/codex 双 mode），但注册表把机器绑死一个 type。

**目标**：统一成一套 DB 驱动的路由 —— 任务可显式指定 `{machine, executor}`，否则按能力标签默认（默认 **us-m4 / claude**）。机器从 DB 设备表读，注册新机器=插一行（将来 Dashboard 下拉选）。harness 收编进来，删掉 `HARNESS_XIAN_ENABLED`。

**用户规则**（feedback memory）：默认美国 M4 + Claude Code；codex/西安仅按需（用户明确指定时）。

## 范围

- 所有任务类型统一路由（不只 harness）。
- 复用现有 DB 设备表 `system_registry`（type=machine）+ `routes/machines.js`，不新建表。
- 不改 worker-daemon（已支持 mode + repo + callback 重写，infrastructure repo 已部署西安）。

## 架构

### 单元 1：设备表 metadata 的 `executors` 约定（数据）

真相源 = `system_registry`（type=machine）。每台机器 `metadata` 增加一个 `executors` 数组，**只列已部署的（机器, 执行器）组合**：

```json
"executors": [
  { "executor": "claude", "url": "http://localhost:3457", "default": true },
  { "executor": "codex",  "url": "http://host.docker.internal:13458" }
]
```

- `executor`：`claude` | `codex`
- `url`：该执行器在该机器上的 daemon 地址（Brain 容器视角，host.docker.internal:13458=西安隧道）
- `default`：该机器缺省执行器（机器只标了不带 executor 时用）

**seed 现有机器**（写进各自 system_registry 行的 metadata，幂等 upsert 脚本）：
- `mac-mini-m4-us`：`[{claude, http://localhost:3457, default}]`（codex 组合美国未部署 daemon，暂不列）
- `xian-m4`：`[{codex, http://host.docker.internal:13458, default}]`（worker-daemon，走现有 SSH 隧道）
- `xian-m1`：按实际部署（暂列 codex 或留空 = 不可路由）

能力标签继续放 `metadata.tags`（`has_git` / `general` / `has_browser`）。机器 `status=active` 才可路由。

接口：现有 `GET /api/brain/machines`（下拉数据源）、`PATCH /:name`（改 metadata）已够；**新增 `POST /api/brain/machines`**（注册新机器，将来海口 M5）。

### 单元 2：`resolveExecutor(task, deps)` 路由器（逻辑）

新模块 `packages/brain/src/routing/resolve-executor.js`，取代 `executor.js` 静态 `MACHINE_REGISTRY` + `selectBestMachine` 的职责。纯逻辑可注入 DB 读取，便于单测。

输入：`task`（含 `task_type`、`payload`）。输出：`{ machineId, executor, url }` 或抛错。

解析顺序：
1. **显式**：`payload.machine` + `payload.executor` 都有 → 查 DB 该机器（active）→ 校验它 `executors` 里有该组合 → 返回 `{machineId, executor, url}`。组合不存在/机器非 active → **抛明确错误**（不静默改派）。
2. **半显式**：只给 `payload.machine` → 用该机器 `default` executor；只给 `payload.executor` → 在拥有该 executor 的 active 机器里按现有负载策略选一台。
3. **能力标签默认**：都没给 → `TASK_REQUIREMENTS[task_type]` 取标签 → 选满足标签的机器（保持现有逻辑）→ 用其 default executor。
4. **兜底**：无匹配 → **us-m4 / claude**。

DB 读取走一个薄封装 `loadMachines()`（查 system_registry type=machine status=active，带短缓存），单测时注入假数据。

### 单元 3：harness 收编（接线）

`harness-task.graph.js`：
- 删掉 `HARNESS_XIAN_ENABLED` / `HARNESS_XIAN_BRIDGE_URL` 分支（第 ~252-272 行）。
- 改为 `const route = await resolveExecutor(task)`；按 `route.executor`：
  - `claude` → 现有 docker 派发（spawnDockerDetached，美国本地 cecelia/runner）。
  - `codex` → POST `route.url`/run，payload `{ task_id, task_type, prompt, skill, branch, callback_url, repo: state.baseRepo||payload.base_repo, mode:'codex' }`（worker-daemon 侧已就绪：mode 路由 + repo→codex-task.sh 出 PR + callback 重写）。
- `callback_url` 仍用 `host.docker.internal:5221/...`，worker-daemon 会重写成真实 Brain 地址。

### 单元 4：任务字段 + 默认（接口）

- 任务 `payload` 可选 `{ machine, executor }`。`/dev` 路径 C 点火 harness_initiative 时，用户说"用西安 codex"→ payload 带 `{machine:'xian-m4', executor:'codex'}`；不带 = 默认。
- 非 harness 任务也可带该字段做 override（统一）。
- 缺省行为完全等价现有（标签路由 + us-m4 默认），保证不回归。

## 错误处理

- 显式请求非法组合（机器无此 executor / 机器非 active）→ 抛 `ExecutorRouteError`，任务标 failed + 清晰 reason（不偷偷改派，避免"我以为跑西安结果跑美国"）。
- DB 读取失败 → 降级到硬编码 us-m4/claude 兜底 + 告警（路由不能因 DB 抖动全挂）。

## 测试策略

- **单元**（主）：`resolve-executor.test.js` 注入假 machines —— 显式合法组合 / 显式非法组合抛错 / 半显式机器 / 半显式执行器 / 标签默认 / 无匹配兜底 us-m4 / DB 失败降级。
- **集成**：`POST /api/brain/machines` 创建 + `GET` 列表 + PATCH metadata（machines.test.js 扩展）。
- **回归**：现有 task-router / harness graph 测试保持绿（缺省路径行为不变）。
- **Smoke（已具备链路）**：harness 任务带 `machine=xian-m4,executor=codex` → 路由到 worker-daemon → codex-task.sh 出 PR（infrastructure 侧已实测通）。本 spec 不在 CI 跑真实跨机 smoke，只在单测覆盖 resolveExecutor 决策。

## 不做（YAGNI）

- 不做机器健康自动探活/摘除（status 手动 PATCH 即可，将来再说）。
- 不做 Dashboard 下拉 UI（只保证 `GET /machines` 数据就绪）。
- 不做 us-m4 codex daemon 部署（美国暂只 claude；要时再加注册表组合）。
- 不动 worker-daemon（infrastructure repo，已完成）。
