# Sprint PRD — Diff Impact Gate 透传 reason_code 并 fail-closed 出口（r19/r22）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 Diff Impact Gate 的 mapper_stale 无限重试空转，harness 全链 publisher→CI→merge 打通）

## 背景

kernel harness 运行 f62c7e87 / d1360a48 出现 `deny:impact:mapper_stale` 空转（issue_ref）。
根因：Diff Impact Gate 在 Mapper freshness 非 `fresh` 时，把**所有**情形一律折叠成 `reason: 'mapper_stale', retryable: true`（diff-gate.js L201-207），
导致「确定性 unknown」（如 `impact_anchor_missing`）这类不可能通过重试自愈的结论也被判 retryable → 无限重试。
本 sprint（r22）承接 r19 的修复内容，在合规分支名 + worker 5xx 诊断已上线的基础上，做 harness 全链验证（publisher→CI→merge）。

## Golden Path（核心场景）

系统从 [Impact Gate 被调用] → 经过 [读取 Mapper freshness 并按确定性分流] → 到达 [透传真实 reason_code 的正确 retryable 出口]

具体：
1. **入口**：Diff Impact Gate 被调用，Mapper 返回的 `freshness.status !== 'fresh'`，进入非 fresh 分支并读取 `freshness.status` / `freshness.reason_code`
2. **系统处理（瞬态 stale）**：freshness 为可自愈的瞬态 stale（如 `fact_snapshot_stale` / `projection_revision_mismatch` / `manifest_projection_mismatch`）→ 返回 `retryable: true` 且**透传具体 reason_code**（不再折叠成 `mapper_stale`）
3. **系统处理（确定性 unknown）**：freshness 为确定性 unknown（如 `impact_anchor_missing`）→ **fail-closed**：返回 `retryable: false` 且**透传具体 reason_code**，不再无限重试
4. **可观测出口**：gate 结果的 `reason` / `reason_code` 字段为 Mapper 的真实 reason_code；确定性不可判定情形 `retryable=false` 终止重试循环

## 边界情况

- Mapper 不可达（DB/连接失败/timeout）：维持既有 fail-closed 语义（`impact_unknown`，视是否可重试给 retryable）
- `freshness` 对象缺失（null/undefined）：按不可判定处理，fail-closed，不得静默判 retryable:true
- reason_code 缺失但 status 非 fresh：给出确定性兜底 reason_code，禁止空 reason 折叠回 `mapper_stale`
- structure-gate 与 diff-gate 同构：两个 gate 的非 fresh 分支需一致处理，避免语义分叉

## 范围限定

**在范围内**：
- `diff-gate.js` 非 fresh 分支：按瞬态/确定性分流，透传 reason_code，确定性给 `retryable:false`
- `structure-gate.js` 同构分支的一致修正（如与 diff-gate 语义不一致）
- 对应回归测试（红→绿）

**不在范围内**：
- Mapper/radius freshness 计算逻辑本身（`map/radius.js` 产的 reason_code 视为可信输入）
- harness orchestrator 重试调度策略改动
- 分支命名 / worker 5xx 诊断（已在前序 sprint 上线，本 sprint 仅做全链验证）

## 假设

- [ASSUMPTION: Mapper（radius.js）返回的 `freshness.reason_code` 已能区分瞬态 stale 与确定性 unknown，gate 侧只需按其分流透传，无需自行重算]
- [ASSUMPTION: `retryable:false` 是 orchestrator 终止重试循环的既有契约字段，gate 给出该值即可 fail-closed]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：非 fresh 分支（L201-207 及邻近）透传 reason_code + 确定性 unknown fail-closed
- `packages/brain/src/impact-contract/structure-gate.js`：同构分支（L122-124）一致性修正
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`：新增/更新回归断言（红→绿，永久保留）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step + feature 均为空数组）；PrepPRD 未显式给 NFR -->
- 超时/延迟: 待定（PrepPRD 未指定；沿用 gate 现有同步返回，无新增外部调用）
- 频控: 无新增
- 版本要求: 无
- 可观测: 确定性 unknown 走 fail-closed 时，reason_code 必须落进 gate 结果（供 harness log 排查，替代原 `mapper_stale` 噪音）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/feature 空 → 仅 area 级；此处收录 [系统] canonical 铁律 + 与本 sprint 直接相关项，另有 area 级 capture-triage learnings 约 80 条略 -->
- [fail-closed] Mapper 任何不可判定情形均 fail-closed，绝不假绿（来源: area，diff-gate.js 头注约束）
- [status枚举全仓库grep] GAN 新增/改动 status 或 reason_code 枚举值时须全仓库 grep 硬编码断言，防语义分叉（来源: area）
- [语义一致] 同一语义（如判定结果）在判变端与终验端必须同一处理策略，跨脚本分叉会开假绿面（来源: area）
- [真环境验证] 真环境验证才算 done（来源: area）
- [禁写死环境值] 禁止写死环境假设值（来源: area）
- [测试多租户] 测试默认多租户（来源: area）
- [租户隔离] 记忆/数据按租户隔离（来源: area）
- [凭据安全] 凭据不入 git、日志脱敏、端点鉴权（来源: area）
- [planner分支] planner 使用服务端签发的 PLANNER_BRANCH，禁自行 checkout 漂移（来源: area, planner_role_branch）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey golden-paths 仅返回 status=planned 项，无 done/working -->
- （本 line 暂无已验收历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 按 target_environment=local_api 填 curl+psql / node -e 直调 gate。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
#   1. 构造 Mapper freshness=瞬态 stale（如 fact_snapshot_stale）调 diff-gate → 断言 retryable=true 且 reason_code=fact_snapshot_stale（非 mapper_stale）
#   2. 构造 Mapper freshness=确定性 unknown（如 impact_anchor_missing）调 diff-gate → 断言 retryable=false（fail-closed）且 reason_code=impact_anchor_missing（非 mapper_stale）
#   3. structure-gate 同构分支断言一致
#   4. 全链：harness run 不再出现 deny:impact:mapper_stale 无限重试空转
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 后端 impact-contract gate 逻辑，无 UI / 远端 agent / engine 参与
## target_environment: local_api
## target_environment_reason: Brain 内部纯后端 gate 单元/集成验证，本地 evaluator 直调 node + curl localhost:5221，payload 已显式指定 local_api
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
