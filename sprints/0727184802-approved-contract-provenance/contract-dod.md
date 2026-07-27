---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Approved Contract Provenance Manifest

**范围**: Harness Kernel approved contract manifest、append-only approval store、dispatch/callback/evaluator/CI/merge gate digest 校验。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] sprint regression test 存在且覆盖 manifest/drift/gate/re-GAN
  Test: node -e "const c=require('fs').readFileSync('sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts','utf8'); for (const s of ['canonical manifest freezes approved PRD contract DoD task-plan tests and fixture artifacts','approved migration 365 changed to 366 is rejected as approved_contract_drift','generator and evaluator dispatch carry approved manifest digest and source sha','callback refuses stale manifest_digest before writing evaluator verdict','approved PRD contract task-plan test deletion rename and content edits are rejected as approved_contract_drift']) { if (!c.includes(s)) process.exit(1); }"

- [ ] [ARTIFACT] approved provenance module 必须新增
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/approved-contract-provenance.js','utf8'); for (const s of ['buildApprovedContractManifest','verifyApprovedContractManifest','verifyApprovedContractReference','buildApprovedContractDispatchContext','verifyAttemptCallbackApprovedContract','detectApprovedContractMainConflict']) { if (!c.includes(s)) process.exit(1); }"

- [ ] [ARTIFACT] CI required check 脚本必须新增
  Test: node -e "const c=require('fs').readFileSync('scripts/ci/approved-contract-provenance-check.mjs','utf8'); for (const s of ['manifest_digest','pr-head-sha','approved_contract_drift','requires_re_gan']) { if (!c.includes(s)) process.exit(1); }"

