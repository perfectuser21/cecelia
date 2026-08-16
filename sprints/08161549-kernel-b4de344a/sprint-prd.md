# Sprint PRD — Fleet Runner run 级双容器（工作容器常驻 + 干净评估容器）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+2%（算力全开：5GB VM 从「同时 1 个自治 attempt」提升到「≥2 条 run 并行」，且候选不再蒸发）

## 背景

决策 05585020-918a-4655-a82c-e768d33a3b62（Alex 08-16 拍板）：隔离粒度 = run，不再每个 attempt 一个容器。现状 fleet-worker/attempt-runner 每 attempt 起一个 `cecelia-fleet-<attempt-id>` 容器跑完即销毁，OrbStack VM 仅 5GB → 本机只放 1 个自治 attempt，4 条 run 排 1 个窗口；且 Generator（#4901）只在容器工作区提交本地候选不 push，容器回收后候选蒸发（run f62c7e87 候选 a7f7a80d、run d1360a48 候选 90da7d33 均在 Evaluator 前丢失）。本 sprint 落双容器模型：工作容器一条 run 常驻，评估容器每次评估从候选 SHA 干净 clone。前一单死于 Evaluator frozen_baseline_guard_unavailable（.dev-lock 被冻结候选树断言当污染），已由 PR #4912 修复并重钉 Runner（Brain 1.273.60），方向可沿用。

## Golden Path（核心场景）

系统从 [initiative_run 首个 attempt 到达 fleet worker] → 经过 [工作容器常驻 + Generator 候选落 quarantine + 干净评估容器] → 到达 [一条 run 稳定 ≤2 容器、候选不丢、≥2 run 并行]

具体：
1. initiative_run 首个 attempt 到达 → fleet worker 创建（或复用已有）工作容器 `cecelia-fleet-run-<run8>`，打 label `cecelia.run_id`，记录 container_id 到 initiative_runs（新列或 payload）。
2. 同 run 后续 attempt（Planner/Proposer/Reviewer/Generator）→ 在同一工作容器内 docker exec 启新 provider 进程：每 attempt 仍是 fresh session（独立 TaskBundle、独立 callback token/scoped route token、独立 lease），共享同一容器与工作区（clone at base_sha），Generator 候选留在工作区不丢。
3. Generator 完成 → 候选 SHA 经 git bundle 落 host quarantine 卷（Brain 可读、只写一次、按 run 清理）。
4. Evaluator attempt（含 evidence repair）→ 每次起全新评估容器 `cecelia-fleet-eval-<attempt8>`，从 quarantine bundle 干净 clone 到候选 SHA（不 fetch 远端），依赖按锁文件重装，不继承工作容器的 node_modules/缓存/hooks/tmp；Judge 断言由 Brain 侧 Runner 在评估容器内执行。
5. run 终态（done/failed/cancelled，含 orphan-guard 判死）→ 销毁工作容器；lease 过期/kernel 崩溃后由 reconcile 按 run_id 找回同一工作容器继续，不新建。
6. 可观测出口：`docker ps` 一条 run 从 Planner 到 Generator 只见 1 个 `cecelia-fleet-run-<run8>`，Evaluator 阶段多出且仅多出 1 个 `cecelia-fleet-eval-*`；psql 查 harness_attempts 同 run 的 attempt 共享 container_id；同时刻 ≥2 条 run 各自容器并行。

## 边界情况

- 首个 attempt 竞态并发到达同一 run → 只创建一个工作容器（幂等按 run_id 复用，不重复创建）。
- kernel 崩溃/lease 过期后重入 → reconcile 按 run_id + label 找回既有容器，禁止新建蒸发候选。
- Generator 候选 bundle 已存在（重跑）→ quarantine 只写一次，二次写入拒绝或幂等跳过。
- Evaluator 容器读不到 quarantine bundle → fail-closed 报错，禁止回退 fetch 远端伪造候选。
- FLEET_RUN_SCOPED_CONTAINER=off → 回退单 attempt 容器模式（fallback），行为与改造前一致。

## 范围限定

**在范围内**：fleet-worker/attempt-runner run 级容器生命周期（创建/复用/exec/销毁/reconcile）、容器 label cecelia.run_id、container_id 持久化到 initiative_runs、Generator 候选 git bundle 落 quarantine、Evaluator 评估容器从 bundle 干净 clone、Brain 侧 machine capacity 改按并发 run 容器计（per-run autonomous_singleton + xian per-run 选机）、feature flag FLEET_RUN_SCOPED_CONTAINER（默认 on，off 回退）。

**不在范围内**：去掉 Docker（Alex 接受一条链一个容器）；把 Claude 派到 xian；改合同/闸语义；改 Judge 归属（保持 Brain 侧独立）。

## 假设

