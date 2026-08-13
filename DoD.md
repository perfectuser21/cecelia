contract_branch: cp-harness-propose-r1-12a85c17-r60fa6c43-a4
sprint_dir: sprints/08131950-harness-merge-authority-r6

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 修复 Coding 合并身份闸与 AI 验收闭环（fail-closed merge authority）

**范围**: should-auto-merge 身份闸(RED-A)、Kernel premature_merge 终态(RED-B)、Harness merge 权威 evaluateMergeAuthority(RED-C)、materializeApprovedContract 状态机守卫(RED-D)；四段永久 RED（严格 TDD）。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] should-auto-merge.sh 改为 entitlement + 身份闸 fail-closed（含 brain_unreachable/stale_head_sha/entitlement_missing/untrusted 分支）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/should-auto-merge.sh','utf8');if(!/merge-entitlement/.test(c)||!/stale_head_sha/.test(c))process.exit(1)"

- [x] [ARTIFACT] evaluateMergeAuthority 在 validation-identity-policy.js 导出（保留既有 evaluateValidationIdentityPolicy）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/validation-identity-policy.js','utf8');if(!/export function evaluateMergeAuthority/.test(c)||!/evaluateValidationIdentityPolicy/.test(c))process.exit(1)"

- [x] [ARTIFACT] derive.js merged 分支加入同 head 双 PASS receipt 守卫（premature_merge）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!/premature_merge/.test(c))process.exit(1)"

- [x] [ARTIFACT] contract-store.js materializeApprovedContract 加 superseded/未知附着状态守卫
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/contract-store.js','utf8');if(!/superseded/.test(c)||!/invalid_attached_contract_status|不得重激活/.test(c))process.exit(1)"

- [x] [ARTIFACT] 四段永久回归测试落位（迁入各自 __tests__ 规范位置）
  Test: node -e "const fs=require('fs');['sprints/08131950-harness-merge-authority-r6/tests/red-a-should-auto-merge.test.sh','sprints/08131950-harness-merge-authority-r6/tests/red-b-premature-merge.test.mjs','sprints/08131950-harness-merge-authority-r6/tests/red-c-merge-authority.test.mjs','sprints/08131950-harness-merge-authority-r6/tests/red-d-contract-store-statemachine.test.mjs'].forEach(p=>fs.accessSync(p))"

## BEHAVIOR 条目（五行剧本 — 内嵌 manual:bash 单行命令，evaluator 真跑）

- [x] [BEHAVIOR] [L2] B-01: RED-A 身份闸四态 fail-closed + 受信 entitlement 才 MERGE
  动作: 跑 should-auto-merge 身份闸 shell 回归（受信绑定/无 entitlement/Brain 不可达/陈旧 head/不受信/harness/非 cp-* 七场景）
  预期观察: 通用 cp-* 无受信 entitlement 一律 SKIP，仅精确绑定受信 entitlement 输出 MERGE；Results: PASS=7 FAIL=0
  等待预算: 0s
  留证: /tmp/red-a.log 末 10 行（含 Results 行）
  Test: manual:bash -c 'bash sprints/08131950-harness-merge-authority-r6/tests/red-a-should-auto-merge.test.sh | tee /tmp/red-a.log | grep -qE "Results: PASS=7 FAIL=0"'

- [x] [BEHAVIOR] [L2] B-02: RED-B 提前合并 fail-closed 为 premature_merge（不假 done）
  动作: 跑 derive premature_merge 纯函数回归（外部 merged 但缺同 head 双 PASS receipt）
  预期观察: premature 三态返回 phase=failed/action=mark_failed/reason=premature_merge；合法双 PASS 仍 done/pr_merged，全 5 passed
  等待预算: 0s
  留证: /tmp/red-b.log 末 10 行
  Test: manual:bash -c 'DATABASE_URL="${DB_URL:-$DATABASE_URL}" npx vitest run sprints/08131950-harness-merge-authority-r6/tests/red-b-premature-merge.test.mjs --reporter=basic 2>&1 | tee /tmp/red-b.log | grep -qE "5 passed"'

