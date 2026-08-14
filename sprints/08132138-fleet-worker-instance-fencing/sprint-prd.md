# Sprint PRD — Fleet Worker 实例互杀根治 + expired attempt 原子闭环 + 批准合同 artifact 薄包装

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+2%（消除同机多 Worker 互杀与 quarantined attempt 无限卡死两个 P0 可信赖性缺口）

## 背景

successor-5 恢复任务。Reviewer R2 已 APPROVED 合同 `4f181300a29c2f1012a1b2b60f5fa728cc595400`，但 Kernel `collectApprovedContractArtifacts` fail-closed —— R2 把测试单源在 `sprint_dir/tests` 之外，而不可变 artifact 收集器要求 `sprint_dir/tests` 至少一个 blob。本 sprint 完整继承该批准合同的行为契约，并补齐 artifact 包装缺口，让 Generator/Evaluator/Judge 继续。严格 TDD。

## Golden Path（核心场景）

系统从 [同机多 Worker 并发 + 某 attempt 过期] → 经过 [实例隔离 + 原子终态化 + artifact 收集] → 到达 [互不互杀、干净 resume lineage、批准合同可继续]。

具体：
1. 同一 Docker daemon、相同 canonical machine_id、不同端口/data root 的 Worker A/B 并发运行；A 的生命周期管理只作用于自己 instance namespace 的容器，**不得 stop/rm** B 的容器。
2. instance namespace 持久化，Worker 重启后稳定复用同一 namespace；旧的**无 namespace 容器一律 fail-closed**（不被任何实例接管或误杀）。
3. 过期的 fleet-worker attempt 由 `reconcileExpiredKernelAttempt` **唯一入口**在**单事务**内终态化为 `failed`，并生成 replacement：`attempt_kind=resume`、`retry_of_attempt_id` 指向 parent、`restart_reason` 非空。
4. 重复/并发调用 `reconcileExpiredKernelAttempt` **幂等**：不产生第二个 replacement，不重复终态化。
5. `contract_requirements.postgres=true` 被机械投影为 `runtime_resources.postgres=true`，且真实连 PG 验证（非假绿）。
6. Kernel `collectApprovedContractArtifacts` 从 `sprint_dir/tests` 收集到至少一个 blob —— `sprints/08132138-fleet-worker-instance-fencing/tests/` 下的**可执行薄包装**直接加载 `packages/brain/scripts/fleet-worker/instance-fencing.test.cjs` 单一测试实现（不复制断言逻辑），批准合同不再 fail-closed。

## 边界情况

- 升级前遗留的无 namespace 容器 → fail-closed，不误认/不误杀。
- 重复或并发 reconcile → 幂等，始终单一 replacement。
- Worker 重启后 namespace 文件丢失/损坏 → fail-closed，而非跨实例杀。
- postgres 不可达 → runtime 真验暴露失败，不得假绿通过。
- 薄包装被 vitest include 范围外静默判绿 → 必须以真实 exit code 语义执行（见 Invariant）。

## 范围限定

**在范围内**：实例级容器隔离（namespace 持久化 + 旧容器 fail-closed）；expired attempt 单入口原子终态化 + resume lineage + 幂等；postgres 契约→runtime 投影与真验；`sprint_dir/tests` 可执行薄包装 + artifact 收集兼容；CI 单源保持。

**不在范围内**：跨机器/跨 daemon 调度；canonical machine_id 派生算法本体；Generator/Evaluator/Judge 内部逻辑改写；新增 Worker 能力或端点。

## 假设

- [ASSUMPTION: `instance-fencing.test.cjs` 单一测试实现随继承的批准合同落在 `packages/brain/scripts/fleet-worker/`；薄包装仅 `require` 加载并转发退出码，不复制断言。]
- [ASSUMPTION: canonical machine_id 派生逻辑已存在，本 sprint 仅在其上叠加 instance（端口/data root）维度隔离。]
- [ASSUMPTION: `reconcileExpiredKernelAttempt` 现有单入口签名保持，本 sprint 强化其事务原子性与幂等，不新增并列入口。]

