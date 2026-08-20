# Sprint PRD — Diff Impact Gate 透传 mapper reason_code + 确定性结论 fail-closed 出口

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（active, 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness 空转，逼近"零人碰到 merge"）

## 背景

r28 前置（1.273.97：manifest guard 期限解耦 + 回执拒绝留痕）已上线。
残留问题（issue_ref：runs f62c7e87 / d1360a48 `deny:impact:mapper_stale` 空转）：
Diff Impact Gate 在 mapper 返回 `freshness.status !== 'fresh'` 时，把**所有**非 fresh 情形
一律折叠成 `reason: 'mapper_stale', retryable: true`，丢弃了 mapper 自带的具体 `reason_code`。
当 Map 已经给出**确定性/终态结论**（如 `capability_not_in_active_projection`、
`manifest_projection_mismatch`、`revision_mismatch` —— 重试永远不会变 fresh）时，
run 被判成"可重试的 stale"从而无限重试空转，需要人介入才能停。
本 sprint 目标：确定性结论透传真实 reason_code + fail-closed 非重试出口，让 run 自行终止，零人碰到 merge。

## Golden Path（核心场景）

系统从 [Diff Impact Gate 调 mapper] → 经过 [判定 mapper 结论是终态还是瞬态] → 到达 [终态直接 fail-closed 停机，不空转]

具体：
1. [触发] 某 harness run 进入 Diff Impact Gate，mapper 返回 `freshness.status` 为 `stale`/`unknown`，且带具体 `reason_code`（如 `capability_not_in_active_projection`）。
2. [系统处理] Gate 不再把所有非 fresh 折叠成裸 `mapper_stale`：
   - 读取 `mapperResult.freshness.reason_code` 并**透传**到 gate 返回结果（不再被替换成常量字符串）。
   - 对**确定性/终态** reason_code（重试不会自愈的结论）→ 返回 **fail-closed 非重试出口**（`retryable: false`），run 停机而非重排。
   - 对**真瞬态** stale（如 fact 快照刷新在途）→ 保持 `retryable: true`（既有行为不回退）。
3. [可观测结果] 先前在 `deny:impact:mapper_stale` 上无限重试的 run，现在以携带真实 reason_code 的 fail-closed deny 终止；无空转；无需人工干预 merge。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- mapper 完全不可达（抛异常）→ 保持既有 `mapper_unavailable` + retryable:true（本 sprint 不改此瞬态路径）。
- `freshness.reason_code` 为 null/缺失但 status 非 fresh → 仍需 fail-closed 兜底，不得静默假绿。
- 瞬态 vs 终态的分类必须显式白名单/黑名单，禁止"未知即重试"导致空转复发。
- 既有 `revision_mismatch` / `manifest_digest_mismatch` / `projection_digest_mismatch` 等已有 impact_unknown 分支的 retryable 语义需一并复核，避免遗漏终态项。

## 范围限定

**在范围内**：
- `packages/brain/src/impact-contract/diff-gate.js` 中 mapper freshness 非 fresh 的裁决分支（透传 reason_code + 终态 fail-closed）。
- 终态/瞬态 reason_code 的分类判定。
- 对应回归测试（先写能复现空转的 failing test）。

**不在范围内**：
- mapper 本体（`packages/brain/src/map/`）的 freshness/reason_code 计算逻辑。
- pass/extend/drift 正常对账路径。
- manifest guard / 回执留痕（r28 前置已上线，不重做）。

## 假设

- [ASSUMPTION: 终态 reason_code 集合以 `packages/brain/src/map/radius.js` / `state-resolver.js` 现有枚举为准（如 capability_not_in_active_projection / impact_anchor_missing / manifest_projection_mismatch / revision_mismatch 等），瞬态仅 fact 快照刷新在途一类；具体分类由 proposer 对齐代码枚举后锁定。]
- [ASSUMPTION: fail-closed 出口沿用 `gate: 'impact_unknown'` 语义，仅新增 `retryable:false` + 透传 `reason_code`，不新增 gate 枚举值，避免下游硬编码断言全仓 grep 漂移。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: mapper_stale 折叠点（约 202-208 行）改为透传 reason_code + 终态 fail-closed 出口。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`: 新增可复现"终态结论被判 retryable 空转"的 failing 回归测试，修复后永久保留。
- `packages/brain/src/impact-contract/map-client.js`: 若 reason_code 透传链路需在此补齐（仅在必要时）。

## E2E 验收

> Planner 初稿此区块留空，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入 local_api 脚本（node/vitest 直跑 evaluateDiffGate + 断言）
# 期望验收点（自然语言）：
#  1. 构造 mapper 返回 freshness.status='unknown' + reason_code='capability_not_in_active_projection' 的终态结果，
#     断言 evaluateDiffGate 返回 retryable=false 且 reason/reason_code 携带真实 'capability_not_in_active_projection'（非裸 'mapper_stale'）。
#  2. 构造真瞬态 stale，断言仍 retryable=true（既有行为不回退）。
#  3. 断言不存在任何路径把确定性结论输出成 retryable=true 的 mapper_stale（空转根因关闭）。
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级系统铁律（step/journey_feature 级本任务为空）；已从 area 查询中剔除 capture-triage learning 噪音，保留系统铁律 + 与本任务直接相关项 -->
- [真验证] 真环境验证才算 done，禁止仅凭"测试通过"空泛断言收尾（来源: area）
- [禁写死] 禁止写死环境假设值（来源: area）
- [多租户] 测试默认多租户 / 租户隔离（来源: area）
- [端点鉴权] 端点鉴权、凭据安全、日志脱敏（来源: area）
- [status枚举全grep] 合同/测试涉及 status/reason_code 枚举硬编码断言时，新增/变更枚举值需全仓库 grep 同步，防跨脚本语义分叉开假绿面（来源: area, 052e10a0/113a9330）
- [else显式] 调用"失败返回 null/false 不抛异常"契约的函数时，写完成功分支必须显式写 else 兜底，禁止漏判（来源: area, e9c7752f）
- [fail-closed] Mapper 任何不可判定情形均返回 blocked/impact_unknown，绝不假绿（来源: diff-gate.js 模块铁律）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无已验收 ability 历史；journey golden-paths 现存 ability 均为 planned 态，未纳入累积 FR）

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先；step 级为空，ability_id 为 null 故 feature 级跳过 -->
- 超时/延迟: 待定（PrepPRD 未指定；不引入新阻塞式等待）
- 频控: 待定（本 sprint 目的是消除无限重试空转，不新增重试频控参数）
- 版本要求: 无
- 可观测: fail-closed deny 必须携带真实 reason_code，失败可在 Brain log / gate 返回结果中溯源

## Unified Map 锚定

<!-- map_scope=["F1"]，但 task.payload 未提供 map_repo → Unified Map 未配置，如实记录不做领域猜测 -->
- map_scope: F1
- map_repo: not_configured（payload 缺 map_repo）

## journey_type: autonomous
## journey_type_reason: 仅改动 packages/brain/ 后端 harness 调度裁决逻辑，无 UI / 无远端 agent 协议 / 无 engine hooks
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api，且改动仅 packages/brain 纯后端裁决函数，evaluator 本地 node/vitest + curl localhost:5221 即可验证
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
