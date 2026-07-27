# Sprint PRD — Kernel CI/Preview Required Context Contract Recovery

## OKR 对齐

- **对应 KR**：KR-待定（Brain context 未返回活跃 KR 编号）
- **当前进度**：未知（`/api/brain/context` 未返回 OKR 进度）
- **本次推进预期**：恢复 Kernel 针对 `local_api` 与 preview 目标的 CI gate 判定可信度，消除错误 generator-fix 循环

## 背景

当前 Kernel 把所有 failing GitHub `statusCheckRollup` 一律映射为 `ci=fail`，即使任务的 `target_environment=local_api` 且不依赖 preview，也会被全局红的 Deploy Preview Environment 永久阻断。与此同时，`/preview/start` 的 curl `exit 22` 会吞掉响应状态码与 body，导致外部基础设施失败证据丢失。该 sprint 需要把 required contexts 的判定收回到服务端，用当前 head SHA 与可信 `target_environment` 决定哪些上下文必须通过、哪些必须记为中立，并保持 staging/production 的硬闸不被削弱。

## Golden Path（核心场景）

Kernel 从任务记录读取服务端持有的 `target_environment` 与当前 head SHA → 只计算该目标真正要求的 required contexts → 基于这些上下文给出可继续/必须阻断的结果，并保留 preview 启动失败的状态码、响应体与错误证据。

具体：
1. 当一次 `local_api` 变更进入 Kernel gate 判定时，系统使用服务端任务数据里的 `target_environment=local_api` 和当前 head SHA 选出该环境所要求的上下文，而不是相信客户端提交的 required contexts。
2. 如果 preview 不是 `local_api` 的必需上下文，系统把 preview 结果记为中立/跳过；只有 `local_api` 需要的上下文全部在当前 SHA 上通过时，系统才允许继续。
3. 如果任务目标依赖 preview，则 preview 失败、缺失、SHA 过期、仓库或 run 不匹配时，系统必须硬阻断，并在结果中保留 preview 启动返回的状态码、响应 body 与错误信息，供后续定位。
4. 对 post-merge staging/production 场景，系统继续执行 fail-closed：任何 required context 失败或缺失都不得被中立化，也不得因为 rollout 兼容逻辑而放行。

## 边界情况

- 当前 head SHA 与收到的检查结果 SHA 不一致时，判定为过期结果，不得拿旧检查放行新提交。
- 检查结果来自错误仓库、错误 run 或无 required context 映射时，判定失败并返回可审计原因。
- preview 外部基础设施异常时，必须同时保留 HTTP 状态、响应 body 与 curl/网络错误证据，不能只留下 `exit 22`。
- legacy rollout 仍可读取旧字段，但不得覆盖服务端基于目标环境生成的 required contexts。
- generator-fix 仅能在真正 required context 失败时进入；preview 对 `local_api` 中立时不得触发修复循环。

## 范围限定

**在范围内**：Kernel 基于服务端可信 `target_environment` 和当前 head SHA 生成 required-context 合同；`local_api` 对 preview 记中立；preview 目标 fail-closed；保留 preview 失败证据；补齐 target-aware gate 与 post-merge staging/production 相关测试。
**不在范围内**：修改 preview 基础设施本身的稳定性；放宽 staging/production gate；依赖客户端直接上传 required contexts；引入新的部署环境类型。

## 假设

- [ASSUMPTION: 本次改动锚定在 Brain/Kernel 后端路径，主要影响 `packages/brain/` 内的 gate 判定与 preview 启动结果记录。]
- [ASSUMPTION: `task.payload.target_environment=local_api` 为本 sprint 的交付目标环境，其他环境通过合同映射继承新判定规则。]
- [ASSUMPTION: journey 锚点 `step_id=0cdadc1a-e3a0-46a1-8333-ebbc102883f7` 即本次 required-context gate recovery 所属步骤。]

## 预期受影响文件

- `packages/brain/src/`: Kernel gate 判定、required-context 合同、preview 结果证据保留逻辑
- `packages/brain/server.js`: 若路由装配需要暴露更新后的判定/启动结果
- `packages/brain/test/` 或同级测试目录: 覆盖 local_api 中立、preview 硬失败、SHA 过期、repo/run 隔离、缺失 required context、legacy rollout、generator-fix transition、staging/prod hard gate

## NFR 约束

- 超时/延迟: preview 启动失败必须在单次判定内返回，不可因重试吞掉原始失败证据
- 频控: 不新增绕过服务端合同的客户端重试入口；同一 SHA 仅接受当前 head 对应的 gate 结果
- 版本要求: 兼容 legacy rollout 输入，但服务端 required-context 合同优先
- 可观测: 必须保留 preview 启动的 HTTP 状态、响应 body、错误对象/退出信息，并在 gate 结果中可审计

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [环境可信] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境验证] 依赖真机/生产env/真实调用方的接缝断言必须在真目标上验证过才算 done；未真验只能标 logic-done-pending（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块保留占位，由 proposer 按 `local_api` 生成最终可执行脚本。

```bash
# 占位：proposer 将按 local_api 生成 curl/测试命令
# 期望验收点（自然语言）：
# 1. local_api 任务在 preview 全局红时仍把 preview 记为 neutral/skipped，且仅当 local_api 所需上下文全部在当前 head SHA 上通过时继续。
# 2. preview 目标在 preview 失败、缺失、SHA 过期、repo/run 不匹配时一律硬阻断，并输出状态码、响应 body、错误证据。
# 3. post-merge staging/production required contexts 任一失败或缺失时保持硬阻断。
# 4. 相关测试证明 local_api neutral、preview hard fail、stale SHA rejection、wrong repo/run isolation、missing required context、external infrastructure evidence、legacy rollout、generator-fix transition、staging/prod gates 全部可触发。
```

## journey_type: autonomous
## journey_type_reason: 任务聚焦 Kernel/Brain 后端 gate 判定与 CI 合同恢复，未涉及 Dashboard 或远端 agent UI。
## target_environment: local_api
## target_environment_reason: payload 已显式给出 `local_api`，验收应在本地 Brain API/Kernel 后端环境执行。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
