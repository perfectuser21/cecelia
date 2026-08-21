# Sprint PRD — Diff Impact Gate 透传 reason_code + fail-closed 出口（r37）

## OKR 对齐

- **对应 KR**：harness zero-human-gate（零人碰到 merge）
- **当前进度**：r36 已修第七层（proposer 树缺冻结测试：finalizer push 前 ls-tree 校验 + proposer 9.27 死规则）
- **本次推进预期**：补上第八处空转黑洞——Diff Impact Gate 不再把确定性 Map 结论折叠成 mapper_stale 无限重试

## 背景

runs f62c7e87 / d1360a48 撞上 `deny:impact:mapper_stale` 空转：`packages/brain/src/impact-contract/diff-gate.js` 步骤 3a 把 freshness.status 任何非 `fresh`（含 `stale` 与 `unknown`）一律折叠成单一 `reason: 'mapper_stale'` + `retryable: true`，同时丢弃 map-client freshness 已携带的确定性 `reason_code`（`{ status, reason_code }`）。当 Map 给出的是**确定性结论**（如 status=`stale` 且带明确 reason_code，表示"这就是权威事实、别再重试")时，被误判为可重试的短暂 stale，导致无限重试、零人也永远碰不到 merge。修复：透传 Map 自带 reason_code，并为确定性结论给出 fail-closed 终态出口（不可重试）。

## Golden Path（核心场景）

系统在 harness impact 裁决阶段调用 `evaluateDiffGate` → Mapper 返回带 freshness.reason_code 的确定性结论 → gate 透传该 reason_code 并按可判定性决定是否重试 → 出口终态可观察，不再空转。

具体：
1. [触发条件] `evaluateDiffGate` 调用 mapperFn，返回 `freshness.status !== 'fresh'`。
2. [系统处理] 若 freshness 携带确定性 `reason_code`（Map 已给出权威结论），gate 把该 `reason_code` 原样透传进 verdict，并走 **fail-closed 终态**（`retryable: false`）；仅当 freshness 缺失或确为短暂不可判定（如 `unknown` 无 reason_code）时才保留 `retryable: true`。
3. [可观测结果] gate 返回对象含真实的 `reason_code`（非恒定 `mapper_stale`）；确定性结论出口 `retryable === false`，调度不再对同一确定性结论无限重排，`deny:impact` 空转终止。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- freshness 完全缺失（`!mapperResult?.freshness`）：无 reason_code 可透传 → 维持 fail-closed 但语义清晰的终态，不得静默假绿。
- freshness.status=`unknown` 且无 reason_code：属真正不可判定 → 允许 `retryable: true`（短暂性）。
- freshness.status=`stale` 带确定性 reason_code：**必须** fail-closed 终态（`retryable: false`），这是本 sprint 主修路径。
- reason_code 为下游未知的新枚举值：透传不得报错崩溃（对齐 status 枚举全仓库对账铁律）。

## 范围限定

**在范围内**：
- `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a 分支：透传 `mapperResult.freshness.reason_code`、区分确定性结论 vs 短暂不可判定、确定性结论 `retryable: false` 出口。
- 对应回归测试（红→绿），覆盖三条边界：stale+reason_code→fail-closed、unknown无reason_code→retryable、freshness缺失→终态。

**不在范围内**：
- map-client 事实投影/freshness 生成逻辑改动。
- 调度侧重试次数/退避策略（本次只在 gate 出口把可重试语义修正，不改 orchestrator 重排器）。
- 其余六层修复（99-105，r37 已上线）不重复实现。

## 假设

- [ASSUMPTION: map-client 的 freshness 契约为 `{ status: 'fresh'|'stale'|'unknown', reason_code: string|null }`（map-client.js:116 注释为准），确定性结论以 reason_code 非空表达。]
- [ASSUMPTION: 下游调度以 verdict 的 `retryable` 布尔决定是否重排；`retryable:false` 即 fail-closed 终态。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：步骤 3a mapper_stale 分支透传 reason_code + fail-closed 出口。
- `packages/brain/src/impact-contract/__tests__/harness-gates.test.js`（或同目录 diff-gate 测试）：新增/更新回归断言，先红后绿。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step + journey_feature 均空），PrepPRD 无显式 NFR -->
- 超时/延迟: 待定（PrepPRD 未指定；gate 为纯内存裁决，无外部超时）
- 频控: 无（本次目标即消除同一确定性结论的无限重试）
- 版本要求: 无
- 可观测: gate 出口必须暴露真实 reason_code（禁止恒定 mapper_stale 掩盖），便于 trace 观测空转是否终止

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature 为空；area 级注入 canonical [系统] 铁律。
     注：area 查询另返回约 60 条 [capture-triage] learning / smoke-invariant-* 自产噪音行（非策展铁律），未逐字注入以防合同污染。 -->
- [真环境验证] 真环境验证才算 done，禁空泛"测试通过"收尾（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area）
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [多租户默认] 测试默认多租户（来源: area）
- [租户隔离] 记忆/数据按租户隔离（来源: area）
- [凭据安全] 凭据不入 git，日志脱敏（来源: area）
- [语义不分叉] 同一语义（如 status/reason_code 枚举）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area capture-triage 052e10a0/113a9330，与本次 reason_code 透传直接相关）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史：journey e6f803f2 golden-paths 返回空，无 done/working ability）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node/vitest + 结构性断言）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（node -e 直调 evaluateDiffGate + vitest 回归）
# 期望验收点（自然语言）：
#  1. 传入 freshness={status:'stale', reason_code:'<确定性码>'} 的 mapperResult → gate 返回对象 reason_code 等于该确定性码（非 'mapper_stale'），且 retryable === false。
#  2. 传入 freshness={status:'unknown', reason_code:null} → retryable === true（短暂不可判定）。
#  3. 传入无 freshness → 终态可观察、不假绿。
#  4. 回归测试在修复前红、修复后绿，永久保留在 CI。
```

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain/src/impact-contract/（纯后端 gate 裁决），无 UI/agent 协议/engine 路径命中，按 if-elif 链落 autonomous。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；本地 evaluator 直调 evaluateDiffGate + vitest（localhost 无外部机器）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
