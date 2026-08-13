contract_branch: cp-harness-propose-r1-8f0aca1e-ra2e10f0f-a4
sprint_dir: sprints/08131745-harness-contract-reopen-r5

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Harness 合同重开后批准证据原子换版（r5）

**范围**: `packages/brain/src/orchestrator/contract-store.js` 的 `materializeApprovedContract` 已附着合同分支按 draft/approved 分流；draft 附着走单事务原子换版（插 v2 approved + 置 v1 superseded + 切 run.contract_id 到 v2）；approved 附着保持逐字段比对 + fail-closed。永久回归用例落 `contract-store.test.js`（brain-integration 真 Postgres 跑）。
**大小**: S

## 历史约束 INV 映射（Step 1.3）

- INV-1 N/A：controller 未注入铁律清单，PRD「Invariant 约束」段明示本 line 暂无适用铁律。
- INV-2 fail-closed 安全红线（PRD NFR 第 73 行）：由 B-04 覆盖（附着 approved 证据不一致仍抛 mismatch）。
- INV-3 原子性红线（PRD NFR 第 71 行）：由 B-01/B-02 覆盖（单事务后 DB 三态一致，无半换版中间态被提交）。
- INV-4 status 枚举合法集 draft/approved/superseded（contract-status-literals.test.js）：draft 分流不引入新枚举值，既有 check 约束不放宽。

## ARTIFACT 条目

- [x] [ARTIFACT] 永久回归用例已落 CI 文件（brain-integration 真 Postgres 跑，CLAUDE.md 铁律 20）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/__tests__/contract-store.test.js','utf8');for(const s of ['reopen v1 draft attached','reopen 换版幂等','fail-closed','run 首轮无 contract_id']){if(!c.includes(s))process.exit(1)}"

- [x] [ARTIFACT] draft 分流实现落 contract-store.js（附着 draft → 原子换版，标记锚点便于审计）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/contract-store.js','utf8');if(!c.includes('ATOMIC_RESWAP_ON_DRAFT'))process.exit(1)"

- [x] [ARTIFACT] RED 规格文件存在（移植来源，含 4 例真 PG 用例）
  Test: node -e "const c=require('fs').readFileSync('sprints/08131745-harness-contract-reopen-r5/tests/contract-reopen-atomic-swap.test.js','utf8');if(!c.includes('materializeApprovedContract')||!c.includes('runIf'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual:bash，真实 Postgres，L2 服务端真验）

- [x] [BEHAVIOR] [L2] B-01: reopen v1 draft 附着 + Round2 新证据 → 原子换版 v2 approved、v1 superseded、run.contract_id 切 v2
  动作: 造 run.contract_id 指向 v1 draft，用新 SHA/branch/artifacts（version=2）调 materializeApprovedContract（跑 contract-store.test.js 该用例）
  预期观察: 真 Postgres 中 v2.status=approved、v1.status=superseded、run.contract_id=v2.id；修复前此调用抛 attached approved contract evidence mismatch（RED）
  等待预算: 0s（同步返回，非异步轮询）
  留证: run-case.sh 输出末 30 行（含 Tests N passed / OK 行）进 behavior_tests.log_tail
  Test: manual:bash -c 'bash sprints/08131745-harness-contract-reopen-r5/tests/run-case.sh "reopen v1 draft attached"'
  期望: OK

- [x] [BEHAVIOR] [L2] B-02: 幂等重放相同 v2 证据返回同一 contract.id，不新建版本、不重复 supersede
  动作: 完成一次换版后，以完全相同的 v2 证据（SHA/branch/content/seal 全一致）再次调用（跑该用例）
  预期观察: 第二次返回 id 与首次相同的合同对象；该 initiative 的 initiative_contracts 版本数恒为 2
  等待预算: 0s
  留证: run-case.sh 输出末 30 行进 behavior_tests.log_tail
  Test: manual:bash -c 'bash sprints/08131745-harness-contract-reopen-r5/tests/run-case.sh "reopen 换版幂等"'
  期望: OK

- [x] [BEHAVIOR] [L2] B-04: fail-closed —— 附着 approved 合同证据不一致（篡改 branch）仍抛 evidence mismatch
  动作: 先原子换版得到 attached v2 approved，再以 branch 被篡改的证据调用（跑该用例）
  预期观察: 抛 attached approved contract evidence mismatch，DB 不换版（安全红线，禁静默换版）
  等待预算: 0s
  留证: run-case.sh 输出末 30 行进 behavior_tests.log_tail
  Test: manual:bash -c 'bash sprints/08131745-harness-contract-reopen-r5/tests/run-case.sh "fail-closed"'
  期望: OK

- [x] [BEHAVIOR] [L2] B-05: run 首轮无 contract_id 不回归（draft 分流不误伤 null 附着的既有插入路径）
  动作: 造 run.contract_id 为 NULL + 存在 v1 draft，调 materializeApprovedContract 换 v2（跑该用例）
  预期观察: 仍走既有插入/supersede/attach 路径，v1 superseded、v2 approved 且 attached，行为不变
  等待预算: 0s
  留证: run-case.sh 输出末 30 行进 behavior_tests.log_tail
  Test: manual:bash -c 'bash sprints/08131745-harness-contract-reopen-r5/tests/run-case.sh "run 首轮无 contract_id"'
  期望: OK
