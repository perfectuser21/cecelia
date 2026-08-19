# Sprint PRD — Diff Impact Gate 透传 reason_code + 确定性 unknown fail-closed 出口

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness kernel 一类无限重试黑洞）

## 背景

Diff Impact Gate（`diff-gate.js` 步骤 3a）把 Mapper 一切 `freshness.status !== 'fresh'`
的结论一律折叠成 `reason: 'mapper_stale'` + `retryable: true`。当 Map 给出的是**确定性**结论
（如影响半径不可判定 impact_unknown、投影缺失等 permanent 条件）时，被误判为「瞬态陈旧」
并无限重试，kernel 永远走不到 fail-closed 出口。本 sprint 让 Gate 区分「瞬态 stale」与
「确定性 unknown」，两类都透传 Mapper 给出的具体 reason_code，确定性一类改为 fail-closed
（retryable=false），终止无限重试。对齐 area 铁律 `generator_infrastructure_retry_identity`
与 `[系统]真环境验证才算done` 的 fail-closed 精神。

## Golden Path（核心场景）

系统从 [kernel 派发 attempt 调 Gate] → 经过 [Gate 区分瞬态/确定性] → 到达 [正确的 retry/fail-closed 出口]

具体：
1. kernel 调 `runDiffImpactGate({...})`，Gate 走到步骤 3 校验 Mapper 可判定性。
2. Mapper 返回**瞬态陈旧**证据（freshness 非 fresh 且带瞬态 reason，如 `fact_snapshot_stale`）：
   Gate 返回 `retryable: true` 且 `reason` **透传该具体 reason_code**（不再是笼统 `mapper_stale`）。
3. Mapper 返回**确定性 unknown**结论（freshness 携带 permanent/确定性 reason，如 `impact_unknown`）：
   Gate 返回 `retryable: false`（fail-closed）且 `reason` 透传该具体 reason_code。
4. 出口：kernel 收到 `retryable: false` 时终止该 attempt 的 Gate 重试，不再无限循环。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- Mapper 返回 freshness 缺字段/未知 reason（既非明确瞬态也非明确确定性）→ 默认 fail-closed
  （retryable=false）并透传 raw reason_code，宁可停也不无限转。
- Mapper 完全不可达（抛异常）→ 维持既有 `mapper_unavailable` + retryable:true 行为，不在本 sprint 改动。
- reason_code 缺失时的兜底占位（如 `unknown`），不得回退成 `mapper_stale`。

## 范围限定

**在范围内**：`diff-gate.js` 步骤 3a（freshness 非 fresh 分支）的 reason_code 透传 + retryable
按瞬态/确定性分流；对应单测。
**不在范围内**：步骤 3b（revision/digest mismatch 分支，已各自带具体 reason_code）、Mapper 本体、
kernel orchestrator 重试调度逻辑、structure-gate.js 的 HTTP 503 路径。

## 假设

- [ASSUMPTION: Mapper 结果在 freshness 上携带可区分瞬态/确定性的字段（如 `freshness.reason` 或
  `freshness.class`）；若字段名不同，Proposer 在 GAN 阶段读 map-client 契约校正。]
- [ASSUMPTION: 「确定性 unknown」判定依据 = freshness 明确标注 permanent/impact_unknown 类 reason；
  无法判定归属时按边界情况走 fail-closed。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 步骤 3a 折叠逻辑改为分流 + 透传 reason_code。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`: 新增瞬态→retryable:true+具体
  reason_code、确定性→retryable:false+具体 reason_code 两条回归断言（含先红的 failing test）。
- `packages/brain/src/impact-contract/__tests__/harness-gates.test.js`: 同步既有 mapper_stale 断言。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 均空数组），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定，Gate 为同步纯函数判定，无新增 IO）
- 频控: 无
- 版本要求: 无
- 可观测: 透传的 reason_code 必须原样进 gateVerdict（如 `deny:impact:<reason_code>`），便于排查

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 源为空数组） -->
- [重试身份] Generator 基础设施失败必须重试原始服务端派发动作；首次 generator 重派 generator，generator-fix 重派 generator-fix（来源: area）
- [planner分支] Planner workspace 必须停在服务端签发的 planner_branch，Provider 可校验但不得 checkout/switch（来源: area）
- [BrainURL权威] Dispatcher 与 Fleet Worker 必须注入服务端权威 HARNESS_BRAIN_URL，预检 fail-closed，禁手工绕过（来源: area）
- [验证时钟] validation_clock_required 默认 fail-closed，仅 gear=hotfix 且 pr 证据实时一致时才建一次共享 clock（来源: area）
- [真验才done] 依赖真机/生产/真实调用方的接缝断言必须真目标验证过才算 done，未真验只能标 logic-done-pending（来源: area）
- [多租户测试] 单元/E2E 默认种 ≥2 租户并断言互不串（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户，跨租户绝不混读混写（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史：journey e6f803f2 下 ability 均为 planned，无 done/working 已验收行为）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api
> 填 curl + vitest。期望验收点如下。

```bash
# 占位：proposer 按 target_environment=local_api 填入真实脚本（vitest 单测 + 可选 curl 端点验证）
# 期望验收点（自然语言）：
#  1. 先有一条 failing test（红）断言「确定性 unknown 场景当前误返回 mapper_stale/retryable:true」——
#     对齐任务 r25 意图：CI 需真实转红，供 generator-fix 续改边验证。
#  2. 修复后：瞬态 stale 场景 → gate=impact_unknown, retryable=true, reason=<具体码，非 mapper_stale>。
#  3. 修复后：确定性 unknown 场景 → gate=impact_unknown, retryable=false（fail-closed），reason=<具体码>。
#  4. vitest 全绿（diff-gate.test.js + harness-gates.test.js），无 mapper_stale 无限重试路径残留。
```

## journey_type: autonomous
## journey_type_reason: 改动仅落在 packages/brain/ 后端 Gate 判定逻辑，无 UI/远端 agent/engine 介入。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；纯 Brain 后端逻辑，evaluator 本地跑 vitest + curl localhost:5221。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