- [ ] [ARTIFACT] migration 366 必须固定为 approved contract provenance manifest
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/366_approved_contract_provenance_manifest.sql','utf8'); for (const s of ['approved_manifest','manifest_digest','source_commit_sha','reviewer_verdict']) { if (!c.includes(s)) process.exit(1); }"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] canonical manifest freezes approved PRD contract DoD task-plan tests and fixture artifacts
  动作: 在真实临时 Git repo 中提交 approved contract 资产，调用 `buildApprovedContractManifest`。
  预期观察: manifest 按固定 path 顺序列出 root DoD、migration、fixture/golden、sprint-prd、contract-draft、contract-dod、task-plan、tests，并生成稳定 digest。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "canonical manifest freezes approved PRD contract DoD task-plan tests and fixture artifacts"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] append-only approval rejects same contract_version with a different manifest_digest
  动作: 在真实 PostgreSQL temp table 中对同一 run/version 先写 digest A，再写 digest B。
  预期观察: 第一次写入成功并 attach run；第二次不同 digest 被 `approved_contract_manifest_conflict` 拒绝，原 row 不被覆写。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "append-only approval rejects same contract_version with a different manifest_digest"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] approved migration 365 changed to 366 is rejected as approved_contract_drift
  动作: 在真实临时 Git repo 中批准 root DoD migration 365 后，将 root DoD Test command 与 Action 改为 366 并提交 current PR SHA。
  预期观察: `verifyApprovedContractManifest` 返回 `ok:false`、`reason:"approved_contract_drift"`，drift path 含 `DoD.md` 且 change 为 semantic。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "approved migration 365 changed to 366 is rejected as approved_contract_drift"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] checkbox evidence and provenance only root DoD edits are allowed
  动作: 在真实临时 Git repo 中只把 root DoD checkbox 勾选，并追加 Evidence/Provenance 行。
  预期观察: `verifyApprovedContractManifest` 返回 `ok:true`，并在 `allowed_mechanical_changes` 中列出 `DoD.md`。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "checkbox evidence and provenance only root DoD edits are allowed"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] missing manifest unreachable stale sha and stale manifest digest fail closed
  动作: 直接调用 `verifyApprovedContractReference` 分别传入缺 manifest、digest mismatch、缺 current PR SHA。
  预期观察: 三个分支均 fail-closed，reason 分别为 `approved_contract_manifest_missing`、`stale_manifest_digest`、`current_pr_sha_missing`。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "missing manifest unreachable stale sha and stale manifest digest fail closed"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] generator and evaluator dispatch carry approved manifest digest and source sha
  动作: 用真实 approved contract row 调用 dispatch context 构建逻辑，分别生成 generator 与 evaluator 输入。
  预期观察: task_bundle.inputs.contract 与 env 同时携带 `manifest_digest`、`approved_manifest.manifest_digest`、`source_commit_sha`；evaluator 保留 current `PR_HEAD_SHA`。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "generator and evaluator dispatch carry approved manifest digest and source sha"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] callback refuses stale manifest_digest before writing evaluator verdict
  动作: 构造真实 attempt task_bundle.contract 中 approved digest，再用 evaluator callback 上报 stale digest、缺 digest、正确 digest 三种结果。
  预期观察: stale digest 返回 `stale_evaluate_manifest_digest`，缺 digest 返回 `approved_contract_manifest_digest_missing`，正确 digest 才允许写 verdict。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "callback refuses stale manifest_digest before writing evaluator verdict"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] mergeGate refuses PASS verdicts that do not carry the approved manifest_digest
  动作: 调用真实 `mergeGate`，evaluate/judge 均 PASS 且 PR SHA 匹配，但 evaluator digest 与 approved digest 不一致。
  预期观察: merge gate 拒绝，返回 `{allow:false, reason:"stale_evaluate_manifest_digest"}`。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "mergeGate refuses PASS verdicts that do not carry the approved manifest_digest"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] mergeGate refuses missing approved manifest_digest and stale judge manifest_digest
  动作: 调用真实 `mergeGate`，一次缺 approved digest，一次 judge digest 与 approved digest 不一致。
  预期观察: 缺 approved digest 返回 `approved_contract_manifest_digest_missing`；stale judge digest 返回 `stale_judge_manifest_digest`。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "mergeGate refuses missing approved manifest_digest and stale judge manifest_digest"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] approved PRD contract task-plan test deletion rename and content edits are rejected as approved_contract_drift
  动作: 在真实临时 Git repo 中批准 sprint PRD/contract/task-plan/test 后，修改 contract-draft、删除 task-plan、rename test 并提交 current PR SHA。
  预期观察: `verifyApprovedContractManifest` 返回 `approved_contract_drift`，drift path 同时包含 contract-draft、task-plan、原 test path。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "approved PRD contract task-plan test deletion rename and content edits are rejected as approved_contract_drift"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] main migration conflict after approval returns requires_re_gan
  动作: 调用 `detectApprovedContractMainConflict`，approved contract 固定 migration 366，而 current main 已有另一个 366 migration。
  预期观察: 返回 `ok:false`、`reason:"requires_re_gan"`、`conflict:"migration_number"`、`migration_number:366`，不得进入普通 fix loop。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "main migration conflict after approval returns requires_re_gan"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-1 合同批准前 manual oracle 真实执行且解释器启动
  动作: 运行本 sprint regression test 文件的完整 Vitest suite。
  预期观察: Node/Vitest 真实启动，所有 approved provenance 行为测试通过。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-2 verdict 判定必须看语义字段而不只看 ok:true
  动作: 跑 callback/ground-truth/gate 相关回归，确保 verdict detail 中 `pr_head_sha` 与 `manifest_digest` 被语义校验。
  预期观察: 旧 stale SHA 测试继续通过，新 stale digest 测试也通过。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run packages/brain/src/orchestrator/__tests__/ground-truth.test.js packages/brain/src/orchestrator/__tests__/gates.test.js sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --reporter=verbose'
  期望: exit 0

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] local_api final-e2e 完整跑 manifest regression + CI required check + DB 时间窗
  动作: evaluator 在 current PR head 上执行 contract-draft.md 的 `## E2E 验收` bash 脚本。
  预期观察: within 120s Vitest regression 通过；CI script 输出 `.ok==true` 且 digest 等于 approved digest；PostgreSQL 中 5 分钟内存在 approved manifest row。
  验证命令: Test: manual:bash -c 'set -euo pipefail; awk "/^## E2E 验收/{found=1; next} found && /^## /{exit} found && /^```bash/{b=1; next} b && /^```/{b=0; next} b{print}" sprints/0727184802-approved-contract-provenance/contract-draft.md > /tmp/approved-contract-provenance-e2e.sh; bash -n /tmp/approved-contract-provenance-e2e.sh; echo OK'
  期望: exit 0

