---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Harness 双运行时 Controller ownership 与 GP identity 收口

**范围**: `packages/brain` 内部改动 —— dispatcher `gpContractIdentity` 触发谓词（刀一）+ `harness-skill-relay.js` 四处 legacy INSERT 收敛为带 Controller ownership 的创建（刀二）。不改 kernel-v1 主派发、不改 GP 合同 UUID/SHA 校验规则本身、不新造续租守护进程。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 刀一单测文件存在且含 journey-only 触发谓词断言
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/dispatcher-gp-contract-identity.test.js','utf8');if(!c.includes('journey-only')||!c.includes('GP_CONTRACT_IDENTITY_INVALID'))process.exit(1)"

- [ ] [ARTIFACT] 刀二真 PG 集成测试文件存在且已登记进 vitest POSTGRES_INTEGRATION_TESTS
  Test: node -e "const fs=require('fs');const t=fs.readFileSync('packages/brain/src/__tests__/integration/relay-ownership.pg.integration.test.js','utf8');const cfg=fs.readFileSync('packages/brain/vitest.config.js','utf8');if(!t.includes('controller_session_id')||!t.includes('reconcileOwnerlessKernelRuns'))process.exit(1);if(!cfg.includes('relay-ownership.pg.integration.test.js'))process.exit(1)"

## Invariant 覆盖（历史约束三源①：铁律逐条映射）