## 预期受影响文件

- `packages/brain/scripts/fleet-worker/instance-fencing.test.cjs`: 单一测试实现（互杀隔离 / namespace 持久化 / expired 闭环 / restart_reason lineage / PG runtime）。
- `packages/brain/scripts/fleet-worker/fleet-worker.cjs`: 实例 namespace 隔离 + 无 namespace 容器 fail-closed。
- `packages/brain/src/harness-relay-watchdog.js`: `reconcileExpiredKernelAttempt` 单事务终态化 + 幂等 replacement lineage。
- `packages/brain/src/orchestrator/execution-contract.js`: `contract_requirements.postgres` → `runtime_resources.postgres` 机械投影。
- `packages/brain/src/orchestrator/contract-artifacts.js`: `collectApprovedContractArtifacts` 要求 `sprint_dir/tests` 至少一个 blob。
- `sprints/08132138-fleet-worker-instance-fencing/tests/`: 可执行薄包装（加载上述 test.cjs，保 CI 单源 + artifact 收集兼容）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 均空）+ PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；expired 判定沿用现有 kernel lease 阈值）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: postgres 必须真实可连（contract_requirements.postgres=true → runtime 真验）
- 可观测: expired 终态化与 replacement 生成必须留痕（restart_reason 非空、lineage 可查）；薄包装失败必须以非零 exit code 暴露

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step+journey_feature+area 三源合并去重；step/feature 源空，取 area 相关铁律 -->
- [互杀隔离] 同 daemon/同 machine_id、不同端口/data root 的 Worker 不得跨实例 stop/rm（来源: PrepPRD 继承合同）
- [fail-closed] 旧无 namespace 容器一律 fail-closed，宁可不动不可误杀（来源: PrepPRD 继承合同）
- [单入口幂等] expired attempt 仅由 reconcileExpiredKernelAttempt 单事务终态化，重复 reconcile 幂等（来源: PrepPRD 继承合同）
- [真验非假绿] 合同验证命令必须实跑确认 exit code 语义；vitest 对 include 范围外路径（如 sprints/**）绿态也可能是假绿，薄包装须真实执行断言（来源: area）
- [canonical 不可变] 涉 canonical 文件的收尾 commit 前先核对不可变清单，毕业步与 canonical 不可变 lint 存在结构性矛盾（来源: area）
- [台账不入库] controller 台账 .harness/progress.md 必须保持在 git 追踪之外，不得随 sprint PR 带入 repo（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 现有 golden-path 均为 planned 态 -->
- （本 line 暂无已验收历史）

## E2E 验收

> Planner 初稿留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql + node 直跑薄包装）。

```bash
# 占位：proposer 将填入 local_api 真验脚本
# 期望验收点（自然语言）：
# 1) 起同机双 Worker（异端口/异 data root），触发 A 生命周期回收，psql/docker 确认 B 容器存活未被 stop/rm
# 2) 无 namespace 旧容器场景下，Worker 拒绝接管（fail-closed），docker ps 确认旧容器未被杀
# 3) 造一个 expired fleet-worker attempt，调用 reconcileExpiredKernelAttempt 两次；psql 确认：parent=failed 单条、replacement 单条且 attempt_kind=resume / retry_of_attempt_id=parent / restart_reason 非空、二次调用无新增行
# 4) contract_requirements.postgres=true 的 attempt，psql 确认 runtime_resources.postgres=true 且实际连库成功
# 5) node 直跑 sprints/.../tests 薄包装，exit 0 且真实执行 instance-fencing.test.cjs 断言；collectApprovedContractArtifacts 收集到 ≥1 个 sprint/tests blob
```

## journey_type: autonomous
## journey_type_reason: 改动集中在 packages/brain（fleet-worker 脚本 + harness watchdog + orchestrator），纯后端自治流程，无 UI / 无远端 agent 协议。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；验收在本地 evaluator 用 curl localhost:5221 + psql + node 直跑薄包装完成。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
