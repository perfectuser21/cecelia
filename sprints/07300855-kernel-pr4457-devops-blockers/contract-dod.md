---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Draft PR #4457 四个 DevOps blocker 等价修复

**范围**: 四个 blocker、Red/Green、evaluator 内 exact-head required checks，以及 evaluator 之后的同-head judge/人工批准 controller gate。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] 四 blocker 聚焦回归真实执行通过，且生产 migration SQL 相对冻结基线零 diff
  Test: bash -c 'set -euo pipefail; npm test --workspace packages/engine -- --run tests/scripts/quickcheck-vitest-exit-classification.test.ts --reporter=verbose; npm exec --workspace packages/brain -- vitest run src/__tests__/native-node-test-runner-registration.test.js --reporter=verbose; npm run test:node --workspace packages/brain; TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://localhost/cecelia_test}" npm exec --workspace packages/brain -- vitest run src/__tests__/integration/okr-decomposition-flow.integration.test.js src/__tests__/integration/kernel-release-runs.integration.test.js --config vitest.integration.config.js --reporter=verbose; git diff --exit-code c0cd82fe298a8d1df812699507709d564a296f4e -- packages/brain/migrations/'

- [ ] [ARTIFACT] node:test 登记 ratchet 真执行，证明 mutation seam 被 Vitest 排除并已登记在 test:node，随后原生 runner 真执行 seam
  Test: bash -c 'set -euo pipefail; npm exec --workspace packages/brain -- vitest run src/__tests__/native-node-test-runner-registration.test.js --reporter=verbose; npm run test:node --workspace packages/brain'

- [ ] [ARTIFACT] 冻结 sprint-prd.md 与现有 PR 分支字节等同
  Test: git diff --exit-code cp-kernel-phase5b-a1-review-fixes -- sprints/07300855-kernel-pr4457-devops-blockers/sprint-prd.md

- [ ] [ARTIFACT] post-judge controller 使用真实账本 oracle 验证 exact-head evaluator/judge、阶段顺序与受认证批准回执
  Stage: post-judge-controller（不属于 evaluator E2E；judge PASS 后、review request/approval 相应阶段执行）
  Test: bash -c 'set -euo pipefail; H=$(gh pr view 4457 --repo perfectuser21/cecelia --json headRefOid --jq .headRefOid); psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -v h="$H" -Atc "WITH e AS (SELECT hop,detail FROM orchestrator_decision_log WHERE run_id='\"'\"'2ef32848-e3df-473b-ad4e-548216a33092'\"'\"' AND action='\"'\"'verdict:evaluate'\"'\"' ORDER BY hop DESC LIMIT 1), j AS (SELECT hop,detail FROM orchestrator_decision_log WHERE run_id='\"'\"'2ef32848-e3df-473b-ad4e-548216a33092'\"'\"' AND action='\"'\"'verdict:judge'\"'\"' ORDER BY hop DESC LIMIT 1), r AS (SELECT hop,observed FROM orchestrator_decision_log WHERE run_id='\"'\"'2ef32848-e3df-473b-ad4e-548216a33092'\"'\"' AND action='\"'\"'effect:human_review_requested'\"'\"' ORDER BY hop DESC LIMIT 1), a AS (SELECT hop,observed,gate_verdict,detail FROM orchestrator_decision_log WHERE run_id='\"'\"'2ef32848-e3df-473b-ad4e-548216a33092'\"'\"' AND action='\"'\"'verdict:human_review'\"'\"' ORDER BY hop DESC LIMIT 1) SELECT 1 FROM e,j,r,a WHERE e.detail->>'\"'\"'verdict'\"'\"'='\"'\"'PASS'\"'\"' AND j.detail->>'\"'\"'verdict'\"'\"'='\"'\"'PASS'\"'\"' AND e.detail->>'\"'\"'pr_head_sha'\"'\"'=:'\"'\"'h'\"'\"' AND j.detail->>'\"'\"'pr_head_sha'\"'\"'=:'\"'\"'h'\"'\"' AND e.hop<j.hop AND j.hop<r.hop AND r.hop<a.hop AND a.gate_verdict='\"'\"'allow'\"'\"' AND a.detail->>'\"'\"'approved'\"'\"'='\"'\"'true'\"'\"' AND a.detail->>'\"'\"'review_class'\"'\"'='\"'\"'merge_gate'\"'\"' AND a.detail->>'\"'\"'pr_head_sha'\"'\"'=:'\"'\"'h'\"'\"' AND a.detail->>'\"'\"'review_request_hop'\"'\"'=r.hop::text AND a.observed->'\"'\"'post_diff_risk'\"'\"'=r.observed->'\"'\"'post_diff_risk'\"'\"' AND a.observed->'\"'\"'post_diff_risk'\"'\"'->'\"'\"'bindings'\"'\"'->>'\"'\"'task_id'\"'\"'='\"'\"'0138c756-65e1-44c6-a2ae-51a0ee47f7d4'\"'\"' AND a.observed->'\"'\"'post_diff_risk'\"'\"'->'\"'\"'bindings'\"'\"'->>'\"'\"'run_id'\"'\"'='\"'\"'2ef32848-e3df-473b-ad4e-548216a33092'\"'\"'" | grep -qx 1'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: QuickCheck 未知非零 fail-closed，genuine OOM 仅三条件降级 [接缝×2]
  动作: 真实启动 QuickCheck/Vitest fixture，依次制造大输出失败、ANSI 失败、未知非零及 OOM worker 输出
  预期观察: 前三类返回非零；只有 OOM/worker 签名、pass summary、无 fail summary同时满足时返回零
  等待预算: 120s
  留证: 聚焦 Vitest 命令输出与各 fixture exit code
  Test: manual:bash -c 'npm test --workspace packages/engine -- --run tests/scripts/quickcheck-vitest-exit-classification.test.ts --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: mutation seam 由 node:test 真执行且 Vitest 不收集
  动作: 执行登记 ratchet，再执行 packages/brain 的 test:node
  预期观察: ratchet 确认 exclude 与 test:node 双登记，原生 runner 实际运行 seam 并通过
  等待预算: 180s
  留证: node --test TAP 输出与 test:node 输出
  Test: manual:bash -c 'npm exec --workspace packages/brain -- vitest run src/__tests__/native-node-test-runner-registration.test.js --reporter=verbose && npm run test:node --workspace packages/brain'

