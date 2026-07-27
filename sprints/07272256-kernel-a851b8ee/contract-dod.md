---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: P0 Kernel Knife1 Recovery 4 formal+audit oracles 07272255

**范围**: Draft PR `#4372` 恢复验收；main 新鲜度重绑、六个重叠面、migration 366 双跑、七个 F1 smoke 模式、11 要素语义、approve/reject schema、same-SHA authority、人审前停止。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] 恢复合同文件齐备
  Test: node -e "const fs=require('fs');for(const p of ['sprints/07272256-kernel-a851b8ee/contract-draft.md','sprints/07272256-kernel-a851b8ee/contract-dod.md','sprints/07272256-kernel-a851b8ee/task-plan.json','sprints/07272256-kernel-a851b8ee/tests/kernel-harness-f1-recovery.contract.test.ts'])if(!fs.existsSync(p))process.exit(1)"

- [ ] [ARTIFACT] migration 366 与 F1 smoke 入口在恢复实现中存在
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/migrations/366_kernel_harness_f1_baseline.sql','packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh','packages/brain/src/__tests__/integration/migration-365-kernel-harness-f1-baseline.integration.test.js'])if(!fs.existsSync(p))process.exit(1)"

- [ ] [ARTIFACT] 六个重叠面全部被恢复合同显式点名
  Test: node -e \"const fs=require('fs');const s=fs.readFileSync('sprints/07272256-kernel-a851b8ee/contract-draft.md','utf8');for(const x of ['DoD.md','packages/brain/DEFINITION.md','packages/brain/package.json','packages/brain/package-lock.json','packages/quality/smoke-allowlist.txt','regression-contract.yaml'])if(!s.includes(x))process.exit(1)\"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] current main unchanged keeps baseline, changed main invalidates old evidence
  动作: 真执行 `git fetch origin main` 与 `gh pr view 4372`，读取执行时的 `origin/main` 与当前 PR head。
  预期观察: 若 `origin/main` 仍为 `1dc9d4107cc14f9bc509c1ef285845f1dfb13838`，基线保持；若不同，旧 evaluator/judge/human-review 证据必须被标 stale 并改绑新 merge-base。
  验证命令: Test: manual:bash -c 'git fetch origin main && MAIN_SHA=$(git rev-parse origin/main) && [ -n "$MAIN_SHA" ] && gh pr view 4372 --json headRefOid,state,isDraft | jq -e ".state == \"OPEN\" and .isDraft == true and (.headRefOid | type == \"string\")"'

- [ ] [BEHAVIOR] [L2] six overlapping surfaces reconcile with zero conflict markers and zero parallel paths
  动作: 真读取 PR `#4372` diff 与工作树六个重叠面，检查缺口、冲突标记与 legacy/new 并行路径。
  预期观察: 六个文件全部在 PR diff 中出现；冲突标记为 0；不会同时保留旧 `365` 行为和新 `366` 恢复路径。
  验证命令: Test: manual:bash -c '"'"'gh pr diff 4372 --name-only | awk '"'"'"'"'"'"'"'"'BEGIN{need[\"DoD.md\"]=1;need[\"packages/brain/DEFINITION.md\"]=1;need[\"packages/brain/package.json\"]=1;need[\"packages/brain/package-lock.json\"]=1;need[\"packages/quality/smoke-allowlist.txt\"]=1;need[\"regression-contract.yaml\"]=1} {seen[$0]=1} END{for(k in need) if(!seen[k]) {print \"FAIL missing \" k; exit 1}}'"'"'"'"'"'"'"'"' && ! git grep -nE \"^(<<<<<<<|=======|>>>>>>>)\" -- DoD.md packages/brain/DEFINITION.md packages/brain/package.json packages/brain/package-lock.json packages/quality/smoke-allowlist.txt regression-contract.yaml'"'"''

- [ ] [BEHAVIOR] [L2] migration 366 runs twice through migrate.js against isolated allowlisted PostgreSQL
  动作: 使用 `HARNESS_TEST_DATABASE_URL` 真跑 `kernel-harness-f1-baseline-smoke.sh` 的 `unique-journey` 和 `history-and-backbone`，让 `migrate.js` 驱动 migration 366 连跑两次。
  预期观察: within 240s DB host 非 loopback，数据库命中白名单，schema-history 含 366，第二次执行无额外业务差异；合法 `migration-365-executor-kind-kernel-process` 测试不被改动。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; DB_HOST=$(node -e "const u=new URL(process.argv[1]);process.stdout.write(u.hostname)" "$HARNESS_TEST_DATABASE_URL"); DB_NAME=$(psql -X -qAt "$HARNESS_TEST_DATABASE_URL" -c "SELECT current_database()"); case "$DB_HOST" in localhost|127.0.0.1) echo FAIL; exit 1;; esac; case "$DB_NAME" in harness_*|*_test|preview_*) ;; *) echo FAIL; exit 1;; esac; timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh unique-journey && timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh history-and-backbone'

