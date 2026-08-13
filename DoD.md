contract_branch: cp-harness-propose-r1-c9043059-r0dfcdf41-a12
sprint_dir: sprints/08111523-kernel-c9043059

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: derive 取证死循环双修（recollect 护栏 trigger_sha 兜底 + 新 evaluate PASS 必派 judge）

**范围**: 仅 `packages/brain/src/orchestrator/derive.js` 失败类路由/护栏字段/状态排序 + 其 `__tests__` 单测
**大小**: S

## Invariant 覆盖（铁律三源映射）

- **INV-1 [证据不足补证]** judge FAIL evidence_insufficient 优先走 evaluator 补证轮 → 由下方
  **B-03** 把守（首次 evidence_insufficient 仍走首次 spawn:evaluator，不改错人派 generator）。
- **INV-2 [验证时钟 fail-closed]** → **N/A**：本 sprint 不触及 validation_clock / gates.js。
- **INV-3 [证据窗口 前8×600]** → **N/A**：本 sprint 不改 judge 证据消费窗口。

## ARTIFACT 条目

- [x] [ARTIFACT] 复现回归测试文件存在且含双序列断言（awaiting_judge + after_recollect）
  Test: node -e "const c=require('fs').readFileSync('sprints/08111523-kernel-c9043059/tests/derive-recollect-loop.test.ts','utf8');if(!c.includes('evaluate_passed_awaiting_judge')||!c.includes('evidence_insufficient_after_recollect'))process.exit(1)"

- [x] [ARTIFACT] 两条复现断言已 port 进 derive.test.js 作永久 CI 回归（bug-fix 死规矩）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/__tests__/derive.test.js','utf8');if(!c.includes('evaluate_passed_awaiting_judge')||!c.includes('evidence_insufficient_after_recollect'))process.exit(1)"

## BEHAVIOR 条目（真调 derive 纯函数，无 mock 被改的决策边）

- [x] [BEHAVIOR] [L2] B-01: recollect 返回更晚的 evaluate PASS → 派 judge 复核（run 06e4566c 死循环点）
  动作: 喂 derive「judge FAIL evidence_insufficient(hop3) → spawn:evaluator 补证(hop4) → evaluate PASS(hop5，晚于最新 judge)」序列
  预期观察: derive 返回 action=spawn:judge, reason=evaluate_passed_awaiting_judge（而非再次 spawn:evaluator）
  等待预算: 0s
  留证: /tmp/derive-loop-e2e.log（含该用例 PASS 行）
  Test: manual:bash -c 'W="${WORKSPACE_PATH:-/workspace}"; [ -x "$W/node_modules/.bin/vitest" ] || (cd "$W" && npm ci --no-audit --no-fund >/dev/null 2>&1); cd "$W" && node_modules/.bin/vitest run sprints/08111523-kernel-c9043059/tests/derive-recollect-loop.test.ts -t "派 judge 复核" 2>&1 | sed "s/\x1b\[[0-9;]*[mK]//g" | tee /tmp/derive-b01.out; grep -qE "Tests +1 passed" /tmp/derive-b01.out && ! grep -qE "[1-9][0-9]* failed" /tmp/derive-b01.out || { echo "FAIL B-01"; exit 1; }; echo OK'

- [x] [BEHAVIOR] [L2] B-02: recollect 后仍不足(trigger_sha 缺失，pr.head_sha 兜底) → 落人审 非第三次 recollect
  动作: 喂 derive「补证后 judge 重审仍 evidence_insufficient(hop6，最新)，且 spawn:evaluator 快照缺顶层 trigger_sha 仅 pr.head_sha」序列
  预期观察: derive 返回 action=wait:human_review, reason=evidence_insufficient_after_recollect（护栏兜底触发，不第三次 spawn:evaluator）
  等待预算: 0s
  留证: /tmp/derive-loop-e2e.log（含该用例 PASS 行）
  Test: manual:bash -c 'W="${WORKSPACE_PATH:-/workspace}"; [ -x "$W/node_modules/.bin/vitest" ] || (cd "$W" && npm ci --no-audit --no-fund >/dev/null 2>&1); cd "$W" && node_modules/.bin/vitest run sprints/08111523-kernel-c9043059/tests/derive-recollect-loop.test.ts -t "落人审 非第三次 recollect" 2>&1 | sed "s/\x1b\[[0-9;]*[mK]//g" | tee /tmp/derive-b02.out; grep -qE "Tests +1 passed" /tmp/derive-b02.out && ! grep -qE "[1-9][0-9]* failed" /tmp/derive-b02.out || { echo "FAIL B-02"; exit 1; }; echo OK'