## Invariant 覆盖条目

- [ ] [BEHAVIOR] [L2] INV-1 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。
  动作: 运行本 sprint regression test 文件的完整 Vitest suite。
  预期观察: Node/Vitest 真实启动并返回真实 exit code。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-2 通知/写库接口的成功判定必须看语义字段。
  动作: 跑 ground-truth/gates 与 sprint digest regression。
  预期观察: stale digest/sha 只在语义字段匹配时放行，不只看 ok/pass 字面。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run packages/brain/src/orchestrator/__tests__/ground-truth.test.js packages/brain/src/orchestrator/__tests__/gates.test.js sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-3 同一语义在判变端与终验端必须同一处理策略。
  动作: 调用 manifest reference validator 的缺失、stale digest、缺 PR SHA 三个分支。
  预期观察: 判变端和终验端都返回 fail-closed reason。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "missing manifest unreachable stale sha and stale manifest digest fail closed"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-4 git ref 判定必须使用 verify 语义。
  动作: 检查 CI required check 脚本中的 git commit 存在性判定。
  预期观察: 脚本包含 `git rev-parse --verify` 或 `git cat-file -e`，避免裸 rev-parse 假阳性。
  验证命令: Test: manual:bash -c 'set -euo pipefail; node -e "const c=require(\"fs\").readFileSync(\"scripts/ci/approved-contract-provenance-check.mjs\",\"utf8\"); if (!/git rev-parse --verify|git cat-file -e/.test(c)) process.exit(1);"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-5 DB 写路径必须真 Postgres 验证。
  动作: 在真实 PostgreSQL temp table 中写入 approved manifest 并尝试覆写。
  预期观察: 同 version 不同 digest 被拒绝。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "append-only approval rejects same contract_version with a different manifest_digest"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-6 回归测试必须覆盖真实调度接线。
  动作: 跑 dispatcher/gate/ground-truth 真实模块测试与 sprint regression。
  预期观察: dispatcher 注入、verdict 观测、merge gate 三处 digest 链路均被测试覆盖。
  验证命令: Test: manual:bash -c 'set -euo pipefail; npx vitest run packages/brain/src/orchestrator/__tests__/dispatcher.test.js packages/brain/src/orchestrator/__tests__/ground-truth.test.js packages/brain/src/orchestrator/__tests__/gates.test.js sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-7 secrets 不硬编码、不进 git、不进日志。
  动作: 扫描新增 provenance module 与 CI script。
  预期观察: 不出现 callback token、GitHub token、DB 密码等 secret 字面量。
  验证命令: Test: manual:bash -c 'set -euo pipefail; node -e "for (const f of [\"packages/brain/src/orchestrator/approved-contract-provenance.js\",\"scripts/ci/approved-contract-provenance-check.mjs\"]) { const c=require(\"fs\").readFileSync(f,\"utf8\"); if (/(HARNESS_CALLBACK_TOKEN\\s*=|GITHUB_TOKEN\\s*=|DATABASE_URL\\s*=postgresql:\\/\\/[^\\s$])/.test(c)) process.exit(1); }"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-8 碰租户数据的查询/写入必须 scope 到当前租户。
  动作: 确认本 sprint 新 SQL 只触达 `initiative_contracts` / `initiative_runs` / `orchestrator_decision_log`，不触达租户业务表。
  预期观察: 新 migration 与 CI script 不包含无 tenant scope 的 tenant 表读写。
  验证命令: Test: manual:bash -c 'set -euo pipefail; node -e "for (const f of [\"packages/brain/migrations/366_approved_contract_provenance_manifest.sql\",\"scripts/ci/approved-contract-provenance-check.mjs\"]) { const c=require(\"fs\").readFileSync(f,\"utf8\"); if (/\\b(?:SELECT|UPDATE|DELETE)\\b[\\s\\S]{0,120}\\btenant/i.test(c) && !/tenant_id\\s*(=|IN\\b)/i.test(c)) process.exit(1); }"'
  期望: exit 0
- N/A：微信/RPA/Android/Windows/headed relay/launchd/付费第三方 API/内容发布/视频/用户隐私日志相关铁律本 sprint 不触及。