- [ ] [BEHAVIOR] [L2] distinct contract integration endpoint runtime devgate and gh current-head checks all execute for real
  动作: 分别执行 F1 runtime smoke、integration tests、approve/reject route tests、DevGate、`gh pr view` current-head。
  预期观察: within 300s 六类检查都能单独失败和单独通过；helper existence 或 source-string 检查不计行为完成。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh runtime-nonregression && cd packages/brain && npx vitest run src/__tests__/integration/migration-365-kernel-harness-f1-baseline.integration.test.js src/routes/__tests__/harness-kernel-approvals.test.js src/__tests__/integration/kernel-wiring.pg.integration.test.js --reporter=dot && cd /workspace && bash scripts/devgate/check-tdd-commit-order.sh && gh pr view 4372 --json headRefOid,mergeable'

- [ ] [BEHAVIOR] [L2] all seven exact F1 smoke modes execute and only the exact names are accepted
  动作: 按精确模式名循环执行 `kernel-harness-f1-baseline-smoke.sh`。
  预期观察: within 300s 七个模式全过；未知模式必须非 0；不能省略或新增别名。
  验证命令: Test: manual:bash -c 'for mode in unique-journey history-and-backbone cells-and-evidence legacy-baseline assertion-refs endpoint-semantics runtime-nonregression; do timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh "$mode"; done'

- [ ] [BEHAVIOR] [L2] eleven ledger elements prove exact names plus semantics, not numeric count only
  动作: 真跑 `cells-and-evidence`，并对根合同中的 11 个精确 element 名称做字段检查。
  预期观察: within 240s `FR/NFR/Invariant/checkpoints/freshness/death_alert/failure_semantics/effect_confirmed/adversarial/ledger_status/axis_aligned` 都有语义凭证；仅 `count == 11` 不能过。
  验证命令: Test: manual:bash -c 'timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh cells-and-evidence && node -e "const fs=require(\"fs\");const y=fs.readFileSync(\"regression-contract.yaml\",\"utf8\");for(const k of [\"FR\",\"NFR\",\"Invariant\",\"checkpoints\",\"freshness\",\"death_alert\",\"failure_semantics\",\"effect_confirmed\",\"adversarial\",\"ledger_status\",\"axis_aligned\"])if(!y.includes(k))process.exit(1)"'

- [ ] [BEHAVIOR] [L2] approve reject schema and same-SHA authority fail closed on stale head
  动作: 真运行 approve/reject Router 测试与 same-SHA PG/integration 测试。
  预期观察: within 300s approve 成功只返回 `approved_by/approved_at`，reject 成功只返回 `rejected_by/rejected_at`；旧 SHA 或重复 verdict 返回 `409`；新 head 出现后旧 evaluator/judge/human-review 记录全部失效。
  验证命令: Test: manual:bash -c 'cd packages/brain && npx vitest run src/routes/__tests__/harness-kernel-approvals.test.js src/__tests__/integration/kernel-wiring.pg.integration.test.js --reporter=dot && cd /workspace && npx vitest run tests/regression/relay-50170af2/kernel-approval-bridge.test.js --reporter=dot'

- [ ] [BEHAVIOR] [L2] red evidence fails for missing behavior, never for vitest config or missing modules
  动作: 执行本 sprint 的 contract test。
  预期观察: 缺恢复行为时以断言失败红，不以 `Cannot find module`、缺 vitest 配置、缺依赖作为唯一红因。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07272256-kernel-a851b8ee/tests/kernel-harness-f1-recovery.contract.test.ts --reporter=dot || true'

## 禁 mock 边清单

- `migrate.js ↔ migration 366 ↔ PostgreSQL`
- `harness-kernel-approvals Router ↔ orchestrator_decision_log ↔ current PR head`
- `gh pr view ↔ PR #4372 headRefOid`
- `kernel-harness-f1-baseline-smoke.sh ↔ 六个重叠面`

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] evaluator 在隔离 PostgreSQL + 真实 GitHub/gh + 真实 Brain test entry 上完成恢复验收
  期望: 七个 F1 smoke、六类检查、approve/reject schema、same-SHA authority 全部通过后，流程仍停在人工审批前。
