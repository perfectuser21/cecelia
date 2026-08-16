# Sprint PRD — Fleet Runner 改为 run 级双容器（工作容器常驻 + 干净评估容器）

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」
- **当前进度**：82%
- **本次推进预期**：+2%（在 5GB VM 上把并发 run 从 1 提到 ≥2，且 Generator 候选不再蒸发）

## 背景

Fleet worker 现状每个 attempt 起一个容器 `cecelia-fleet-<attempt-id>`（`attempt-runner.cjs:533`），跑完即销毁。OrbStack VM 仅 5GB，每容器 300MB~2GB → 本机同时只放 1 个自治 attempt，4 条 run 排 1 个窗口（`autonomous_singleton_capacity_contended`）。且 Generator 只在容器工作区提交本地候选不 push（#4901），容器回收后候选蒸发（run f62c7e87 候选 a7f7a80d、run d1360a48 候选 90da7d33 均在 Evaluator 前丢失）。Alex 08-16 拍板（decision 05585020）：隔离粒度=run 不是 attempt，但 Generator→Evaluator 边界必须保留干净评估容器。

## Golden Path（核心场景）

系统从 [initiative_run 首个 attempt 到达 fleet worker] → 经过 [run 级工作容器常驻 + Generator 候选落 quarantine + Evaluator 干净容器评估] → 到达 [一条 run 稳定 ≤2 个容器、候选不丢、信任边界不变]

具体：
1. run 的首个 attempt 到达 → fleet worker 创建（或复用已存在的）工作容器 `cecelia-fleet-run-<run8>`，打 label `cecelia.run_id=<run_id>`，在容器内 clone 工作区到 base_sha；container_id 记入 `initiative_runs`（新列或 payload）。
2. 同一 run 的后续 attempt（Planner/Proposer/Reviewer/Generator）→ 在同一工作容器内新起 provider 进程（fresh session：独立 TaskBundle、独立 callback token / scoped route token、独立 lease），共享工作区；Generator 产出的候选留在工作区不丢。
3. Generator 完成 → 把候选 SHA 通过 `git bundle` 落到 host quarantine 卷（Brain 可读、按 run 一次性写入与清理）。
4. Evaluator（含 evidence repair）每次评估 → 起全新容器 `cecelia-fleet-eval-<attempt8>`，从 quarantine bundle 干净 clone 到候选 SHA（不 fetch 远端），依赖按锁文件重装，不继承工作容器任何文件；Judge 断言由 Brain 侧 Runner 在该评估容器内执行。
5. run 到达终态（done/failed/cancelled，含 orphan-guard 判死）→ 销毁工作容器；lease 过期/kernel 崩溃后 reconcile 按 run_id 找回同一工作容器继续，不新建。
6. 可观测出口：`docker ps` 在 Planner→Generator 全程只见 1 个 `cecelia-fleet-run-<run8>`；Evaluator 阶段多出且仅多出 1 个 `cecelia-fleet-eval-*`；`harness_attempts` 同 run 的 attempt 共享 container_id。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- kernel 崩溃/重启后 reconcile 用 run_id 找回工作容器，不能误建第二个。
- Evaluator 容器绝不能读到工作容器写入的任何标记文件（防污染断言必须为真）。
- quarantine bundle 缺失/损坏时 Evaluator 必须显式失败，不得回退去 fetch 远端或复用工作容器文件。
- `FLEET_RUN_SCOPED_CONTAINER=off` 时回退到单 attempt 容器旧路径，行为与今日一致。
- 容量计算须对并发 run 容器数封顶（每 run mem 2GB/cpu 2），而非 attempt 数。

## 范围限定

**在范围内**：fleet worker run 级容器生命周期（创建/复用/exec/销毁/reconcile）；候选 git bundle → quarantine 卷；Evaluator 干净容器从 bundle clone；Brain 侧 capacity 改按并发 run 容器计 + `autonomous_singleton` per-run 语义 + xian per-run 选机；feature flag `FLEET_RUN_SCOPED_CONTAINER`（默认 on，off 回退）。

**不在范围内**：不去掉 Docker（一条链一个容器）；不把 Claude 派到 xian；不改合同/闸语义；不改 Judge 的 Brain 侧独立性。

## 假设

- [ASSUMPTION: container_id 优先记入 `initiative_runs` 新列，若迁移成本高则退化写入 `initiative_runs.payload`——由 Proposer 按真实表结构定夺。]
- [ASSUMPTION: quarantine 卷路径与 run 清理策略沿用现有 workspace-manager quarantine 机制（`attempt-runner.cjs` 已有 quarantine/bundle 雏形）。]
- [ASSUMPTION: run8/attempt8 = run_id/attempt_id 前 8 位十六进制，用于容器名后缀。]

## 预期受影响文件

