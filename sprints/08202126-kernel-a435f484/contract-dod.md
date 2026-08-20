---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 确定性 Map 结论透传 reason_code 并 fail-closed 出口

**范围**: `diff-gate.js` 步骤 3a + `structure-gate.js` 规则 3 的 stale 分支——按 `freshness.reason_code` 是否非空字符串分流：确定性透传 reason_code + retryable:false（fail-closed 出口）；真瞬态保留 mapper_stale + retryable:true。不改 Mapper 算法、不改 loop.js/harness-gates.js。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js stale 分支引用 freshness.reason_code（确定性分支透传来源）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!/freshness[\s\S]{0,40}reason_code|reason_code[\s\S]{0,40}freshness/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] structure-gate.js 规则 3 stale 分支按 reason_code 分流
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/structure-gate.js','utf8');if(!/reason_code/.test(c))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，manual:bash -c 单行；真调被改裁决边，db:null 无 Postgres）

- [ ] [BEHAVIOR] [L2] B-01: 确定性 stale 结论 diff gate 透传 reason_code 且 fail-closed（retryable:false）
  动作: 调 evaluateDiffGate（db:null）注入 mapClient 返回 freshness.status='stale' + reason_code='projection_revision_mismatch'
  预期观察: 返回体 gate='impact_unknown'（仍 blocked 不假绿），reason_code 字面透传，retryable=false
  等待预算: 0s
  留证: verify-gate.mjs det-diff 命令输出（含 result JSON 与 OK 行）
  Test: manual:bash -c 'node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs det-diff | grep -q "OK: det-diff"'

- [ ] [BEHAVIOR] [L2] B-02: 确定性 stale 不折叠通用 mapper_stale，回执可显现具体 reason_code
  动作: 调 evaluateDiffGate（确定性 stale），复刻 gateReceipt 规则 reason ?? reason_code
  预期观察: result.reason !== 'mapper_stale'，且 (reason ?? reason_code) === 'projection_revision_mismatch'（失败原因将成 impact_gate_deterministic:projection_revision_mismatch）
  等待预算: 0s
  留证: verify-gate.mjs mask-diff 命令输出（含 surfaced 字段）
  Test: manual:bash -c 'node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs mask-diff | grep -q "OK: mask-diff"'

- [ ] [BEHAVIOR] [L2] B-03: 真瞬态 unknown（无 reason_code）diff gate 保留 retryable:true 刷新窗口
  动作: 调 evaluateDiffGate 注入 mapClient 返回 freshness.status='unknown'（无 reason_code）
  预期观察: 返回体 gate='impact_unknown'，retryable=true（未被误判 fail-closed，正常刷新窗口不卡死）
  等待预算: 0s
  留证: verify-gate.mjs transient-diff 命令输出
  Test: manual:bash -c 'node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs transient-diff | grep -q "OK: transient-diff"'

- [ ] [BEHAVIOR] [L2] B-04: 确定性 stale structure gate 透传 reason_code 且 retryable:false（语义一致并修）
  动作: 调 evaluateStructureGate（db:null）注入 mapClient 返回确定性 stale
  预期观察: 返回体 gate='blocked'（自身约定，仍 fail-closed），reason_code 透传，retryable=false（与 diff gate 同处理策略）
  等待预算: 0s
  留证: verify-gate.mjs det-structure 命令输出
  Test: manual:bash -c 'node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs det-structure | grep -q "OK: det-structure"'

- [ ] [BEHAVIOR] [L2] B-05: Mapper 不可达抛错 diff gate 保持 mapper_unavailable + retryable:true（真不可达属瞬态，不回退）
  动作: 调 evaluateDiffGate 注入抛错 mapClient（ETIMEDOUT）
  预期观察: 返回体 reason='mapper_unavailable'，retryable=true（真不可达仍走既有 infra backoff）
  等待预算: 0s
  留证: verify-gate.mjs unavail-diff 命令输出
  Test: manual:bash -c 'node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs unavail-diff | grep -q "OK: unavail-diff"'

- [ ] [BEHAVIOR] [L2] B-06: 真瞬态 unknown structure gate 保留 mapper_stale + retryable:true
  动作: 调 evaluateStructureGate 注入 mapClient 返回 freshness.status='unknown'（无 reason_code）
  预期观察: 返回体 gate='blocked'，retryable=true（未被误判 fail-closed）
  等待预算: 0s
  留证: verify-gate.mjs transient-structure 命令输出
  Test: manual:bash -c 'node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs transient-structure | grep -q "OK: transient-structure"'

- [ ] [BEHAVIOR] [L2] B-07: sprint 合同回归全绿（红→绿证据；瞬态守活项不回退）
  动作: 从仓库根跑 sprint 合同 vitest（命中根 include sprints/**）
  预期观察: 6 个 it 全 pass（3 个新确定性行为转绿 + 3 个瞬态/不可达守活项保持绿）
  等待预算: 120s
  留证: vitest --reporter=dot 输出末尾 "Tests  6 passed"
  Test: manual:bash -c 'npx vitest run sprints/08202126-kernel-a435f484/tests/diff-gate-deterministic-stale.test.js --reporter=dot 2>&1 | grep -q "6 passed"'

## Invariant 覆盖条目（铁律逐条映射）

- [ ] [BEHAVIOR] INV-fail-closed [L2]: 确定性与瞬态两分支返回体均 blocked（impact_unknown/blocked），绝不假绿放行 → 由 B-01(gate=impact_unknown)/B-04(gate=blocked)/B-03/B-06 共同覆盖，无 gate='pass' 出现
  Test: manual:bash -c 'node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs det-diff | grep -q "impact_unknown" && node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs det-structure | grep -q "blocked"'
- [ ] [BEHAVIOR] INV-语义一致 [L2]: diff/structure 两端对确定性 stale 同一处理策略（均 retryable:false + reason_code 透传）→ 由 B-01 + B-04 联合守（det-diff 与 det-structure 同时 OK）
  Test: manual:bash -c 'node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs det-diff | grep -q "OK: det-diff" && node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs det-structure | grep -q "OK: det-structure"'
- INV-catch计数（禁静默无限重试）: 确定性结论 retryable:false → orchestrator 归类 impact_contract_invalid → failRun(impact_gate_deterministic:<reason_code>) 带具体原因留痕，不静默空转至 deadline → 由 B-01 retryable:false + B-02 具体 reason_code 显现共同保证（下游 loop.js 既有链路，本单不改）
- INV-真环境验证: N/A（可执行）——本单为纯进程内裁决逻辑，oracle 真调 real Gate 函数（非替身）即本域「真环境」；无真机/生产 env 接缝
- INV-失败契约显式处理: N/A——本单未新增「失败返回 null/false」契约调用；stale 分支为条件分流，两条出口均显式返回
- INV-status枚举全扫: 已扫——本单只读 `freshness.status`（'fresh'/'stale'/'unknown'）与 `freshness.reason_code`，未硬编码新增 status 枚举值；gate 返回值沿用既有 'impact_unknown'/'blocked'/'pass'/'extend'/'drift'，无新枚举
- INV-多租户默认: N/A——裁决函数不含租户维度；PRD 边界情况第 4 条（并发多 task 命中同一 stale 各自独立终止不污染 backoff）由「纯裁决无共享状态」天然满足，探索提示已列为高风险面
