---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel Knife1 Recovery 3：PR #4372 F1 等价基线收口

**范围**: current-main 重绑、Draft PR `#4372` 收口、migration 366 双跑稳定、evaluator 测试库护栏、F1 fail-closed suite、same-SHA server-owned 审批链证明、风险显式化
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/migrations/366_kernel_harness_f1_baseline.sql` 存在且是 F1 baseline 唯一 migration
  Test: node -e "const fs=require('fs');const p='packages/brain/migrations/366_kernel_harness_f1_baseline.sql';if(!fs.existsSync(p))process.exit(1);"

- [ ] [ARTIFACT] `packages/brain/src/__tests__/integration/migration-366-kernel-harness-f1-baseline.integration.test.js` 存在，或原 `migration-365-executor-kind-kernel-process.integration.test.js` 已语义改绑到 366
  Test: node -e "const fs=require('fs');const a='packages/brain/src/__tests__/integration/migration-366-kernel-harness-f1-baseline.integration.test.js';const b='packages/brain/src/__tests__/integration/migration-365-executor-kind-kernel-process.integration.test.js';if(fs.existsSync(a))process.exit(0);if(!fs.existsSync(b))process.exit(1);const t=fs.readFileSync(b,'utf8');if(!t.includes('366_kernel_harness_f1_baseline.sql'))process.exit(1);"

- [ ] [ARTIFACT] `packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh` 存在
  Test: node -e "require('fs').accessSync('packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh')"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] [L2] approve 路由成功响应必须返回精确 schema
  动作: 运行 mounted router 行为测试，触发一次 current review approve
  预期观察: 202 响应仅含 `ok/run_id/task_id/pr_head_sha/review_request_hop/review_class/approved_by/approved_at`
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js -t "accepts a current review request and commits an observable approval verdict" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] approve 成功 schema keys 完整性与禁用字段反向检查
  动作: 读取 approve 路由响应 schema 合同
  预期观察: 响应 key 集合完整且不出现 `approved`/`merge_ready`/`auto_merge`/`approval_id`/`headSha`
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const t=fs.readFileSync(\"sprints/07272235-kernel-aee91b5d/contract-draft.md\",\"utf8\");if(!t.includes(\"approved_at\")||!t.includes(\"approved_by\"))process.exit(1);for(const bad of [\"approval_id\",\"merge_ready\",\"auto_merge\",\"headSha\"]){if(t.includes(\"`\"+bad+\"`\")===false)process.exit(1);}"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] stale_sha error path 必须返回 `current_pr_head_sha` 且拒绝旧 SHA
  动作: 用旧 `pr_head_sha` 调一次 approve/reject
  预期观察: 服务端返回 409 + `error=stale_sha` + `current_pr_head_sha`
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js -t "allows approvals for two GitHub head SHAs in the same run" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] current-main 六个重叠语义面必须显式列出并对 current main 对账
  动作: 读取 current-main surface helper
  预期观察: surface 恰好 6 项，且描述中显式锚定 `origin/main`/current main，不是 merge-base
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts -t "current-main 六个重叠语义面显式列出并对 current main 对账" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] migration 366 文件存在且双跑稳定快照可验证
  动作: 运行 migration 366 合同红测
  预期观察: 合同要求真实 PG 双跑测试与 366 baseline 文件；合法历史 363/364/365 文件不被误杀
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts -t "migration 366 文件存在且双跑稳定快照可验证" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] HARNESS_TEST_DATABASE_URL 写前 fail-closed
  动作: 运行 evaluator guard 合同红测
  预期观察: 仅接受 `HARNESS_TEST_DATABASE_URL`，拒绝 production-like/default/`127.0.0.1`，要求 `host.docker.internal`
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts -t "HARNESS_TEST_DATABASE_URL 写前 fail-closed" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 合法测试库必须真回读 current_database 与 inet_server_addr
  动作: 用真实 `HARNESS_TEST_DATABASE_URL` 连隔离库
  预期观察: 库名仅 `*_test` 或 `preview_*`；`inet_server_addr()` 非空且不是 `127.0.0.1`
  Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; psql "$HARNESS_TEST_DATABASE_URL" -t -A -c "SELECT current_database() || '\''|'\'' || COALESCE(inet_server_addr()::text,'\'''\'')" | awk -F"|" '\''NF==2 && $1 ~ /(_test$|^preview_)/ && $2 != "127.0.0.1" && length($2)>0 {ok=1} END{exit ok?0:1}'\'''
  期望: exit 0

