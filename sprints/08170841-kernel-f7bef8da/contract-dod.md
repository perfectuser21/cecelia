---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 确定性结论透传 reason_code 并 fail-closed 出口

**范围**: packages/brain/src/impact-contract/diff-gate.js（按 reason_code 三分类）、harness-gates.js（gateReceipt 透传 detail + 导出）、orchestrator/loop.js（retryable:false 不退避）、orchestrator/derive.js（DETERMINISTIC_IMPACT_ERROR_CODES 补集合 + generator-fix/human_review 路由）、Brain semver 四处 + DevGate 三项。radius.js / map-client.js 不改。
**大小**: M

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | diff-gate 按 mapper reason_code 三分类；确定性结论 retryable=false + 透传 detail；derive 把确定性 impact 路由到 generator-fix / human_review，不再无限重试 |
| **NFR（做得多好）** | 非功能 | 确定性结论必须 fail-closed（retryable:false），禁折叠成 90s 无限重试到 deadline；确定性 blocked 必须落 orchestrator_decision_log |
| **Invariant（永不违反）** | 不变量 | 真新鲜度/基础设施类失败仍 retryable=true 走原退避（不误伤回归）；radius 判定规则不放宽；决策日志 append-only 不破坏 |
| **判定点（怎么知道）** | 判断假设 | 见判定点登记表 |
| **保质期（何时过期）** | 失效 | reason_code 集合随 radius.js 演进；新增 radius reason_code 未登记 → 落 (c) fail-closed（安全默认），需同步补分类集合 |
| **死亡告警（停了谁知道）** | 告警 | 确定性 blocked 落 orchestrator_decision_log + gate_verdict，运维可查；capability_assertion_coverage_missing → wait:human_review 触发人审通道 |
| **失败语义（挂了怎么办）** | 故障 | 见失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | Final E2E 查 orchestrator_decision_log 真实落行（时间窗），不凭"测试通过"空断言 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 记录 API 不稳 | 静默丢消息 |
| ⚠️ mapper 结论是「确定性」还是「真新鲜度」 | A. 按 freshness.status; B. 按 freshness.reason_code | B（按 reason_code 归类到两个显式集合） | status 与语义不 1:1（graph_projection_revision_mismatch status=unknown 却是真新鲜度）；按 status 会误判 | 误判确定性为可重试→无限重试到 deadline（本单根因）；或误判真新鲜度为确定性→本可重试的临时投影不一致被 fail-closed 打死 |
| 新增/未知 reason_code 如何处置 | A. 当真新鲜度 retryable=true; B. fail-closed retryable=false | B | 未知即不可判定，可重试无收敛保证 | 选 A 会让未来某类 bug 再次无限重试；选 B 最坏是提前人审（可接受） |

> judgment-pending-user: ⚠️「确定性 vs 真新鲜度」判定点集合由本合同固化（两个显式 reason_code 集合），PrepPRD 已在 PRD 修法 A 明确列举，无需再升拍板。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| mapper 返回确定性 reason_code | gate=blocked, retryable=false，不重试 | 是（同候选同结论幂等） | derive 路由 generator-fix（可修）/ human_review（需人补断言） |
| mapper 返回真新鲜度 reason_code | impact_unknown/mapper_stale/retryable=true | 是 | loop 按 infrastructure_blocked 退避，deadline 收敛（不变） |
| mapper freshness 缺失/未知 reason_code | impact_unknown/mapper_contract_invalid/retryable=false | 是 | fail-closed，走确定性出口（loop failure_class=impact_contract_invalid） |

### 输入对抗面

N/A — 本单无对外暴露 agent；输入来源为内部 radius/mapper 结论与 kernel decisionLog，非外部用户可写入。

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 按 reason_code 分类（含真新鲜度集合与确定性集合两组常量）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('impact_anchor_missing')||!c.includes('mapper_contract_invalid'))process.exit(1)"

- [ ] [ARTIFACT] harness-gates.js 导出 gateReceipt 并透传 detail
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/harness-gates.js','utf8');if(!/export\s+function\s+gateReceipt|export\s*\{[^}]*gateReceipt/.test(c)||!c.includes('detail'))process.exit(1)"

- [ ] [ARTIFACT] derive.js / loop.js DETERMINISTIC_IMPACT_ERROR_CODES 补齐确定性 reason
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/loop.js','utf8');if(!c.includes('impact_anchor_missing'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: diff-gate 把 impact_anchor_missing 判为确定性 blocked
  动作: 以 mapper 返回 `{freshness:{status:'unknown',reason_code:'impact_anchor_missing'},unclaimed_files:['DoD.md']}` 真调 evaluateDiffGate
  预期观察: 返回 gate='blocked'、reason='impact_anchor_missing'、retryable=false、detail.unclaimed_files=['DoD.md']；capability_assertion_coverage_missing 同理带 detail.capability_ids
  等待预算: 0s
  留证: vitest 输出末尾（diff-gate-reason-code.test.js 全绿）
  Test: manual:bash -c 'npx vitest run sprints/08170841-kernel-f7bef8da/tests/diff-gate-reason-code.test.js -t "impact_anchor_missing 返回 blocked"'