- [ASSUMPTION: container_id 优先落 initiative_runs 新列 `work_container_id`；若迁移成本高则退回 payload.work_container_id，二者取其一由 Proposer 定]
- [ASSUMPTION: quarantine 卷路径沿用现有 host quarantine 卷约定，按 run_id 建子目录、run 终态清理]
- [ASSUMPTION: 每 run 工作容器资源上限 mem 2GB / cpu 2；5GB VM 据此算出 ≥2 并发 run 容器]

## 预期受影响文件

- `packages/brain/scripts/fleet-worker/attempt-runner.cjs`：容器命名从 `cecelia-fleet-<attemptId>` 改为 run 级 `cecelia-fleet-run-<run8>` + eval 级 `cecelia-fleet-eval-<attempt8>`，创建/复用/exec/销毁/reconcile 生命周期
- `packages/brain/scripts/fleet-worker/fleet-worker.cjs`：run 级容器绑定、container_id 持久化、terminal 销毁触发
- `packages/brain/scripts/fleet-worker/workspace-manager.cjs`：run 工作区共享 clone + Generator 候选 git bundle 落 quarantine + Evaluator 从 bundle 干净 clone
- `packages/brain/src/orchestrator/fleet-node/node-profile.js`：capacity 改按并发 run 容器数（per-run）
- `packages/brain/scripts/fleet-worker/*.test.cjs` / `fleet-worker.test.js`：run 级生命周期、防污染、信任回归、容量单测
- `packages/brain/DEFINITION.md` + `package.json`：Brain semver + DevGate facts 同步

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空；以下取自 PrepPRD 显式值 -->
- 资源上限: 每 run 工作容器 mem 2GB / cpu 2
- 容量: 5GB VM 下 capacity 计算须得出 ≥2 个并发 run 容器（per-run 计而非 per-attempt）
- 可观测: 一条 run 稳定 ≤2 容器；container_id 可 psql 查（harness_attempts 同 run 共享）
- 信任边界（不变）: 非 root UID、零 capabilities、Generator push 拒绝（blocked-by-harness://）、每 attempt 独立 scoped route token + callback token、attempt 间不复用 provider session、进程退出即回收临时 env

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级；+ 本任务信任边界铁律 -->
- [generator-retry] Generator 基础设施失败必须重试原始服务端派发动作（首次 generator 重派 generator，generator-fix 重派 generator-fix）（来源: area）
- [brain-url] Dispatcher 与 Fleet Worker 必须注入服务端权威 HARNESS_BRAIN_URL，Generator 仅在通用 BRAIN_URL 缺失时恢复，预检 fail-closed，禁止手工为单 attempt 绕过（来源: area）
- [validation-clock] validation_clock_required 默认 fail-closed，缺失或不一致一律拒绝（来源: area）
- [session-path] evaluator 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名（来源: area）
- [no-self-merge] 禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area）
- [ci-guard] generator 未经合同显式授权不得修改共享 CI 基础设施文件（.github/workflows/*.yml 等）（来源: area）
- [eval-clean] Evaluator 评估容器不得继承工作容器任何文件（node_modules/缓存/hooks/tmp），须从候选 SHA 干净 clone——防篡改（依赖/符号链接/hook/替换对象）不得因共享容器失效（来源: 本任务决策）
- [non-root-zero-cap] 容器非 root UID、零 capabilities、Generator push 拒绝、每 attempt 独立 token 不复用 session（来源: 本任务决策）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无已验收行为——journey e6f803f2 现有 ability 均为 planned）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql + docker ps）。

```bash
# 占位：proposer 将填入真实 local_api 脚本（docker ps + psql harness_attempts + curl Brain）
# 期望验收点（自然语言）：
# 1. 单测 attempt-runner：同 run 连续两 attempt → 同一 container_id；不同 run → 不同容器；run 终态 → 容器销毁；kernel 重启后 reconcile 用 run_id 找回同一容器。
# 2. 单测：Generator 完成后候选 bundle 出现在 quarantine 卷；Evaluator attempt 起新容器、从 bundle clone 后 HEAD==候选 SHA，且容器内无工作容器写入的任何标记文件（防污染断言）。
# 3. 信任回归：非 root、零 cap、push 拒绝、token 独立——现有 runner trust smoke 全绿。
# 4. 容量：capacity 计算对 5GB VM 得出 ≥2 个并发 run 容器。
# 5. Final E2E（生产真 run）：一条 F1 任务 Planner→Generator 全程 docker ps 只见 1 个 cecelia-fleet-run-<run8>；Evaluator 阶段仅多出 1 个 cecelia-fleet-eval-*；psql 查 harness_attempts 同 run 共享 container_id；同时刻 ≥2 条 run 各自容器并行；候选在 Evaluator 卡住时仍在容器内可取。
```

## journey_type: autonomous
## journey_type_reason: 改造仅落 packages/brain/scripts/fleet-worker 后端容器编排，无 UI/远端 agent 协议改动，走后台自治验证
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；单测 + docker ps + psql harness_attempts + curl localhost:5221 均在本地 evaluator 执行
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
