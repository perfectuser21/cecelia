# Sprint PRD — Fleet Worker 实例 ownership fence 与 quarantined attempt 确定终态

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 P0 双 Worker 互杀与 run 永久卡死，Harness 生产可信赖度回补）

## 背景

2026-08-13 21:29:19 生产复现 P0：第二个同 canonical machine_id=us-mac-m4、不同端口(5531)、独立 `CECELIA_FLEET_DATA_ROOT` 的 Worker 启动。其 startup reconcile 只按 `label=cecelia.fleet.worker_id=<machine_id 派生值>` 扫描共享 Docker daemon，21:29:22–27 把生产 Worker 的 4 个容器判成"owned 但 attempt 未知"并 SIGKILL + `docker rm`。生产 Worker 的 active attempt `0ca01d4b` 因 `removal already in progress` 被 quarantine。Brain `reconcileExpiredAttempt` 对 `inspect.status=quarantined` 落到末尾 `worker_attempt_state_unresolved` 分支，`infrastructure_blocked`→deny，hop 13/14 反复 deny，既不 terminalize 也不 replacement，run 永久卡在 generate。

根因两处（均已定位，Planner 只锚定 scope，不写实现）：
1. 容器 ownership 只用 machine_id 派生的 `worker_id`（`labelsFor`/`listOwned` 过滤，见 `attempt-runner.cjs`），同机同 machine_id 的两个实例互相认领对方容器。
2. `quarantined` 不在 `reconcileExpiredAttempt` 的任一确定分支（missing/terminal/prepared/running），fall-through 到 `worker_attempt_state_unresolved` 无限 deny。

## Golden Path（核心场景）

### Path A — 双 Worker 共享 Docker，不互杀
1. Worker-A（data root RA）启动，创建带自身 instance namespace 标签的容器并持有 state ownership。
2. Worker-B（同 canonical machine_id、不同端口、data root RB≠RA）启动并跑 startup reconcile。
3. 可观测结果：Worker-B 只 stop/rm 属于自己 namespace 的容器；Worker-A 的容器全程存活、未收到 SIGKILL / docker rm；Worker-A 的 active attempt 不被 quarantine。
4. 生产 Worker 重启：从其 data root 持久化身份派生出**同一** namespace，重启前后 namespace 不变，不误杀自己旧容器亦不被他人收割。

### Path B — quarantined attempt 一次事务闭环
1. expired attempt 的 `inspect.status=quarantined`。
2. `reconcileExpiredAttempt` 在单事务内：把原 attempt 标 `failed`（专属 error_code，非 `worker_attempt_state_unresolved`）+ 写 append-only decision evidence。
3. 允许 derive 出 fresh replacement attempt，run 从 generate 卡点解除、继续推进。
4. 可观测结果：不再返回 `worker_attempt_state_unresolved`；hop 不再重复 deny；DB 中原 attempt=failed 且存在一条 replacement。

## 边界情况

- **旧无 namespace 容器**：明确 fail-closed rollout policy（不被任意测试/新实例收割），策略结论写进实现，禁止"看到就删"。
- **重复 reconcile 幂等**：Path B 二次 reconcile 不重复 terminalize、不再写无限 deny 记录（RED-4）。
- **同一 data root 只允许一个 namespace**：namespace 派生须稳定、可持久化、重启复用。
- namespace 派生源缺失/损坏时 fail-closed（宁可不收割，不可误杀他人容器）。

## 范围限定

**在范围内**：
- 容器 ownership 加稳定 instance namespace（由 data root 持久化身份派生/保存）。
- reconcile 只作用于本实例 namespace 的容器 + 旧容器 fail-closed 策略。
- `quarantined` 作为确定终态：failed(专属 error_code) + append-only evidence + 允许 replacement。
- 幂等保证；真实 Docker 适配器/进程级集成 + 真实 PostgreSQL 回归进 CI。

**不在范围内**：
- 不改 Worker 调度/派发算法、不改 lease 代际协议本体。
- 不做跨实例 ownership transfer 协议（未来单独 sprint）。
- **绝不通过 stop/删除其他 Worker 或生产容器来"修复"**。

