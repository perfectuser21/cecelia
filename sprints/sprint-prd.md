# Sprint PRD — mac_web generator/evaluator host 逃逸端到端验证（Slice4 透传 gap 修复后重新点火）

## OKR 对齐

- **对应 KR**：Cecelia harness pipeline mac_web 路径端到端可用
- **当前进度**：PR #3461 已合并（Slice4 透传 gap 修复）
- **本次推进预期**：验证 mac_web pipeline 从 generator → evaluator 全链路不再卡死，正确回写 Brain API

## 背景

PR #3461（Slice4 透传 gap）修复了 `runSubTaskNode` 漏传 `target_environment` 的问题。修复前，sub-graph 的 `extractTargetEnv` 默认 `local_api`（走 Docker），导致 mac_web 任务的 generator/evaluator 在无浏览器容器内跑 Playwright 卡死、不退出。修复后需一次真实点火确认接线生效。

## Golden Path（核心场景）

系统从 [Brain 接收 target_environment=mac_web 的 harness 任务] → 经过 [generator 走 host 逃逸执行 + evaluator 走 host 逃逸执行] → 到达 [任务到达终态并回写 Brain API 5221]

具体：
1. 向 Brain API（localhost:5221）POST 一个 harness 子任务，payload 含 `target_environment: mac_web`
2. Brain tick 派发该任务，`runSubTaskNode` 透传 `target_environment` 到 sub-graph
3. `extractTargetEnv` 在 sub-graph 读到 `mac_web`，generator spawner 走 `executeOnHost`（不走 Docker）
4. generator 在 macOS host 上执行完毕，结果写回 Brain（port 5221）
5. evaluator 同样走 `executeOnHost`，完成 E2E 验收断言
6. 任务状态变为 `completed` 或带明确 `failure_reason` 的 `failed`（不再是无限期 `running` 卡死）

## 边界情况

- generator 执行超时 → 任务 `failed` + failure_reason 非空，不卡死
- Brain API 短暂不可达 → host 逃逸应重试后回写，不静默丢失结果
- `target_environment` 字段缺失时（旧路径兼容）→ 默认 `local_api`，不影响本次 mac_web 验证

## 范围限定

**在范围内**：
- 验证 `runSubTaskNode` 透传 `target_environment=mac_web` 到 sub-graph
- 验证 generator spawner 调用 `executeOnHost` 而非 Docker 路径
- 验证 evaluator 同样走 host 逃逸
- 验证任务最终达到终态并回写 Brain（5221）

**不在范围内**：
- 修改任何 Brain / engine 代码（只做验证，不写新功能）
- 验证 `windows_cloud` / `local_api` 路径
- UI 截图验证（纯 pipeline 机制验证）

## 假设

- [ASSUMPTION: PR #3461 已合并到 main，本机 Brain 进程运行版本 ≥ 1.231.6]
- [ASSUMPTION: macOS host 有 Playwright 可用（已预装）]
- [ASSUMPTION: "端到端贯通到 5211" 为 5221 笔误；Brain API 端口以 5221 为准]

## 预期受影响文件

- 无代码变更——本 sprint 仅为验证 sprint，输出为 E2E 验收报告

## NFR 约束

<!-- 来源: decisions 表 category=nfr（Brain API 不可用时采集失败），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（generator 执行上限参照 Brain 现有 TASK_TIMEOUT 配置）
- 频控: 不适用（单次点火验证）
- 版本要求: Brain ≥ 1.231.6（含 Slice4 透传 gap 修复）
- 可观测: generator/evaluator 执行日志必须写入 Brain log；任务终态必须可 psql 查询确认

## E2E 验收

> proposer 按 target_environment=mac_web 填入真实脚本（Playwright 路径 + curl 验证 Brain 回写）

```bash
# 占位：proposer 将填入真实 E2E 脚本
# 期望验收点（自然语言）：
# 1. POST harness 子任务（target_environment=mac_web）到 Brain 5221，获取 task_id
# 2. 等待任务状态变为非 running（completed 或 failed），超时 120s 则报错
# 3. 确认 tasks 表该 task 的 executor_log 含 "executeOnHost" 字样（非 Docker）
# 4. 确认任务 status != "running"（不卡死）
# 5. 若 status=failed，failure_reason 非空且可读（有意义的错误，不是超时卡死）
```

## journey_type: dev_pipeline
## journey_type_reason: 验证 packages/brain/ harness 子图（runSubTaskNode → extractTargetEnv → executeOnHost）pipeline 机制，无 UI 交互
## target_environment: mac_web
## target_environment_reason: generator/evaluator 需在 macOS host 执行（host 逃逸路径），evaluator 同样走 mac host 验证回写 Brain 5221
## journey_id: <来源 task.payload.journey_id，当前 Brain API 不可用，待 proposer 阶段补填>
## step_id: <待 proposer 阶段从 PrepPRD 锚定>