- INV-1: 终态权归一 — 由 B-03/B-04（v2 relay run 落库即带非空 ownership，真 PG）+ B-05（有主 run 活过巡检不被误杀）+ B-06（无主 run 仍被回收，回收能力未削弱）真 PG 双向覆盖。故意不写成"列存在"式独立断言（migration 413 已落库，列存在会 pre-fix 假绿）——真正的不变量是"relay 建出的 run 带 ownership 且 reconcile 尊重之"，由上述 BEHAVIOR 真验。E2E 脚本第 2 步的列存在检查仅作前置守卫，非本不变量的 oracle。
- INV-2: local_api 验证方式已在合同 `## E2E 验收` 显式声明（纯函数单测 + 真 PG integration + psql 列断言，无 UI smoke，规避 judge 机械闸⑤ meta_verification_gap 死锁）—— 声明式，无独立运行断言，N/A 可执行条目。
- INV-3: N/A — 本 sprint 不产出 `.harness/progress.md`，git add 白名单仅含 dispatcher.js / harness-skill-relay.js / kernel-run-store.js 与测试文件，台账不入库。
- INV-4: exit 语义防假绿已内建于每条 [BEHAVIOR] Test（`grep -E "Tests .* [0-9]+ passed"` 确认真运行 + `! grep failed` 双闸，捕获 vitest include 范围外 0-match 绿态），非独立条目。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: journey-only generator-fix 组包不抛 GP_CONTRACT_IDENTITY_INVALID（刀一）
  动作: 以 journey-only payload（含 journey_id、无版本化 GP 身份字段）经 dispatcher `__test__.buildInputs` 组 `spawn:generator-fix` bundle
  预期观察: buildInputs 正常返回、不抛 GP_CONTRACT_IDENTITY_INVALID / TASK_BUNDLE_ASSEMBLY_FAILED，bundle 无 gp_contract
  等待预算: 0s
  留证: vitest 输出末 5 行（journey-only 用例 ✓）
  Test: manual:bash -c 'cd packages/brain && OUT=$(NODE_ENV=test npx vitest run src/__tests__/dispatcher-gp-contract-identity.test.js -t "journey-only" --reporter=dot 2>&1); echo "$OUT" | tail -5; echo "$OUT" | grep -qE "Tests .* [0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests .* [0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-02: 部分 GP 身份仍 fail-closed 抛错，完整版本化 GP 身份继续透传 frozen contract（刀一边界）
  动作: 分别以「部分 GP 身份（gp_contract_id 缺 version/hash）」与「完整版本化 GP 身份」payload 组包
  预期观察: 部分身份抛 GP_CONTRACT_IDENTITY_INVALID；完整身份返回含 journey_id + 数值 version 的 frozen gp_contract
  等待预算: 0s
  留证: vitest 输出（两用例 ✓）
  Test: manual:bash -c 'cd packages/brain && OUT=$(NODE_ENV=test npx vitest run src/__tests__/dispatcher-gp-contract-identity.test.js -t "GP 身份" --reporter=dot 2>&1); echo "$OUT" | tail -6; echo "$OUT" | grep -qE "Tests .* [0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests .* [0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-03: legacy relay 四分支建 run 落库即带非空 controller_session_id + 未来 lease（刀二核心）
  动作: 真 PG 驱动 spawnSkillRelaySession 的 session/grok fallback/xian/headed 分支建 run（只替身最外层 spawn/worktree/skill/token 依赖，pool 为真 testPool）
  预期观察: 每分支建出的 v2 run 行 controller_session_id 非空、controller_lease_expires_at 非空且在未来
  等待预算: 0s
  留证: 集成测试 verbose 输出（各分支 ✓）
  Test: manual:bash -c 'cd packages/brain && OUT=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/relay-ownership.pg.integration.test.js --reporter=verbose 2>&1); echo "$OUT" | tail -15; echo "$OUT" | grep -qE "Tests .* [0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests .* [0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-04: 真 PG 查 relay run，controller ownership 两列均非空（psql 直断言，防 ORM 假绿）
  动作: 集成测试建 run 后，直接对隔离库该 run 行查 controller_session_id / controller_lease_expires_at
  预期观察: 两列均非空（集成用例内以真 PG SELECT 断言，非 mock pool）
  等待预算: 0s
  留证: 集成用例①「落库即带非空 controller_session_id + 未来 lease」通过
  Test: manual:bash -c 'cd packages/brain && OUT=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/relay-ownership.pg.integration.test.js -t "落库即带非空" --reporter=verbose 2>&1); echo "$OUT" | tail -8; echo "$OUT" | grep -qE "Tests .* [0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests .* [0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-05: 带有效 lease 的活 relay run 活过一个巡检周期（>5min）后仍非终态，未被 no_controller_ownership 误杀 [接缝×2]
  动作: 建 run 后以 now 推进 6min（>5min 巡检周期，但默认 lease 1800s 仍有效）真调 reconcileOwnerlessKernelRuns
  预期观察: 该 run 不在 recovered 列表，phase 仍 ∉ {done,failed}（活过巡检周期）
  等待预算: 0s（reconcile 同步返回，无异步等待）
  留证: 集成用例②「活过一个巡检周期」通过 + recovered 列表不含该 taskId
  Test: manual:bash -c 'cd packages/brain && OUT=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/relay-ownership.pg.integration.test.js -t "活过一个巡检周期" --reporter=verbose 2>&1); echo "$OUT" | tail -8; echo "$OUT" | grep -qE "Tests .* [0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests .* [0-9]+ failed"'

- [ ] [BEHAVIOR] [L2] B-06: 对照 — 无 ownership 的 v2 active run 经 reconcile 仍被终态化 failed（回收能力未削弱）[接缝×2]
  动作: 真 PG 直插一条无 controller ownership 的 v2 active run，真调 reconcileOwnerlessKernelRuns
  预期观察: 该 run 被 finalize failed，cause = no_controller_ownership（回收能力不因本单改动放跑真无主 run）
  等待预算: 0s
  留证: 集成用例③「无 ownership 的 v2 active run 经 reconcile 仍被终态化」通过 + phase=failed
  Test: manual:bash -c 'cd packages/brain && OUT=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/relay-ownership.pg.integration.test.js -t "对照" --reporter=verbose 2>&1); echo "$OUT" | tail -8; echo "$OUT" | grep -qE "Tests .* [0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests .* [0-9]+ failed"'