- [ ] [BEHAVIOR] [L2] F1 fail-closed 套件覆盖七个具名 legacy smokes 与 exact oracle
  动作: 运行 F1 suite 合同红测
  预期观察: suite 必须含 `git-sha-health`、`review-gating`、`harness-judge`、`harness-lifecycle-gates`、`harness-contract-sha-freeze`、`review-approve-auth`、`evaluator-evidence-bridge`
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts -t "F1 fail-closed 套件覆盖七个具名 legacy smokes 与 exact oracle" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] same-SHA evaluator/judge/human approval 必须是只读 server-owned 证明
  动作: 运行 same-SHA fixture 合同红测
  预期观察: `buildReadOnlyHeadShaEvidenceFixture` 存在；head 变化后旧 evidence 失效
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts -t "同 SHA evaluator judge human review 只读证明路径存在" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 双 PASS 且 `review_required=true` 时仍等待 human review
  动作: 运行 current merge-gate 行为测试
  预期观察: evaluator PASS 与 judge PASS 不得替代人工批准；PR 仍 Draft
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run packages/brain/src/orchestrator/__tests__/derive.test.js -t "双 PASS && review_required && 未批准 → wait:human_review" packages/brain/src/orchestrator/__tests__/gates.test.js -t "review_required && 未批准 → 拒" --reporter=verbose'
  期望: exit 0

## Invariant 条目（逐条映射 PRD 铁律）

- [ ] [BEHAVIOR] [L2] INV-1 `target_environment` 仍为 `local_api`
  动作: 读取 sprint PRD
  预期观察: `target_environment=local_api`
  Test: manual:bash -c 'grep -q "^## target_environment: local_api" sprints/07272235-kernel-aee91b5d/sprint-prd.md'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-2 judge `.brain-result.json` 结构仍含 `exit_code`/`log_tail`/`behavior_tests`
  动作: 读取 `harness-judge.js`
  预期观察: 结构字段未退化
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const t=fs.readFileSync(\"packages/brain/src/harness-judge.js\",\"utf8\");for(const k of [\"exit_code\",\"log_tail\",\"behavior_tests\"]){if(!t.includes(k))process.exit(1)}"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-3 PR head SHA 变化时旧 verdict 必须失效
  动作: 跑 same-SHA ground-truth 集成测试
  预期观察: stale PASS + 新 SHA 不通过 merge gate
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run packages/brain/src/orchestrator/__tests__/ground-truth.test.js -t "same-SHA evidence approval cannot satisfy the later merge gate after evaluator and judge PASS" --reporter=verbose'
  期望: exit 0

- N/A：INV-4 共享 CI 基础设施文件未经授权不可改。原因：本合同未授权修改共享 CI 文件。
- N/A：INV-5 `feat+brain/src` PR 开 PR 前带齐 smoke/allowlist。原因：本合同已把七个 legacy smokes 纳入验收，不额外改铁律实现。

- [ ] [BEHAVIOR] [L2] INV-6 历史 proposer/reviewer 证据只作 evidence，不作当前 approval
  动作: 读取合同 notes
  预期观察: 旧 proposer commit 与 reviewer attempt 仅作历史证据
  Test: manual:bash -c 'grep -q "d8db6d9f07711fec53d5c88dce60ad03066dfeea" sprints/07272235-kernel-aee91b5d/contract-draft.md && grep -q "6dc36461-01db-443c-9e71-31b7895386dd" sprints/07272235-kernel-aee91b5d/contract-draft.md'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-9 失败路径禁止 warning 降级
  动作: 检查 F1 suite 与 evaluator guard
  预期观察: 不存在 `|| true`/`else exit 0`/warning-only 放行
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");for(const p of [\"packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh\",\"packages/engine/src/harness/evaluate.js\"]){if(!fs.existsSync(p))process.exit(1);const t=fs.readFileSync(p,\"utf8\");if(/\\|\\| true|else\\s+exit 0|warning.*pass/i.test(t))process.exit(1)}"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-10 判变与验收必须用 current origin/main 与当前 PR head SHA 对账
  动作: 实时抓 `origin/main` 与 `gh pr view 4372`
  预期观察: 不依赖旧 merge-base
  Test: manual:bash -c 'git fetch origin main --quiet && CUR=$(git rev-parse origin/main) && PR=$(gh pr view 4372 --json headRefOid | jq -r ".headRefOid") && [ -n "$CUR" ] && [ -n "$PR" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-12 禁写死环境：测试 host/库名从 env 或真验证据导出
  动作: 检查合同 E2E
  预期观察: 通过 `HARNESS_TEST_DATABASE_URL` 驱动，不硬编码生产库
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const t=fs.readFileSync(\"sprints/07272235-kernel-aee91b5d/contract-draft.md\",\"utf8\");if(t.includes(\"postgresql://localhost/cecelia\"))process.exit(1);"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-13 真环境接缝必须在真目标上验证
  动作: 运行 sprint 合同红测全套
  预期观察: migration 双跑、DB 护栏、same-SHA 证明都走真 PG/真 route/真 git/gh
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts --reporter=verbose'
  期望: exit 0

- N/A：INV-14 默认多租户。原因：本 sprint 不新增跨租户数据路径。
- N/A：INV-15 secrets 不进 git/日志。原因：本合同不引入新 secrets。
- N/A：INV-16 日志脱敏。原因：本 sprint 不新增用户内容日志面。
- N/A：INV-17 租户隔离。原因：本 sprint 不新增租户数据读写路径。
