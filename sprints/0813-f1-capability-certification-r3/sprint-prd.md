# Sprint PRD — F1 从碎片化功能升级为可重复认证的 Capability

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%）
- **当前进度**：F1 Capability 为 PARTIAL/L4（65 个 capability/element/scenario 格全 gray，0 assertion receipt）
- **本次推进预期**：+2%（F1 得到同一冻结 GP Contract 下的首个非 synthetic PASS receipt，从"有历史真 E2E 但不可重复认证"升级为"可重复认证 Capability"）

## 背景

11 个 Capability 摸底中 F1 为 PARTIAL/L4：已有历史真 E2E，但认证格全 gray、仅少量 Feature 绑定、0 assertion receipt，无法重复认证。前两轮真实 Kernel 暴露并修复了冻结合同 artifacts 的 PostgreSQL/JavaScript 排序不一致（PR #4859 合并、Brain 1.272.36 已部署）。本轮把 F1 升级为在同一冻结 GP Contract 下可重复认证的 Capability，跑通真实 Generator→Evaluator→Judge→PR→Receipt→Mapper 闭环。

## Golden Path（核心场景）

系统从 [冻结 GP Contract 身份] → 经过 [真实 Generator→Evaluator→Judge→PR→Receipt→Mapper 闭环] → 到达 [同一身份的非 synthetic PASS receipt + Mapper 结论回读]

具体：
1. Kernel 以 Task payload 冻结的 journey_id / anchor.gp_id / anchor.step_id / gp_contract_id+version+hash 为唯一身份开工；禁止按 Journey 猜最新 GP。开工前用 Unified Mapper 生成真实 Impact Contract，至少覆盖 F1 与 ground-truth 机械断言。
2. Generator 产出实现（task_bundle GP identity 贯穿全链），Evaluator 按人的验收剧本验证 F1 真实可观察效果并把 assertion receipt 精确落 `journey_assertion_receipts`，Judge 独立复核。
3. PR 仅在 CI 全绿后合并；Mapper fail-closed 聚合，回读 Mapper 结论。可观测出口：同一 Task/Run/Impact Contract/GP Contract/merge SHA 的一条非 synthetic PASS receipt，且 Mapper 结论为 green。
4. 反向：任何身份、SHA、Feature 或 assertion 不齐时链路必须红（不得 green）。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 冻结合同 artifacts 排序漂移（PostgreSQL/JS）→ hash 不一致必须红，不得吞掉
- Task payload 与 GitHub 实时观测的 pr_url/pr_head_sha 不一致 → 拒绝，不得共享 validation clock
- receipt 为 synthetic / 缺 merge SHA / 缺 Feature 绑定 → Mapper 必须 fail-closed 判红
- 证据压缩窗口截断（evidence_insufficient）与真实实现缺陷需区分，前者优先走 Evaluator 补证据而非直接判缺陷

## 范围限定

**在范围内**：
- 复用 `golden_path_contract_versions`、`journey_step_links`、`journey_features`、`journey_assertion_receipts`、Kernel Harness、Unified Mapper 打通 F1 认证闭环
- task_bundle 冻结 GP identity 全链贯穿、Evaluator receipt 精确落账、Mapper fail-closed 聚合
- 保留能证明"无合同/无 receipt/错 SHA/缺 Feature 时不得 green"的 RED；最短 Capability smoke 注册 PR CI，完整负向矩阵注册 nightly

**不在范围内**：
- 新增任何平行认证系统（必须复用现有表与 Kernel/Mapper）
- 其余 10 个 Capability 的认证（本轮只做 F1）
- 修改冻结 GP Contract 本体（version=1、hash 固定，不可变更）

## 假设

- [ASSUMPTION: gp_contract_id=48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3 / version=1 / hash=3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8 为本轮唯一冻结身份，跨角色与 GAN 轮次不变]
- [ASSUMPTION: 实现基线 base_sha=b4d41ad27d90b218d83d107fe78edd3b4ee499a8（PR #4859 之上），排序不一致已修复]
- [ASSUMPTION: 负向矩阵注册进 nightly、最短 smoke 注册进 PR CI 的 workflow 具体位置由 Proposer 在 GAN 阶段按现有 CI 布局锚定]

## 预期受影响文件

- `packages/brain/src/`（Kernel Harness / Evaluator receipt 落账 / Mapper fail-closed 聚合逻辑）：F1 认证闭环主实现
- `packages/brain/`（涉及 `journey_assertion_receipts`、`golden_path_contract_versions`、`journey_step_links`、`journey_features` 的读写路径）：身份贯穿与 receipt 精确落账
- `packages/quality/`（负向矩阵 + Capability smoke 回归测试）：RED→GREEN 与 nightly/PR CI 注册

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path nfr 为空）+ PrepPRD 显式约束 -->
- 超时/延迟: 待定（PrepPRD 未指定；沿用 Kernel Harness 现有超时）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: Brain ≥ 1.272.36（含 PR #4859 冻结合同排序修复）
- 可观测: receipt 必须为非 synthetic 且落 `journey_assertion_receipts`；失败必须 fail-closed 判红并可回读 Mapper 结论

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 级为空） -->
- [validation-clock] validation_clock_required 默认 fail-closed；仅 gear=hotfix 且 payload 显式 pr_url/pr_head_sha 与 GitHub 实时观测完全一致时首个 Evaluator intent 可建立一次共享 clock，缺失或不一致一律拒绝（来源: area）
- [evidence-vs-defect] Judge FAIL 先区分"证据压缩窗口截断（evidence_insufficient）"与"实现缺陷"：evidence_insufficient 时优先走 Evaluator 补证据（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收历史：journey e6f803f2 现有 golden_path 均为 planned 状态）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段产出（target_environment=local_api → curl localhost:5221 + psql 查库）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql）
# 期望验收点（自然语言）：
#  1. 正向：同一 Task/Run/Impact Contract/GP Contract(48ef45ab v1 hash 3ade5843…)/merge SHA 下，
#     psql 查到 journey_assertion_receipts 存在一条 F1 的非 synthetic PASS receipt；回读 Mapper 结论为 green。
#  2. 反向矩阵：无合同 / 无 receipt / 错 SHA / 缺 Feature 绑定 四种输入下，Mapper fail-closed 判红，链路不得 green。
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain/ 后端（Kernel Harness/Evaluator/Mapper + 认证表读写），无 UI/远端 agent/engine 路径
## target_environment: local_api
## target_environment_reason: payload 显式 local_api，纯 Brain API 后端，本地 evaluator 用 curl localhost:5221 + psql 验证
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
