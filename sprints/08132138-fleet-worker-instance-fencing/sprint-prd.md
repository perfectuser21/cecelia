# Sprint PRD — Fleet Worker 实例 ownership fence、quarantined 确定终态、restart_reason lineage 与 PG runtime 合同

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 P0 双 Worker 互杀与 run 永久卡死，并补齐 restart_reason 血缘与 PostgreSQL runtime 合同投影）

## 背景

2026-08-13 21:29 生产复现 P0：第二个同 canonical machine_id=us-mac-m4、不同端口(5531)、独立 `CECELIA_FLEET_DATA_ROOT` 的 Worker 启动。其 startup reconcile 仅按 machine_id 派生的 `worker_id` 标签扫共享 Docker daemon，把生产 Worker 的容器判成"owned 但 attempt 未知"并 SIGKILL + `docker rm`；生产 active attempt `0ca01d4b` 因 `removal already in progress` 被 quarantine。Brain `reconcileExpiredAttempt` 对 `inspect.status=quarantined` 落到 `worker_attempt_state_unresolved` 分支，反复 deny，run 永久卡在 generate。

本 sprint 为 successor：保留旧合同全部锚定，**增量补齐**两点——(A) replacement attempt 必须继承并结构化记录 `restart_reason` 形成可查询 lineage；(B) `contract_requirements.postgres=true` 须机械投影为 `runtime_resources.postgres=true`，Worker 健康须实证 PG runtime 可用，AI Evaluator 须在真实 PostgreSQL 上复演验收。

根因（Planner 只锚定 scope，不写实现）：① 容器 ownership 仅用 machine_id 派生 `worker_id`，同机双实例互认对方容器；② `quarantined` 不在 reconcile 任一确定分支，fall-through 无限 deny。

## Golden Path（核心场景）

### Path A — 双 Worker 共享 Docker，不互杀
1. Worker-A（data root RA）启动，创建带自身 instance namespace 标签的容器并持有 state ownership。
2. Worker-B（同 machine_id、不同端口、data root RB≠RA）启动跑 startup reconcile。
3. 可观测：B 只 stop/rm 属于自身 namespace 的容器；A 的容器全程存活、无 SIGKILL/docker rm；A 的 attempt 不被 quarantine。
4. A 重启：从 RA 持久化身份派生**同一** namespace，重启前后不变，不误杀旧容器亦不被他人收割。

### Path B — quarantined attempt 一次事务闭环 + restart_reason lineage（增量 A）
1. expired attempt 的 `inspect.status=quarantined`。
2. `reconcileExpiredAttempt` 单事务内：原 attempt 标 `failed`（专属 error_code，非 `worker_attempt_state_unresolved`）+ 写 append-only decision evidence。
3. derive fresh replacement attempt；replacement **结构化继承** `restart_reason`（专属字段/列，指向前驱终态原因，非退化成泛化 error 串），并保留 predecessor 链接形成可查询 lineage。
4. 可观测：不再返回 `worker_attempt_state_unresolved`；DB 中原 attempt=failed 且存在一条 replacement；查询 replacement 可读到 `restart_reason`=该 quarantine 终态原因 + 指向前驱 attempt 的 lineage；run 从 generate 卡点解除。
5. 幂等：二次 reconcile 不重复 terminalize、不再写 deny、不重复派生 replacement、lineage 不被覆盖或重复追加。

### Path C — PostgreSQL runtime 合同机械投影（增量 B）
1. 派发任务 `payload.contract_requirements.postgres=true`。
2. 系统机械投影为 TaskBundle `runtime_resources.postgres=true`（无人工/有损翻译；缺失即 fail-closed，不静默降级）。
3. Worker 健康检查实证 PostgreSQL runtime 真实可用（真连接探活，PG 不可达时 fail-closed，不放行 attempt）。
4. 可观测：给定 `contract_requirements.postgres=true`，落到 Worker 的 TaskBundle `runtime_resources.postgres===true`；健康探针含真实 PG 连接校验；AI Evaluator 在真实 PostgreSQL 上验收 Path B 全链。

## 边界情况

- **旧无 namespace 容器**：fail-closed rollout policy（不被任意测试/新实例收割），禁止"看到就删"。
- **同一 data root 只允许一个 namespace**；派生源缺失/损坏时 fail-closed（宁可不收割，不误杀他人容器）。
- **restart_reason 缺失/前驱无原因**：lineage 记录降级须显式（记 `unknown` 而非丢字段），禁止静默吞掉。
- **contract_requirements.postgres 缺省或 false**：不注入 PG runtime，健康探针不因 PG 缺席误报（只在要求为 true 时强校验）。

## 范围限定

**在范围内**：容器 ownership 加稳定 instance namespace（data root 持久化身份派生）；reconcile 仅作用本实例 namespace + 旧容器 fail-closed；`quarantined` 确定终态（failed+专属 error_code+append-only evidence+replacement）；replacement 结构化继承 restart_reason 形成 lineage；`contract_requirements.postgres` 机械投影 runtime_resources + Worker PG 健康实证；幂等；真实 Docker 双 data root + 真实 PostgreSQL 回归进 CI。