- `packages/brain/scripts/fleet-worker/attempt-runner.cjs`: 容器名从 `cecelia-fleet-<attempt>` 改为 run/eval 双模型；创建/复用/exec/销毁/reconcile 生命周期。
- `packages/brain/scripts/fleet-worker/workspace-manager.cjs`: run 级共享工作区 + 候选 git bundle 落 quarantine 卷 + Evaluator 从 bundle 干净 clone。
- `packages/brain/scripts/fleet-worker/fleet-worker.cjs`: run 首个 attempt 触发容器创建、绑定 run_id、后续 attempt 入口分流。
- `packages/brain/scripts/fleet-worker/attempt-resources.cjs`: mem 2GB/cpu 2 上限按 run 容器计。
- `packages/brain/src/orchestrator/fleet-node/node-admission.js` 及容量相关：capacity 改按并发 run 容器数、`autonomous_singleton` per-run、xian per-run 选机。
- 对应测试：`attempt-runner.test.cjs`、`workspace-manager.test.cjs`、`fleet-worker.test.js`、trust smoke。

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + psql + docker ps）。

```bash
# 占位：proposer 将填入 local_api 真跑脚本（docker ps / psql harness_attempts / 单测 fleet-worker）
# 期望验收点（自然语言）：
#  1) 同 run 连续两个 attempt 得到同一 container_id；不同 run → 不同容器；run 终态 → 容器销毁；kernel 重启后 reconcile 用 run_id 找回同一容器。
#  2) Generator 完成后候选 bundle 出现在 quarantine 卷；Evaluator 起新容器从 bundle clone 后 HEAD==候选 SHA，且容器内不存在工作容器写入的任何标记文件（防污染）。
#  3) 信任回归全绿：非 root UID、零 capabilities、Generator push 被拒（blocked-by-harness://）、每 attempt 独立 scoped route token 与 callback token、attempt 间不复用 provider session。
#  4) capacity 计算对 5GB VM 得出 ≥2 个并发 run 容器。
#  5) 生产真 run：一条 F1 任务 Planner→Generator 全程 docker ps 只见 1 个 cecelia-fleet-run-<run8>，Evaluator 阶段仅多出 1 个 cecelia-fleet-eval-*；psql harness_attempts 同 run attempt 共享 container_id；≥2 条 run 各自容器并行；候选在 Evaluator 卡住时仍在容器内可取。
#  6) Brain semver bump + DevGate（facts-check / version-sync / dod-mapping）全过。
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 级本任务为空）；仅注入与本 sprint 相关的系统/fleet/kernel 铁律，另有 ~70 条 [capture-triage] 通用学习型 invariant 未逐条展开 -->
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [禁写死环境] 禁止写死环境假设值（容量/内存/端口/路径按变量解析）（来源: area）
- [真环境验证] 真环境验证才算 done，不能仅凭"测试通过"收尾（来源: area）
- [多租户默认] 测试默认多租户（来源: area）
- [凭据安全] API Key/Token/密钥一律不入 git，容器级凭据 broker 保持（来源: area）
- [日志脱敏] 日志必须脱敏（来源: area）
- [端点鉴权] 端点必须鉴权（来源: area）
- [租户隔离] 记忆/资源按租户隔离（来源: area）
- [FleetGeneratorBrainURL] Fleet Generator 的 Brain URL 以服务端签发为权威，不得容器内自改（来源: area）
- [generator重试身份] generator 基础设施重试须保持同一 attempt 身份（generator_infrastructure_retry_identity）（来源: area）
- [planner分支] planner 绑定服务端签发的 role branch，Provider 内不得自行 checkout/switch（来源: area）
- [evaluator临时脚本隔离] evaluator 临时脚本必须落会话独享路径（含 session id），禁共享 /tmp 固定文件名（来源: area）
- [generator不自merge] generator 禁止自行 merge PR，merge 权归 controller（来源: area）
- [Kernel校验时钟] Kernel existing PR evaluator validation clock adoption（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 现有 ability 状态均为 planned，无 done/working 历史 -->
- （本 line 暂无历史）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step + feature 双源均为空），PrepPRD 显式值优先 -->
- 资源上限: 每 run 工作容器 mem 2GB / cpu 2（来源: 任务描述，capacity 目标 ≥2 并发 run）
- 容器数上限: 一条 run 稳定 ≤2 个容器（1 工作 + 1 评估），不再每跳一个
- 信任约束: 非 root UID、零 capabilities、Generator push 拒绝、每 attempt 独立 scoped route token/callback token、attempt 间不复用 provider session
- 可观测: run 终态/reconcile/候选 bundle 事件须可从 Brain 侧核查（docker ps + psql harness_attempts）
- 频控/超时: 待定（PrepPRD 未指定）

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain（fleet worker + 容量/路由），纯后端调度，无 UI 与远端 agent 协议。
## target_environment: local_api
## target_environment_reason: 任务 payload 显式 target_environment=local_api；验证走本地 evaluator（curl localhost:5221 + psql + docker ps），无浏览器/Windows/微信。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
