# Contract Draft: codex 有头 tmux 派发（Sprint 1/3）

task_id: 4cedf175-3b56-4d41-91b6-73de559f58c9
sprint_dir: sprints/07071654-codex-headed-dispatch
generated: 2026-07-07

---

## 概述

本合同覆盖 Sprint 1/3 的最小验证片：为 Brain skill-relay 新增 `mode=headed` 分支，使 codex TUI 跑在宿主机 tmux session 里，而不是 docker 容器里。默认路径（无头 docker）不受影响。

---

## 交付范围

| 组件 | 改动描述 |
|------|----------|
| `packages/brain/src/skill-relay.js`（或相关文件） | 新增 headed 分支：不起 docker，走 ssh+tmux |
| `packages/brain/src/host-executor.js`（或相关文件） | prompt 文件写入宿主 `/tmp/cecelia-host-prompts/<taskid>.<instance>.prompt` |
| `packages/brain/src/watchdog.js`（或相关文件） | headed 分支存活检测：`ssh 宿主 tmux has-session`，ssh 失败 fail-open |
| DB migration | `initiative_runs` 新增 `tmux_killed_at` 列（或等价方案） |
| 单测 `*.test.js` | 5 条 NFR 场景（vitest，mock spawnFn/execFn） |

---

## 不交付（本 sprint 范围外）

- 切换默认模式（Sprint 2 负责）
- 账号池逻辑
- `executor=claude + mode=headed` 的实现（只拒绝，不实现）

---

## E2E 验收

### E2E-01：headed 任务入队校验

**前置条件**：Brain 服务运行在 localhost:5221

**步骤**：
1. `POST /api/brain/tasks` body: `{ "executor": "codex", "mode": "headed", "prompt": "echo dry-run", ... }`
2. `POST /api/brain/tasks` body: `{ "executor": "claude", "mode": "headed", ... }`

**期望结果**：
- 步骤 1：HTTP 200/201，任务正常入队，返回 task_id
- 步骤 2：HTTP 400，返回错误信息，不入队

---

### E2E-02：headed dry-run 派发 tmux session

**前置条件**：host.docker.internal 可 ssh 访问，tmux 可用，CODEX_RELAY_HOME 配置正确

**步骤**：
1. 触发一个 `mode=headed` 的 codex run（dry-run / echo 型短 prompt）
2. 等待 skill-relay 处理
3. 检查 tmux session 存活
4. 检查宿主 prompt 文件

**期望结果**：
- `ssh host.docker.internal tmux has-session -t codex-relay-<short>` 返回 exit 0
- `/tmp/cecelia-host-prompts/<taskid>.<instance>.prompt` 文件存在
- 文件内容 sha256 与发送内容匹配（sha256sum 比对）
- 文件权限为 0600（chmod 验证）
- `initiative_runs` 表中 `orchestrator_host='skill-relay-codex-headed'` 行存在
- deadline 设置为 8h（DB 查询 deadline 字段验证）

---

### E2E-03：看门狗 headed 分支 fail-open

**前置条件**：有一个 `mode=headed` 的 in-progress run，模拟 ssh 命令失败（网络/权限）

**步骤**：
1. 制造 ssh 不可达场景（或 mock）
2. 触发 watchdog 检测
3. 观察 watchdog 行为

**期望结果**：
- watchdog 不触发重点火（attempts 不递增）
- 日志中有 fail-open 相关记录
- run 状态保持不变（不强制置 failed）

---

### E2E-04：收窗幂等

**前置条件**：一个已完成（done 或 failed）的 headed run

**步骤**：
1. 等待 run 进入终态
2. 等待 30min 保留窗口后（或手动触发收窗逻辑）
3. 再次触发收窗逻辑

**期望结果**：
- `tmux kill-session` 只执行一次
- 第二次触发时不再 ssh kill（`tmux_killed_at` 已有值，跳过）
- initiative_runs 中 `tmux_killed_at` 字段有时间戳

---

### E2E-05：默认路径零回归

**前置条件**：现有无头 docker codex run

**步骤**：
1. `POST /api/brain/tasks` 不携带 `mode` 字段（或 `mode=headless`）
2. 观察派发路径

**期望结果**：
- 走现有 docker 路径
- 不产生 tmux session
- 不产生宿主 prompt 文件
- 现有回归测试全通

---

## 验收标准汇总

| 编号 | 描述 | 验收方式 |
|------|------|----------|
| AC-01 | codex+headed 正常入队 | E2E-01 步骤 1 |
| AC-02 | claude+headed 返回 400 | E2E-01 步骤 2 |
| AC-03 | headed dry-run → tmux session 存在 | E2E-02 tmux has-session |
| AC-04 | 宿主 prompt 文件存在且内容匹配 | E2E-02 文件 sha256 |
| AC-05 | initiative_runs orchestrator_host 正确 | E2E-02 DB 查询 |
| AC-06 | watchdog ssh 失败 fail-open | E2E-03 行为观察 |
| AC-07 | 收窗幂等，tmux_killed_at 不重复 | E2E-04 DB + 日志 |
| AC-08 | 默认无头路径零回归 | E2E-05 |
| AC-09 | CI 全绿，含单测 | CI pipeline |
| AC-10 | tui.log 洗敏，无裸露 token | 日志检查（B-06） |
| AC-11 | prompt 传递非 $(cat) 内联 | 代码 grep（B-07） |
| AC-12 | 未引入账号池逻辑 | 代码/DB grep（B-08） |

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|------|-----------|--------------|-----------|
| headed 模式校验与 ssh+tmux 派发 | `../../packages/brain/src/__tests__/codex-headed-dispatch.test.js` | validateHeadedMode(executor=claude, mode=headed) / validateHeadedMode(executor=codex, mode=headed) / mode 缺省 → spawnFn / mode=headed → sshFn 被调用（tmux new-session）/ mode=headed → initiative_runs 落行 orchestrator_host=skill-relay-codex-headed / mode=headed → deadline=8h / mode=headed → prompt 通过文件方式传递（不含 $(cat) 内联） | → 7 failures（harness-skill-relay.js 无 headed 分支）|
| watchdog fail-open 与收窗幂等 | `../../packages/brain/src/__tests__/codex-headed-dispatch.test.js` | ssh 命令失败（exitCode!=0）→ watchdog 不递增 attempts / tmux_killed_at 已有值 → 不再调用 sshFn kill-session / tmux_killed_at 为 null → sshFn kill-session 被调用，并更新 DB tmux_killed_at | → 3 failures（harness-relay-watchdog.js 无 headed 分支）|
