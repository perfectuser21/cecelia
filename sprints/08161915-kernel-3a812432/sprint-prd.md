# Sprint PRD — Fleet Runner run 级双容器（工作容器常驻 + 干净评估容器）

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+3%（算力全开：run 级容器把 5GB VM 并发从 1 提到 ≥2；系统可信赖：候选不再蒸发 + 评估隔离不被污染）

## 背景

决策 05585020（Alex 08-16 拍板）：隔离粒度 = run 而非 attempt，但 Generator→Evaluator 边界必须保留。现状每 attempt 起销一容器，OrbStack 5GB VM 同时只放 1 个自治角色 attempt（autonomous_singleton_capacity_contended），4 条 run 排 1 窗口；且 Generator 本地候选随容器回收蒸发（run f62c7e87 候选 a7f7a80d、run d1360a48 候选 90da7d33 卡死后丢失）。改双容器模型解决容量与候选存活，同时保留评估容器的防污染价值。前一单死于 Evaluator 容器 frozen_baseline_guard_unavailable，已由 PR #4912 修复并重钉 Runner（Brain 1.273.60）。

## Golden Path（核心场景）

系统从 [run 首个 attempt 到达] → 经过 [同容器接力 + 候选落 quarantine + 干净评估] → 到达 [一条 run 稳定 ≤2 容器且候选不丢]

具体：
1. planner attempt 到达 fleet-worker，无同 run_id 容器 → 创建工作容器 `cecelia-fleet-run-<run8>`（label `cecelia.run_id=<run_id>`，非 root UID、零 capabilities、mem 2GB/cpu 2），clone at base_sha 到工作区，`container_id` 记入 initiative_runs（新列或 payload），启动 fresh provider 进程跑 planner。
2. 后续同 run attempt（proposer/reviewer/generator）到达 → 按 run_id 复用同一工作容器，`docker exec`/runner attempt 入口起新 fresh provider 进程（独立 TaskBundle、独立 callback token + scoped route token、独立 lease），共享工作区；Generator 候选本地提交不 push，候选留在工作区不蒸发。
3. Generator 完成 → 候选 SHA `git bundle` 落 host quarantine 卷（Brain 只读、只写一次、按 run 清理）。
4. Evaluator attempt → 起全新评估容器 `cecelia-fleet-eval-<attempt8>`，从 quarantine bundle 干净 clone 到候选 SHA（不 fetch 远端），按锁文件重装依赖，不继承工作容器任何 node_modules/缓存/hook/tmp/标记文件；Judge 断言由 Brain 侧 Runner 在评估容器内执行。
5. run 终态（done/failed/cancelled，含 orphan-guard 判死）→ 销毁工作容器与残留 eval 容器，quarantine 按 run 清理。可观测出口：`docker ps` 一条 run 稳定 ≤2 容器。

## 边界情况

- lease 过期 / kernel 崩溃 → reconcile 按 run_id 找回**同一**工作容器继续，不新建。
- `FLEET_RUN_SCOPED_CONTAINER=off` → 回退单 attempt 容器模式（fallback），默认开。
- 并发 ≥2 条 run → 各自独立容器并行；capacity 以并发 run 容器数（非 attempt 数）计，5GB VM 得出 ≥2；autonomous_singleton 语义改 per-run，xian 路由改 per-run 选机。
- attempt 进程退出即回收其临时 env / 凭据；attempt 之间不得复用 provider session。

## 范围限定

**在范围内**：fleet-worker/attempt-runner run 级容器生命周期（建/复用/reconcile/销毁）、候选 quarantine bundle、评估容器干净 clone + 防污染、capacity per-run 计量、xian per-run 选机、FLEET_RUN_SCOPED_CONTAINER fallback、信任边界不变。
**不在范围内**：不去掉 Docker（接受一条链一容器）；不把 Claude 派到 xian；不改合同/闸语义。

## 假设

- [ASSUMPTION: quarantine 为 host 挂载卷，Brain 与 fleet-worker 同主机（us-mac-m4）可读；候选经 git bundle 落卷或 run 容器只读导出]
- [ASSUMPTION: F1 unified map 未配置（task.payload.map_repo=null）→ scope 锚定沿用本 task 描述，不做领域猜测]
- [ASSUMPTION: initiative_runs 记 container_id 用新列；若 migration 受限则退回 payload jsonb]

