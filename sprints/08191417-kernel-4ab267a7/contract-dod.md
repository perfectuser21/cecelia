---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code 并 fail-closed 出口（r19/r22）

**范围**: `diff-gate.js` / `structure-gate.js` 非 fresh 分支按 `freshness.status` 分流透传 reason_code；确定性/缺失情形 fail-closed（retryable:false）。对应回归测试红→绿永久保留。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 非 fresh 分支已拆分折叠（不再无条件 mapper_stale/retryable:true）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');const m=c.match(/status\s*!==\s*'fresh'[\s\S]{0,400}/);if(!m||!/reason_code/.test(m[0])||/retryable:\s*true\s*,?\s*\}/.test(m[0].split('reason_code')[0]))process.exit(1)"

- [ ] [ARTIFACT] structure-gate.js 非 fresh 分支已按 status 分流（引用 reason_code）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/structure-gate.js','utf8');const m=c.match(/status\s*!==\s*'fresh'[\s\S]{0,400}/);if(!m||!/reason_code/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] 永久回归断言写入真实测试文件 diff-gate.test.js（含 impact_anchor_missing 用例）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/diff-gate.test.js','utf8');if(!c.includes('impact_anchor_missing'))process.exit(1)"

- [ ] [ARTIFACT] 永久回归断言写入真实测试文件 structure-gate.test.js（含 impact_anchor_missing 用例）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/structure-gate.test.js','utf8');if(!c.includes('impact_anchor_missing'))process.exit(1)"

## BEHAVIOR 条目（五行剧本 — evaluator 直接执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] B-01: diff-gate 瞬态 stale 透传 reason_code 且 retryable:true
  动作: 用瞬态 stale freshness（fact_snapshot_stale）调 evaluateDiffGate，探针写结果 JSON 到文件
  预期观察: 结果 reason==fact_snapshot_stale、reason_code==fact_snapshot_stale、retryable==true（不再是 mapper_stale）
  等待预算: 0s
  留证: /tmp/b01.json（gate 返回对象）
  Test: manual:bash -c 'node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate diff --scenario transient --out /tmp/b01.json >/dev/null 2>&1; jq -e ".retryable==true and .reason==\"fact_snapshot_stale\" and .reason_code==\"fact_snapshot_stale\"" /tmp/b01.json || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-02: diff-gate 确定性 unknown fail-closed（retryable:false）+ 透传 reason_code
  动作: 用确定性 unknown freshness（impact_anchor_missing）调 evaluateDiffGate
  预期观察: 结果 retryable==false（终止重试）、reason==impact_anchor_missing、reason!=mapper_stale
  等待预算: 0s
  留证: /tmp/b02.json
  Test: manual:bash -c 'node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate diff --scenario deterministic --out /tmp/b02.json >/dev/null 2>&1; jq -e ".retryable==false and .reason==\"impact_anchor_missing\" and (.reason!=\"mapper_stale\")" /tmp/b02.json || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: diff-gate freshness 缺失 fail-closed，不折叠回 mapper_stale
  动作: 用 freshness=null 调 evaluateDiffGate
  预期观察: 结果 retryable==false 且 reason!=mapper_stale（确定性兜底码，非静默 retryable:true）
  等待预算: 0s
  留证: /tmp/b03.json
  Test: manual:bash -c 'node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate diff --scenario missing --out /tmp/b03.json >/dev/null 2>&1; jq -e ".retryable==false and (.reason!=\"mapper_stale\") and (.reason|length>0)" /tmp/b03.json || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: diff-gate reason_code 缺失但 status=unknown → 确定性兜底 + retryable:false
  动作: 用 freshness={status:'unknown'}（无 reason_code）调 evaluateDiffGate
  预期观察: 结果 retryable==false、reason 非空且非 mapper_stale（确定性兜底码）
  等待预算: 0s
  留证: /tmp/b04.json
  Test: manual:bash -c 'node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate diff --scenario code_missing_unknown --out /tmp/b04.json >/dev/null 2>&1; jq -e ".retryable==false and (.reason!=\"mapper_stale\") and (.reason|length>0)" /tmp/b04.json || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-05: structure-gate 瞬态 stale 透传 + retryable:true（与 diff 同构）
  动作: 用瞬态 stale freshness（fact_snapshot_stale）调 evaluateStructureGate
  预期观察: 结果 retryable==true、reason==fact_snapshot_stale（不再折叠 mapper_stale）
  等待预算: 0s
  留证: /tmp/b05.json
  Test: manual:bash -c 'node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate structure --scenario transient --out /tmp/b05.json >/dev/null 2>&1; jq -e ".retryable==true and .reason==\"fact_snapshot_stale\"" /tmp/b05.json || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-06: structure-gate 确定性 unknown fail-closed + 透传（语义与 diff 不分叉）
  动作: 用确定性 unknown freshness（impact_anchor_missing）调 evaluateStructureGate
  预期观察: 结果 retryable==false、reason==impact_anchor_missing，与 diff-gate B-02 一致
  等待预算: 0s
  留证: /tmp/b06.json
  Test: manual:bash -c 'node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate structure --scenario deterministic --out /tmp/b06.json >/dev/null 2>&1; jq -e ".retryable==false and .reason==\"impact_anchor_missing\"" /tmp/b06.json || { echo FAIL; exit 1; }; echo OK'