- [x] [BEHAVIOR] [L2] B-03: RED-C 合并权威 evaluateMergeAuthority fail-closed
  动作: 跑合并权威纯函数回归（双同 head PASS→allow；Brain 查询错误/缺角色/旧 SHA/被拒 callback→deny）
  预期观察: allow 分支 reason=all_roles_pass；四类 fail-closed 输入 deny 且 reason 精确，全 10 passed
  等待预算: 0s
  留证: /tmp/red-c.log 末 10 行
  Test: manual:bash -c 'npx vitest run sprints/08131950-harness-merge-authority-r6/tests/red-c-merge-authority.test.mjs --reporter=basic 2>&1 | tee /tmp/red-c.log | grep -qE "10 passed"'

- [x] [BEHAVIOR] [L2] B-04: RED-D 合同状态机 superseded/未知附着 fail-closed（真 Postgres）
  动作: 跑 materializeApprovedContract 状态机回归（superseded/未知附着报错；draft 附着允许原子换版）
  预期观察: superseded/未知附着抛错不重激活；draft 换版为 approved，全 3 passed（真 Postgres，非 skip）
  等待预算: 0s
  留证: /tmp/red-d.log 末 10 行
  Test: manual:bash -c 'DATABASE_URL="${DB_URL:-$DATABASE_URL}" npx vitest run sprints/08131950-harness-merge-authority-r6/tests/red-d-contract-store-statemachine.test.mjs --reporter=basic 2>&1 | tee /tmp/red-d.log | grep -qE "3 passed"'

- [x] [BEHAVIOR] [L2] B-05: DB 不变量——premature_merge 绝不回填 completed（假成功钉死） [接缝×2]
  动作: 对 local_api 真库查询「run.failure_reason=premature_merge 却 task.status=completed」的记录数
  预期观察: 该假成功记录数恒为 0（外部提前合并的 run 不得被回填成 completed/done）
  等待预算: 0s
  留证: psql 查询输出（count 值）
  Test: manual:bash -c 'psql "${DB_URL:-$DATABASE_URL}" -tAc "SELECT count(*) FROM tasks t JOIN initiative_runs r ON r.initiative_id=t.id WHERE t.status='\''completed'\'' AND r.failure_reason='\''premature_merge'\''" | tr -d " " | grep -qx 0'

gate-allow: domain/db-no-time-window B-05 是「不假成功」不变量断言（premature_merge 却 completed 的记录恒为 0，跨全表全时段），刻意不加时间窗——加窗反而会放过更早的历史假成功记录，与断言目的相反

## 铁律映射（INV → 覆盖 BEHAVIOR；逐条不得静默消失）

| 铁律 | 断言方式 | 覆盖于 |
|---|---|---|
| INV-1 [合并权威 fail-closed] 身份缺失/延迟/陈旧/Brain 不可达均不放行 | should-auto-merge 四态 SKIP + evaluateMergeAuthority deny | B-01 + B-03 |
| INV-2 [受信通道] 仅受信+绑定 repo+PR+head_sha 的 entitlement 可合并；label 不授权 | should-auto-merge 仅受信精确绑定才 MERGE，label/标题不授权 | B-01 |
| INV-3 [同 head 验收] 须同 head_sha 独立 Evaluator PASS/FIXED + Judge PASS 才授权合并 | evaluateMergeAuthority 同 head 双 PASS→allow，缺/旧 SHA→deny | B-03 |
| INV-4 [真实验收] CI 绿仅机械必要条件 | 接缝 L2：真 Postgres/真 Brain 端点校验 + DB 不变量（非仅 CI 绿）| B-04 + B-05 + 探索层 |
| INV-5 [不假成功] Generator 被取消/外部提前合并时 run 不得 done、task 不得 completed | derive premature_merge→failed + DB 不变量恒 0 | B-02 + B-05 |