## 预期受影响文件

- `packages/brain/scripts/fleet-worker/fleet-worker.cjs`：run 级容器生命周期主逻辑（建/复用/reconcile/销毁）
- `packages/brain/scripts/fleet-worker/attempt-resources.test.cjs` / `workspace-manager.test.cjs`：run 级容器 + 候选 quarantine + 防污染单测
- `packages/brain/src/capacity.js` / `capacity-gate.js`：容量以并发 run 容器数计（每 run mem 2GB/cpu 2）
- `packages/brain/src/task-router.js` / `work-router.js`：xian per-run 选机 + autonomous_singleton per-run
- `packages/brain/src/dispatcher.js`：initiative_runs 记 container_id、run 终态销毁触发
- `packages/brain/migrations/`：initiative_runs.container_id 新列（如采用列存）

## NFR 约束

<!-- 来源: decisions category=nfr（step/feature 空，ability_id 缺）+ 任务描述显式约束 -->
- 每 run 容器上限: mem 2GB / cpu 2
- 容量下限: 5GB VM 并发 run 容器 ≥2
- 隔离: 评估容器不复用工作容器 node_modules/缓存/hooks/tmp（防污染硬约束）
- 可观测: container_id 写 initiative_runs；harness_attempts 同 run 共享 container_id
- feature flag: FLEET_RUN_SCOPED_CONTAINER 默认 on，off 时 fallback 单 attempt 容器

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 空）；本 sprint 相关项 -->
- [非root零cap] fleet 容器非 root UID、零 capabilities（来源: area 信任边界）
- [Generator禁push] Generator push 一律拒绝 blocked-by-harness://（来源: area）
- [token独立] 每 attempt 独立 scoped route token 与 callback token，容器级凭据 broker 保持；attempt 退出即回收临时 env（来源: area）
- [Generator禁自merge] Generator 不得自行 merge PR，merge 权归 controller（来源: area）
- [CI基础设施禁区] Generator 默认禁改 .github/workflows/*.yml 等共享 CI 基础设施（来源: area）
- [Brain URL权威] Fleet Generator 的 Brain URL 由服务端权威签发（来源: area, Fleet Generator Brain URL authority）
- [planner分支权威] Planner 用服务端签发的 PLANNER_BRANCH，禁自行 checkout（来源: area, planner_role_branch）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无已验收 ability：journey e6f803f2 现有 golden_path 均为 planned 态）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node 单测 + docker ps + psql）。

```bash
# 占位：proposer 将填入真实脚本
# 期望验收点（自然语言）：
# 1. 单测 fleet-worker/attempt-runner：同 run 连续两 attempt → 同一 container_id；不同 run → 不同容器；run 终态 → 容器销毁；kernel 重启后 reconcile 用 run_id 找回同一容器。
# 2. 单测：Generator 完成后候选 bundle 现身 quarantine 卷；Evaluator 起新容器从 bundle clone 后 HEAD==候选 SHA，且容器内不存在工作容器写入的任何标记文件（防污染断言）。
# 3. 信任回归：非 root、零 cap、push 拒绝、token 独立——现有 runner trust smoke 全绿。
# 4. 容量：capacity 计算对 5GB VM 得出 ≥2 个并发 run 容器。
# 5. Final E2E（生产真 run）：F1 任务 Planner→Generator 全程 docker ps 只见 1 个 cecelia-fleet-run-<run8>；Evaluator 阶段仅多出 1 个 cecelia-fleet-eval-*；psql harness_attempts 同 run 共享 container_id；同刻 ≥2 条 run 各自容器并行；Evaluator 卡住时候选仍在容器内可取。
# 6. Brain semver bump + DevGate 三闸通过。
```

## journey_type: agent_remote
## journey_type_reason: 改动核心是 fleet-worker 远端 agent 执行传输（容器化 runner/bridge），非 UI/engine/纯后端
## target_environment: local_api
## target_environment_reason: 单测为 node/bash 本地执行，Final E2E 的 docker ps + psql harness_attempts 均在 fleet 宿主机 us-mac-m4 本地由 evaluator 跑（curl localhost:5221 + psql + docker ps）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