- [ ] [BEHAVIOR] [L2] B-02: diff-gate 按 reason_code 而非 status 分类（真新鲜度回归保护）
  动作: 以 mapper 返回 fact_snapshot_stale / graph_projection_revision_mismatch(status=unknown) 等真新鲜度 reason_code 真调 evaluateDiffGate
  预期观察: 仍返回 impact_unknown/mapper_stale/retryable=true（graph_projection_revision_mismatch 虽 status=unknown 也归真新鲜度组）
  等待预算: 0s
  留证: vitest 输出（含 status=unknown 用例绿）
  Test: manual:bash -c 'npx vitest run sprints/08170841-kernel-f7bef8da/tests/diff-gate-reason-code.test.js -t "按 reason_code 不按 status"'

- [ ] [BEHAVIOR] [L2] B-03: diff-gate 对未知/畸形 freshness fail-closed
  动作: 以 mapper 返回未知 reason_code 或缺失 freshness 真调 evaluateDiffGate
  预期观察: 返回 impact_unknown/mapper_contract_invalid/retryable=false（不再折叠成可重试）
  等待预算: 0s
  留证: vitest 输出（fail-closed 用例绿）
  Test: manual:bash -c 'npx vitest run sprints/08170841-kernel-f7bef8da/tests/diff-gate-reason-code.test.js -t "fail-closed"'

- [ ] [BEHAVIOR] [L2] B-04: harness-gates gateReceipt 透传 reason/retryable/detail
  动作: 对确定性 blocked 结果真调导出的 gateReceipt('diff', result)
  预期观察: 收据含 reason、retryable=false、detail.unclaimed_files / detail.capability_ids；pass 结果 detail 为 null 不崩
  等待预算: 0s
  留证: vitest 输出（harness-gates-receipt.test.js 全绿）
  Test: manual:bash -c 'npx vitest run sprints/08170841-kernel-f7bef8da/tests/harness-gates-receipt.test.js'

- [ ] [BEHAVIOR] [L2] B-05: derive 把 retryable:false 确定性 impact 路由确定性出口
  动作: 构造 decisionLog 含 impact-blocked 收据（retryable=false）真调纯函数 derive(observed)
  预期观察: impact_anchor_missing→spawn:generator-fix（携 unclaimed_files）；capability_assertion_coverage_missing→wait:human_review；已 generator-fix 一次仍 blocked→wait:human_review
  等待预算: 0s
  留证: vitest 输出（impact-routing-derive.test.js 全绿）
  Test: manual:bash -c 'npx vitest run sprints/08170841-kernel-f7bef8da/tests/impact-routing-derive.test.js'

- [ ] [BEHAVIOR] [L2] B-06: 回归 d1360a48 无主文件 DoD.md 不再 mapper_stale
  动作: 用 run d1360a48 真实 changed_files（含 DoD.md）+ radius 录制件真调 evaluateDiffGate
  预期观察: 新行为 blocked:impact_anchor_missing/retryable=false（旧码为 mapper_stale/retryable=true，此为回归护栏）
  等待预算: 0s
  留证: vitest 输出（regression-d1360a48-impact-anchor.test.js 绿）
  Test: manual:bash -c 'npx vitest run sprints/08170841-kernel-f7bef8da/tests/regression-d1360a48-impact-anchor.test.js'

- [ ] [BEHAVIOR] [L2] B-07: Final E2E 确定性 blocked 真落 orchestrator_decision_log（scratch 库，时间窗）
  动作: 对 attempt 级空库跑真实 migration，真 evaluateDiffGate→真 gateReceipt→真 appendHop 写 decision-log（见 contract-draft.md ## E2E 验收）
  预期观察: orchestrator_decision_log 5 分钟内新增行 gate_verdict='deny:impact:impact_anchor_missing'、detail.impact_gate.retryable=false、detail.impact_gate.detail.unclaimed_files 非空
  等待预算: 30s
  留证: E2E 脚本 stdout（OK: ... decision_log_rows=N）+ psql count
  Test: manual:bash -c 'DEADLINE=$((SECONDS+30)); until psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; do [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: DB 未就绪"; exit 1; }; sleep 2; done; echo "OK: DB 就绪（Final E2E 全脚本见 contract-draft.md ## E2E 验收，evaluator 模式B 执行）"'

## INV 铁律映射

- [ ] [BEHAVIOR] [L2] INV-1 [generator retry identity] 真新鲜度/基础设施类失败仍 retryable=true 走原退避（不被本单确定性出口误伤）
  动作: B-02 的真新鲜度用例即断言真新鲜度 reason_code 保持 retryable=true
  预期观察: fact_snapshot_stale 等仍 impact_unknown/mapper_stale/retryable=true
  等待预算: 0s
  留证: diff-gate-reason-code.test.js 真新鲜度用例绿
  Test: manual:bash -c 'npx vitest run sprints/08170841-kernel-f7bef8da/tests/diff-gate-reason-code.test.js -t "回归保护"'
- INV-2 [Kernel evaluator clock] N/A：本单不触及 validation_clock 注入/判定路径。
- INV-3 [planner role branch] N/A：本单不触及 planner 分支。
- INV-4 [Fleet Brain URL] N/A：本单不触及 Brain URL 预检。
