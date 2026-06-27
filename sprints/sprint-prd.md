# Sprint PRD — harness 内部线 staging→promote→release→deploy 贯通验证（9-slice 后首次干净 run）

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 端到端自动化贯通
- **当前进度**：9-slice 修复已合并（PR #3455–#3459），待首次干净 run 确认
- **本次推进预期**：pipeline 从 generator 到 :5211 全链路 PASS，确认无死代码干预通道残留

## 背景

9 个 slice（Slice1–Slice9）修复了 harness 内部线从合同入库、E2E 锚定、mac_web 宿主逃逸、staging 并发止血到 promote 复合闸的全部已知阻断点。本 sprint 触发一次真实的 harness initiative，验证整条流水线 staging→auto_promote→:5211 首次干净跑通，不依赖 mock / fallback，任何阶段 FAIL 视为 pipeline 尚未贯通。

## Golden Path（核心场景）

Brain executor 从 [点火一个最小 dashboard 触点 initiative] → 经过 [generator 产 PR → CI 绿 → staging 部署 :5223 → E2E PASS → auto_promote → dashboard 重部署 :5211] → 到达 [DB 记录 promote_status=auto_promoted，:5211 响应正常]

具体：
1. Brain 调度器 pick up initiative，spawnNode 以 `target_environment=mac_web` / `local_api` 正确路由，generator 在宿主执行并产出 PR
2. PR CI 通过，merge 到 main
3. `staging-e2e-runner` 调 `deploy-local.sh`，dashboard 部署到 staging :5223；E2E 验收脚本跑完，`staging_e2e_results.verdict=PASS`、`tested_sha` 落库
4. Slice9 复合闸通过（initiative 无 FAIL 行 + SHA 未漂移）→ `runInternalPromote` 执行 `promote-dashboard.sh`，`promote_status` 更新为 `auto_promoted`
5. Dashboard 重起于 :5211，`harness_report` 任务自动派出并完成

## 边界情况

- staging E2E FAIL → promote_status 保持 n_a，initiative 不终态为 PASS，本次验证失败
- SHA 漂移（promote 前 HEAD 变化）→ Slice9 闸挂 pending，视为失败
- :5211 未响应 → 视为 deploy 未贯通
- [ASSUMPTION: 触点选最小 dashboard 改动（版本注释或 VITE_APP_VERSION 环境变量），不引入功能逻辑，目的只是让 pipeline 有内容可跑]

## 范围限定

**在范围内**：
- 从 initiative 点火到 :5211 可访问的全链路单次端到端验证
- DB 状态检查（staging_e2e_results、tasks harness_report）
- :5211 存活检查

**不在范围内**：
- 修复新发现的 pipeline bug（遇到新 bug → 登记 issue，本 sprint 改结论为 FAIL）
- 验证 zenithjoy 客户线（本 sprint 仅 cecelia 内部线）
- 性能/并发压测

## 假设

- [ASSUMPTION: Brain 服务运行在 localhost:5221，数据库可访问]
- [ASSUMPTION: scripts/deploy-local.sh、scripts/promote-dashboard.sh 在 9-slice 修复后已就绪]
- [ASSUMPTION: 最小触点由 proposer 选定（如 VITE_APP_BUILD_SHA 注释行），不影响功能]

## 预期受影响文件

- `packages/brain/src/staging-e2e-runner.js`：验证路径（只读，不改）
- `packages/brain/src/staging-promote.js`：promote 路径（只读，不改）
- `apps/dashboard/`：最小触点（proposer 选定具体文件）
- `packages/brain/src/workflows/harness-initiative.graph.js`：点火路径（只读）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（Brain API 会话不可达，values 取保守默认）+ PrepPRD 无显式 NFR -->
- 超时/延迟: staging deploy 超时 120s（沿用 staging-e2e-runner 当前默认）
- 频控: 单次验证 run，无频控需求
- 版本要求: Dashboard Node.js ≥18，Brain ≥当前 package.json 版本
- 可观测: 每个阶段状态必须写 Brain DB（staging_e2e_results + tasks），失败必有 failure_reason 字段

## E2E 验收

> Planner 框定"端到端要验到什么"，proposer 按 target_environment=local_api 填入可执行脚本。

```bash
# 占位：proposer 将填入真实命令（local_api → psql + curl 模板）
# 期望验收点：
# 1. staging_e2e_results 中 initiative_id=$INITIATIVE_ID 行 verdict=PASS、promote_status=auto_promoted、tested_sha 非空
# 2. tasks 中 task_type=harness_report、payload->initiative_id=$INITIATIVE_ID 行 status=completed
# 3. curl http://localhost:5211/（或 /health）返回 HTTP 200，非空响应
# 全部满足 → pipeline 贯通确认；任一失败 → 输出 FAIL + 具体断言行
```

## journey_type: autonomous
## journey_type_reason: harness 内部线 pipeline 自动调度执行，无用户界面交互
## target_environment: local_api
## target_environment_reason: 验查 Brain DB（psql localhost）+ curl localhost:5211，全在本机，无需远端或浏览器
## journey_id: <待补：来源 task.payload.journey_id，Cecelia 唯一内部线 journey UUID>
## step_id: <待补：harness pipeline 贯通验证 step，来源 PrepPRD 锚定结果>
