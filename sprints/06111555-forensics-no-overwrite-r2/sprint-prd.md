# Sprint PRD — Agent 取证文件按运行实例唯一命名（防覆盖 R2）

## OKR 对齐

- **对应 KR**：Harness Pipeline 可观测性 / 排障可靠性（取证证据不丢失）
- **当前进度**：[ASSUMPTION: Brain context 不可达，进度待 Brain 回填]
- **本次推进预期**：补齐"同任务多次运行取证文件互不覆盖"的能力闭环

## 背景

取证文件（`/Users/administrator/claude-output/cecelia-prompts/<CECELIA_TASK_ID>.prompt/.stdout/.cid`）以任务 ID 命名，同一 task/sub-task 重跑时原地覆盖，排障证据丢失（2026-06-11 两次实证）。

前一次 run（PR #3344，已关闭）因 Golden Path 要求"容器实测"而 evaluator 容器内无 docker daemon，被 `env_missing` 红线正确打回。本次按 evaluator 环境能力重新划分验证层次：**E2E 只验容器内可验的全部逻辑（node/bash/ls/jq）；真实容器冒烟下沉到 post-deploy smoke（宿主有 docker 时执行）**。#3344 实现可参考，但以本合同为准。

## Golden Path（核心场景）

系统从 [同一 task 第二次运行写取证] → 经过 [spawn 侧唯一命名 + entrypoint 按 env 读同一唯一文件] → 到达 [两组取证文件并存、可按 task id 前缀检索]

具体（全部在 evaluator 容器内真实执行，无 docker 依赖）：

1. 直接调用 spawn 侧 prompt 写入逻辑两次（同一 task id，模拟两次运行）→ 取证目录出现两组文件名可区分的 `.prompt` 文件，各自内容正确、互不覆盖。
2. `ls cecelia-prompts/ | grep <task id 前缀>` → 两组文件均能按前缀检索到（排障习惯不破坏）。
3. 协议对账：把 `entrypoint.sh` 当普通 bash 脚本测，注入 env（如 `CECELIA_PROMPT_FILE` 或等价机制）运行其 prompt 读取片段 → 它读取的正是 spawn 侧第 2 次写入的那个唯一文件名，而非旧的拼接路径。
4. cid / stdout 路径同样按运行实例唯一化 → 断言生成的 docker run 参数（dry-run 或参数构造函数输出）中三类路径（prompt / stdout / cid）均含实例后缀。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry/代码后推导，本任务为脚本/协议改动，无 HTTP 响应契约。 -->

## 边界情况

- **向后兼容**：env 缺失时 entrypoint 必须回退旧拼接逻辑（滚动部署期新旧镜像共存，不能因 env 缺失而读不到 prompt）。
- **批量清理**：按 task id 前缀的批量 `ls`/`rm` 清理仍可行。
- **并发**：同 task 两次运行时间相近，实例后缀必须保证唯一（不依赖纯时间戳秒级精度的碰撞）。

## 范围限定

**在范围内**：
- spawn 侧（docker-executor.js / host-executor.js）三类取证路径（prompt / stdout / cid）按运行实例唯一命名。
- entrypoint.sh 协议同步：优先按注入 env 读完整文件名，缺失时回退旧拼接。
- post-deploy smoke 脚本 `forensics-no-overwrite-smoke.sh`（宿主真实 spawn 容器验证）。

**不在范围内**：
- 容器实测本身不在 E2E（evaluator 无 docker），归 post-deploy smoke。
- 取证文件保留策略 / 自动清理调度（另议）。
- 镜像重建本身（merge 后由人/CI `bash docker/build.sh` 执行，PR 描述注明）。

## 假设

- [ASSUMPTION: spawn 侧用"完整文件名经 env 传入容器、容器不自己拼路径"作为新协议，env 名沿用 `CECELIA_PROMPT_FILE` 或代码现有等价变量，由 proposer 读码确定]
- [ASSUMPTION: journey/进度字段待 Brain context 恢复后回填]

## 预期受影响文件

- `packages/brain/src/docker-executor.js`：三类取证路径唯一化 + docker run 参数传完整文件名 env。
- `packages/brain/src/spawn/host-executor.js`：prompt/stdout/cid 写入路径同步唯一化。
- `docker/cecelia-runner/entrypoint.sh`：按 env 读完整文件名，缺失回退旧拼接。
- `packages/brain/scripts/smoke/forensics-no-overwrite-smoke.sh`（新增）：宿主侧容器实测冒烟。
- `docker/build.sh`：无需改，但 entrypoint 变更意味着 merge 后需重建 runner 镜像（PR 描述注明）。

## E2E 验收

> Planner 初稿占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node/bash/ls/jq，无 docker）。

```bash
# 占位：proposer 将填入真实 local_api 脚本（node 直调写入逻辑 + bash 跑 entrypoint 片段 + ls/grep + jq 断言）
# 期望验收点（自然语言）：
#  1. 同一 task id 调 spawn 写入逻辑两次 → 取证目录两组 .prompt 文件名可区分、内容各自正确、第一组未被覆盖
#  2. ls cecelia-prompts/ | grep <task id 前缀> → 两组文件均被检索到
#  3. 以注入 env 跑 entrypoint 的 prompt 读取片段 → 读到的是第 2 次写入的唯一文件名（非旧拼接路径）；env 缺失时回退旧逻辑仍能读到
#  4. dry-run/参数构造输出的 docker run 三类路径（prompt/stdout/cid）均含实例后缀
# post-deploy smoke（宿主，有 docker，merge 后由 run_post_deploy_smoke 自动跑）：
#  - bash packages/brain/scripts/smoke/forensics-no-overwrite-smoke.sh → 新镜像真实 spawn 最小容器，断言容器读到自己的 prompt 且 stdout 取证以唯一名落盘
```

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain/ 与 docker/ 运行时容器协议，无 dashboard/bridge/engine，属纯后端自治能力。
## target_environment: local_api
## target_environment_reason: Golden Path 全部用 node/bash/ls/jq 在 evaluator 本地容器内可验、无 docker 依赖；真实容器实测下沉 post-deploy smoke（宿主 docker）。
## journey_id: <来源 task.payload.journey_id（/dev 路径 C 点火写入）；Brain context 不可达，待回填，锚定 Cecelia Line 唯一 = Harness Pipeline>
## step_id: <Harness Pipeline · 取证可靠性步；来源 = PrepPRD Golden Path 锚定，Brain 恢复后回填 Step UUID>