- [ ] [BEHAVIOR] [L2] B-03: OKR integration 通过进程内真实 Router 绑定 cecelia_test [接缝×2]
  动作: 以 TEST_DATABASE_URL=cecelia_test 运行 OKR integration
  预期观察: Supertest 请求真实 router，真实测试库完成层级创建/查询/清理；不访问外部 Brain
  等待预算: 180s
  留证: Vitest 输出与测试 DB preflight 输出
  Test: manual:bash -c 'TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://localhost/cecelia_test}" npm exec --workspace packages/brain -- vitest run src/__tests__/integration/okr-decomposition-flow.integration.test.js --config vitest.integration.config.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: historical migration fixture 精确执行 369–381且生产 SQL 零改动 [接缝×2]
  动作: 在随机 PostgreSQL schema 真跑 kernel release migration integration，并比较 migration 目录
  预期观察: canonical runner 返回 369..381 且不含382；382专属验证通过；生产 migration SQL 无 diff
  等待预算: 240s
  留证: Vitest migration 应用集合输出与 git diff exit code
  Test: manual:bash -c 'TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://localhost/cecelia_test}" npm exec --workspace packages/brain -- vitest run src/__tests__/integration/kernel-release-runs.integration.test.js --config vitest.integration.config.js --reporter=verbose && git diff --exit-code c0cd82fe298a8d1df812699507709d564a296f4e -- packages/brain/migrations/'

- [ ] [BEHAVIOR] [L2] B-05: atomic check 诚实保持 fail-closed 0/99
  动作: 运行 checked-in report check，并主动运行 manual cutover gate
  预期观察: schema_valid=true、proof_complete=false、atomic_cutover_ready=false、live proof 0/99；manual gate 非零
  等待预算: 60s
  留证: 两个命令的 JSON 与 exit code
  Test: manual:bash -c 'R=$(node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report --format=json); echo "$R" | jq -e ".schema_valid==true and .proof_complete==false and .atomic_cutover_ready==false and (.cell_atomic_coverage|length)==99 and ([.cell_atomic_coverage[]|select((.live_proven_invariant_ids|length)>0 or (.live_proven_probe_ids|length)>0)]|length)==0"; if node scripts/ci/run-kernel-equivalence-drill.mjs --gate --format=json; then exit 1; fi'

- [ ] [BEHAVIOR] [L2] B-06: exact final head 的 GitHub required checks 全部成功 [接缝×2]
  动作: 查询 PR #4457 身份与 required checks 权威集合，并对照 evaluator checkout SHA
  预期观察: PR保持OPEN Draft且无auto-merge，checkout SHA与PR head一致；required 集合非空且每项 state=SUCCESS
  等待预算: 30s
  留证: gh pr view 与 gh pr checks JSON、checkout SHA 对账输出
  Test: manual:bash -c 'P=$(gh pr view 4457 --repo perfectuser21/cecelia --json number,isDraft,headRefName,headRefOid,autoMergeRequest,state); C=$(gh pr checks 4457 --repo perfectuser21/cecelia --required --json name,state,bucket); H=$(git rev-parse HEAD); echo "$P" | jq -e ".number==4457 and .isDraft==true and .headRefName==\"cp-kernel-phase5b-a1-review-fixes\" and .headRefOid==\"$H\" and .autoMergeRequest==null and .state==\"OPEN\"" && echo "$C" | jq -e "length>0 and all(.[]; .state==\"SUCCESS\")"'