**不在范围内**：不改 Worker 调度/派发算法、不改 lease 代际协议本体；不做跨实例 ownership transfer 协议；**绝不通过 stop/删除其他 Worker 或生产容器来"修复"**。

## 假设

- [ASSUMPTION: instance namespace 由 `CECELIA_FLEET_DATA_ROOT` 下持久化身份文件派生落盘，重启复用；派生算法由 proposer/generator 定。]
- [ASSUMPTION: 专属 error_code（如 `worker_attempt_quarantined_terminalized`）与 restart_reason 结构化字段命名由 proposer 在合同阶段锁定，须区别于既有 TERMINAL_CODES 且可查询。]
- [ASSUMPTION: replacement derive 复用现有 `cancelAndReplace` 同级终态权威路径并携带 restart_reason。]

## 预期受影响文件

- `packages/brain/scripts/fleet-worker/attempt-runner.cjs` / `fleet-worker.cjs`：`labelsFor`/`listOwned`/`reconcile()` 加 namespace fence；data root 派生持久化 instance namespace。
- `packages/brain/scripts/fleet-worker/node-probe.cjs`：Worker 健康探针加真实 PostgreSQL runtime 连接校验（增量 B）。
- `packages/brain/src/orchestrator/expired-attempt-reconciler.js`：`quarantined` 确定终态分支（failed+evidence+replacement）+ replacement 继承 restart_reason lineage（增量 A）。
- `packages/brain/src/orchestrator/attempt-store.js` / `attempt-telemetry.js`：restart_reason 结构化存储 + 前驱 lineage 关联（增量 A）。
- `packages/brain/src/orchestrator/execution-contract.js` / `preflight/requirements.js`：`contract_requirements.postgres`→`runtime_resources.postgres` 机械投影（增量 B）。
- 对应 `*.test.cjs` / `__tests__/`：RED-1/2/4（fence+幂等+namespace 稳定）、RED-3（quarantined 终态+lineage）、RED-5（真实 PostgreSQL 集成）、RED-6（PG runtime 投影+健康实证）。

## NFR 约束

<!-- 来源: decisions category=nfr（step/feature 均空数组）；PrepPRD/thin_prd 显式约束为准 -->
- 幂等性：重复 reconcile 不产生重复终态/无限 deny/重复 replacement/重复 lineage（thin_prd 显式）。
- fail-closed：namespace 归属不明、PG 要求为 true 但不可达时禁止收割/放行（thin_prd 显式）。
- 可观测/留痕：quarantined 终态写 append-only decision evidence；restart_reason lineage 可查询（thin_prd 显式）。
- 合同一致性：`contract_requirements.postgres` 与 `runtime_resources.postgres` 机械等值，禁止人工/有损翻译（thin_prd 增量 B 显式）。
- 回归：真实 Docker 双 data root + 真实 PostgreSQL 集成永久进 CI（thin_prd 显式）。
- 超时/频控/版本要求：待定（PrepPRD 未指定）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级 + 本 sprint thin_prd 显式铁律 -->
- [不互杀] 修复禁止以 stop/删除其他 Worker 或生产容器为手段（来源: thin_prd 显式，本 sprint 顶级铁律）
- [验证命令实跑] 合同验证命令必须实跑确认 exit code 语义，vitest 对 include 范围外路径绿态也 exit0（来源: area）
- [judge 证据窗口] evaluator 产 .brain-result.json 必须把一手证据放进 judge 消费窗口（前 8 条×600 字符）（来源: area）
- [local_api 防死锁] judge 机械闸⑤ meta_verification_gap 对 local_api/无 UI 任务会死锁，合同须显式声明 AI Evaluator 复演证据即验收（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组 -->
- （本 line 暂无已验收历史：journey e6f803f2 下现有 ability 均为 planned 状态）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 按 target_environment=local_api（curl localhost:5221 + docker + 真实 psql）填入 contract-draft.md。

```bash
# 占位：proposer 填入 local_api 真脚本（真实 Docker 双 data root + 真实 PostgreSQL）
# 期望验收点（AI Evaluator 须像人一样复演，不能只看单测）：
# A. 同 daemon 起 Worker-A(RA)+Worker-B(RB，同 machine_id 不同端口/data root)：B reconcile 后 A 容器全存活、无 SIGKILL/docker rm、A 的 attempt 未 quarantine；A 重启后 namespace 不变。
# B. 真实 PG 造 inspect=quarantined 的 expired attempt → reconcileExpiredAttempt：attempt 变 failed(专属 error_code) + append-only evidence + 派生 replacement；查询 replacement 读到 restart_reason=该终态原因 + 指向前驱的 lineage；二次 reconcile 幂等。
# C. 派 contract_requirements.postgres=true：落 Worker 的 TaskBundle runtime_resources.postgres===true；健康探针真连 PG（PG 停则 fail-closed）；AI Evaluator 在真实 PostgreSQL 上验收 B 全链。
```

## journey_type: autonomous
## journey_type_reason: 改动集中于 packages/brain/ 后端（fleet-worker 脚本 + orchestrator），无 UI/agent 协议/engine 路径命中，默认 autonomous。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端 + 需真实 Docker daemon 与真实 PostgreSQL，由本地 evaluator 执行（curl localhost:5221 + docker + psql），payload.target_environment 亦显式为 local_api。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