- [x] [BEHAVIOR] [L2] B-03: 首次 evidence_insufficient(evaluate 不晚于 judge) → 首次 spawn:evaluator 补证（INV-1 不回归，awaiting_judge 不过度触发）
  动作: 喂 derive「judge FAIL evidence_insufficient(hop3，最新)，无更晚 evaluate、无既往 recollect」序列
  预期观察: derive 返回 action=spawn:evaluator, reason=judge_evidence_insufficient_recollect（首轮补证语义不变）
  等待预算: 0s
  留证: /tmp/derive-loop-e2e.log（含该用例 PASS 行）
  Test: manual:bash -c 'W="${WORKSPACE_PATH:-/workspace}"; [ -x "$W/node_modules/.bin/vitest" ] || (cd "$W" && npm ci --no-audit --no-fund >/dev/null 2>&1); cd "$W" && node_modules/.bin/vitest run sprints/08111523-kernel-c9043059/tests/derive-recollect-loop.test.ts -t "不误判 awaiting_judge" 2>&1 | sed "s/\x1b\[[0-9;]*[mK]//g" | tee /tmp/derive-b03.out; grep -qE "Tests +1 passed" /tmp/derive-b03.out && ! grep -qE "[1-9][0-9]* failed" /tmp/derive-b03.out || { echo "FAIL B-03"; exit 1; }; echo OK'

- [x] [BEHAVIOR] [L2] B-04: 显式 trigger_sha 护栏路径不回归 → 重审仍不足落人审
  动作: 喂 derive「spawn:evaluator 快照【含】trigger_sha=sha-new 且 judge 重审(hop6)仍 evidence_insufficient」序列
  预期观察: derive 返回 action=wait:human_review, reason=evidence_insufficient_after_recollect（既有显式路径不因兜底改动而回归）
  等待预算: 0s
  留证: /tmp/derive-loop-e2e.log（含该用例 PASS 行）
  Test: manual:bash -c 'W="${WORKSPACE_PATH:-/workspace}"; [ -x "$W/node_modules/.bin/vitest" ] || (cd "$W" && npm ci --no-audit --no-fund >/dev/null 2>&1); cd "$W" && node_modules/.bin/vitest run sprints/08111523-kernel-c9043059/tests/derive-recollect-loop.test.ts -t "显式路径不回归" 2>&1 | sed "s/\x1b\[[0-9;]*[mK]//g" | tee /tmp/derive-b04.out; grep -qE "Tests +1 passed" /tmp/derive-b04.out && ! grep -qE "[1-9][0-9]* failed" /tmp/derive-b04.out || { echo "FAIL B-04"; exit 1; }; echo OK'

- [x] [BEHAVIOR] [L2] B-05: 现有 derive 全量单测不回归（基线 95 用例含 evidence_insufficient/product_failure 分支）
  动作: 跑 packages/brain 现有 derive.test.js 全量
  预期观察: 全部用例通过，无 failed；evidence_insufficient/product_failure 既有分支断言保持绿
  等待预算: 0s
  留证: /tmp/derive-full-e2e.log（Test Files 1 passed）
  Test: manual:bash -c 'W="${WORKSPACE_PATH:-/workspace}"; cd "$W/packages/brain"; { [ -x node_modules/.bin/vitest ] && node_modules/.bin/vitest run src/orchestrator/__tests__/derive.test.js || npx vitest run src/orchestrator/__tests__/derive.test.js; } 2>&1 | sed "s/\x1b\[[0-9;]*[mK]//g" | tee /tmp/derive-b05.out; grep -qE "Test Files +1 passed" /tmp/derive-b05.out && ! grep -qE "[1-9][0-9]* failed" /tmp/derive-b05.out || { echo "FAIL B-05"; exit 1; }; echo OK'