## Invariant 映射（PRD 全量铁律逐条处理）

- INV-01 N/A：不涉及 agents 表字段。
- INV-02 N/A：不新增 status 枚举。
- INV-03 N/A：不涉及 watchdog orphan recovery。
- INV-04 N/A：不涉及通知接口。
- INV-05 N/A：不涉及依赖 advisory。
- INV-06 N/A：不涉及 headed heartbeat。
- INV-07 N/A：不做测试毕业 rename。
- INV-08 覆盖：B-01/B-06记录真实 exit code 与实际 runner/head。
- INV-09 N/A：无 manual:node -e `${}` 命令。
- INV-10 N/A：通用 smoke 铁律，本单无 smoke 行为变更。
- INV-11 N/A：重复 smoke 铁律。
- INV-12 N/A：不涉及多轮扫描 sentinel。
- INV-13 N/A：不涉及周期重扫或第三方付费调用。
- INV-14 N/A：不涉及跨模块时间常数。
- INV-15 N/A：不涉及 Android/theater routing。
- INV-16 覆盖：target_environment 明确为 local_api。
- INV-17 覆盖：B-06先锚定 evaluator checkout 与 PR head；下游 judge 只能消费该同一 head evidence。
- INV-18 N/A：不写不受控 varchar 来源数据。
- INV-19 N/A：不复活退役功能。
- INV-20 N/A：不调用 null/false 契约函数。
- INV-21 N/A：重复 smoke 铁律。
- INV-22 N/A：不改 journey_features。
- INV-23 N/A：不改 controller report 生命周期。
- INV-24 N/A：不写 host 白名单。
- INV-25 覆盖：B-06锁定既有 PR、branch、head。
- INV-26 N/A：不做模块退役。
- INV-27 N/A：不新增后台 job。
- INV-28 N/A：不新增/复用表。
- INV-29 N/A：不新增后台 job。
- INV-30 N/A：不新增重叠字段或多设备 UI。
- INV-31 覆盖：B-05在检查端与 gate 端统一 false 语义。
- INV-32 N/A：不解析 git ref。
- INV-33 N/A：不运行部署脚本。
- INV-34 覆盖：B-01未知失败禁止 warning 降级。
- INV-35 N/A：不做部署判变。
- INV-36 N/A：合同测试不受 lint-test-quality await 规则支配；生产测试沿用现有风格。
- INV-37 覆盖：Test Contract 固定四列且 test file 使用反引号。
- INV-38 覆盖：generator 阶段须精确 add Red 测试文件，本合同不授权 `git add .`。
- INV-39 N/A：本单接缝必须真跑，不能以源码 inspection 代替。
- INV-40 N/A：不新增 cron。
- INV-41 覆盖：B-06只读核对 PR；generator/evaluator 不 merge，merge 权归 controller且需批准。
- INV-42 N/A：不使用 headed shell 上下文变量。
- INV-43 覆盖：B-06以本任务真实 PR #4457/head 为准。
- INV-44 N/A：不改共享 CI workflow/allowlist，除非既有 Draft PR 的明确 blocker 文件。
- INV-45 覆盖：B-06核对当前 evaluator SHA；judge 阶段必须复用同一 SHA，提前合并视为 FAIL。
- INV-46 N/A：重复 smoke 铁律。
- INV-47 N/A：不新增 brain/src 功能或 A2 port。
- INV-48 N/A：不新增 task_type。
- INV-49 N/A：不新增宿主服务。
- INV-50 N/A：不新增 LaunchAgent。
- INV-51 N/A：不新增常驻服务。
- INV-52 N/A：重复 smoke 铁律。
- INV-53 覆盖：单 Sprint 单 ws1 串行完成。
- INV-54 N/A：不写真机环境假设值。
- INV-55 覆盖：接缝清单中的 QuickCheck、真 PG、GitHub head 均在真实目标验证。
- INV-56 N/A：本单 fixture 不涉及租户数据。
- INV-57 覆盖：TEST_DATABASE_URL/凭据只由环境注入，不入库不入日志。
- INV-58 N/A：无客户隐私/PII数据。
- INV-59 N/A：不新增 API endpoint。
- INV-60 N/A：不读写租户数据。

## BEHAVIOR:E2E 条目

N/A — journey_type=autonomous，Mode B 脚本位于 contract-draft.md 的 `## E2E 验收`。