## Invariant 覆盖条目（铁律映射 — PRD Invariant 逐条）

- [ ] [BEHAVIOR] [L2] INV-1 [fail-closed] 任何不可判定/缺失情形 retryable:false，绝不假绿
  动作: 对 diff missing 与 code_missing_unknown 两种不可判定输入调 gate
  预期观察: 两者 retryable 均为 false
  等待预算: 0s
  留证: /tmp/inv1a.json /tmp/inv1b.json
  Test: manual:bash -c 'node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate diff --scenario missing --out /tmp/inv1a.json >/dev/null 2>&1; node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate diff --scenario code_missing_unknown --out /tmp/inv1b.json >/dev/null 2>&1; jq -e ".retryable==false" /tmp/inv1a.json && jq -e ".retryable==false" /tmp/inv1b.json || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-2 [语义一致] diff-gate 与 structure-gate 确定性 unknown 同一处理策略（同 retryable + 同 reason）
  动作: 对同一确定性 unknown 输入分别调 diff 与 structure，比对 retryable 与 reason
  预期观察: 两 gate 的 retryable 与 reason 完全一致（无跨脚本语义分叉）
  等待预算: 0s
  留证: /tmp/inv2d.json /tmp/inv2s.json
  Test: manual:bash -c 'node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate diff --scenario deterministic --out /tmp/inv2d.json >/dev/null 2>&1; node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate structure --scenario deterministic --out /tmp/inv2s.json >/dev/null 2>&1; DR=$(jq -r ".retryable" /tmp/inv2d.json); SR=$(jq -r ".retryable" /tmp/inv2s.json); DC=$(jq -r ".reason" /tmp/inv2d.json); SC=$(jq -r ".reason" /tmp/inv2s.json); [ "$DR" = "$SR" ] && [ "$DC" = "$SC" ] || { echo "FAIL: diff/structure 语义分叉 dr=$DR sr=$SR dc=$DC sc=$SC"; exit 1; }; echo OK'

- [ ] INV-3 [status枚举全仓库grep] N/A：本 sprint 不新增 status/reason_code 枚举值（reason_code 全部透传自 radius.js 既有枚举，兜底码 mapper_*_unspecified/mapper_freshness_missing 为 gate 侧确定性常量，非 Mapper 枚举）——generator 若引入新兜底码须全仓库 grep 确认无硬编码依赖旧 mapper_stale
- [ ] INV-4 [真环境验证] 覆盖于 B-01..B-06 + E2E 第 7 段（真实 gate 代码 + 真实回归测试文件跑绿，非 mock 被改的边）
- [ ] INV-5 [禁写死环境值] N/A：无环境假设值；freshness 从注入输入读取，无坐标/阈值/env 硬编码
- [ ] INV-6 [测试多租户/租户隔离] N/A：gate 为无租户态纯分类函数，输入不含租户身份
- [ ] INV-7 [凭据安全] N/A：无凭据、无日志敏感字段（探针仅打印 gate 结果对象到 stderr）
- [ ] INV-8 [planner分支] N/A：本 sprint 为 proposer/generator 环节，未自行 checkout planner 分支

## 永久回归（TDD 绿证据 — 真实测试文件全绿）

- [ ] [BEHAVIOR] [L2] B-07: 真实回归测试文件全绿（子 shell 进 packages/brain，禁从仓库根跑 vitest）
  动作: 在 packages/brain 内跑 diff-gate.test.js + structure-gate.test.js
  预期观察: 两测试文件全部用例 PASS（含新增 impact_anchor_missing 回归用例）
  等待预算: 120s
  留证: vitest 输出末尾 PASS 汇总
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/structure-gate.test.js'