## 假设

- [ASSUMPTION: instance namespace 由 `CECELIA_FLEET_DATA_ROOT` 下持久化身份文件派生并落盘，重启读取复用；具体派生算法由 proposer/generator 定。]
- [ASSUMPTION: 专属 error_code 命名（如 `worker_attempt_quarantined_terminalized`）由 proposer 在合同阶段锁定，须区别于既有 TERMINAL_CODES。]
- [ASSUMPTION: replacement derive 复用现有 `cancelAndReplace` 同级终态权威路径。]

## 预期受影响文件

- `packages/brain/scripts/fleet-worker/attempt-runner.cjs`：`labelsFor` / `listOwned` 过滤 / `reconcile()` 加 namespace fence。
- `packages/brain/scripts/fleet-worker/fleet-worker.cjs`：从 data root 派生/持久化 instance namespace 身份。
- `packages/brain/src/orchestrator/expired-attempt-reconciler.js`：`quarantined` 确定终态分支（failed + evidence + replacement），替换 fall-through 的 `worker_attempt_state_unresolved`。
- `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs` / `fleet-worker.test.js`：RED-1/RED-2/RED-4 单测 + 进程级集成。
- `packages/brain/src/orchestrator/__tests__/`（expired-attempt-reconciler 测试）：RED-3/RED-4 真实 PostgreSQL 集成。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 均空），PrepPRD 显式约束优先 -->
- 幂等性：重复 reconcile 不产生重复终态/无限 deny（RED-4，thin_prd 显式）。
- fail-closed：无 namespace 归属不明时禁止收割（thin_prd 显式）。
- 可观测/留痕：quarantined 终态必须写 append-only decision evidence（thin_prd 显式）。
- 回归：真实 Docker + 真实 PostgreSQL 集成永久进 CI（thin_prd 显式，RED-5）。
- 超时/频控/版本要求：待定（PrepPRD 未指定）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级 + 本 sprint thin_prd 显式铁律 -->
- [不互杀] 修复禁止以 stop/删除其他 Worker 或生产容器为手段（来源: thin_prd 显式，本 sprint 顶级铁律）
- [验证命令实跑] 合同验证命令必须实跑确认 exit code 语义，vitest 对 include 范围外路径绿态也 exit0（来源: area）
- [judge 证据窗口] evaluator 产 .brain-result.json 必须把一手证据放进 judge 消费窗口（前 8 条×600 字符）（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组 -->
- （本 line 暂无已验收历史：journey e6f803f2 下现有 ability 均为 planned 状态）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 按 target_environment=local_api（curl localhost:5221 + docker + psql）填入 contract-draft.md。

```bash
# 占位：proposer 将填入 local_api 真脚本（真实 Docker 适配器/进程级 + 真实 PostgreSQL）
# 期望验收点（自然语言，AI Evaluator 必须像人一样复演，不能只看单测）：
# A. 同 daemon 起 Worker-A(RA)+Worker-B(RB，同 machine_id 不同端口/data root)：
#    B startup reconcile 后 A 的容器全部存活、无 SIGKILL/docker rm 痕迹、A 的 attempt 未 quarantine。
# B. A 重启后从 RA 派生出同一 namespace，容器归属不变。
# C. 真实 PostgreSQL 造一个 inspect=quarantined 的 expired attempt，跑 reconcileExpiredAttempt：
#    该 attempt 变 failed(专属 error_code) + 有 append-only evidence 行 + 派生出一条 replacement；
#    再次 reconcile 幂等（不重复 terminalize、无新增 deny）。run 从 generate 卡点解除。
```

## journey_type: autonomous
## journey_type_reason: 改动集中于 packages/brain/ 后端（fleet-worker 脚本 + orchestrator），无 UI/agent 协议/engine 路径命中，默认 autonomous。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端 + 需真实 Docker daemon 与真实 PostgreSQL，由本地 evaluator 执行（curl localhost:5221 + docker + psql）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
