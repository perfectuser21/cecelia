---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 修复 Journey-only 锚触发 GP Contract 身份误判

**范围**: `packages/brain/src/orchestrator/dispatcher.js` 的 `gpContractIdentity` 判定（分离 GP 字段与 journey_id）+ journey-only 时 `journey_id` 保留进 `buildInputs` common bundle；永久回归测试落 CI include 路径。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 永久回归测试落在 vitest CI include 路径（invariant [test-include]：sprints/** 不被扫描，必须在 packages/brain/src/**）
  Test: node -e "require('fs').accessSync('packages/brain/src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js')"
  期望: exit 0

- [ ] [ARTIFACT] 永久回归文件覆盖 journey-only / partial / complete 三态命名用例（NFR [验证独立性] 的静态载体；不约束 dispatcher 具体实现写法）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js','utf8');for(const n of ['RED-1 journey-only','RED-2 partial','RED-3 完整']){if(!c.includes(n)){console.error('缺 '+n);process.exit(1)}}"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，L2 服务端真验；Test 单行 manual:bash -c）

- [ ] [BEHAVIOR] [L2] B-01: journey-only 锚 → spawn:generator 成功组装、gp_contract 未注入、journey_id 保留进 common
  动作: 以 payload `{journey_id: 'e6f803f2-...'}`（无任何 GP 字段）经真实 `createDispatcher('spawn:generator', …)` 装配 TaskBundle（RED-1 用例）
  预期观察: `createDispatcher` 返回 `status=LAUNCHED`，`bundle.inputs.gp_contract` 为 undefined，`bundle.inputs.journey_id === 'e6f803f2-…'`（当前 RED：返回 DONE_WITH_CONCERNS、无 attempt）
  等待预算: 0s（vitest 同步阻塞，退出码即观察）
  留证: vitest -t 'RED-1 journey-only' 输出末 30 行进 log_tail
  Test: manual:bash -c 'cd packages/brain && OUT=$(npx vitest run src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js -t "RED-1 journey-only" 2>&1); echo "$OUT" | tail -30; echo "$OUT" | grep -Eq "Tests +1 passed" && ! echo "$OUT" | grep -Eq "[0-9]+ failed" || { echo "FAIL: RED-1 未通过"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-02: partial GP 字段（非 journey）→ fail-closed 抛 GP_CONTRACT_IDENTITY_INVALID
  动作: 以仅 `{gp_contract_id: <uuid>}`（缺 version/hash/golden_path_id/step_id）经 `__test__.buildInputs('spawn:generator', …)` 装配（RED-2 用例）
  预期观察: `buildInputs` throw `/GP_CONTRACT_IDENTITY_INVALID/`，不静默降级为 journey-only（invariant [fail-closed]）
  等待预算: 0s
  留证: vitest -t 'RED-2 partial' 输出末 30 行进 log_tail
  Test: manual:bash -c 'cd packages/brain && OUT=$(npx vitest run src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js -t "RED-2 partial" 2>&1); echo "$OUT" | tail -30; echo "$OUT" | grep -Eq "Tests +[12] passed" && ! echo "$OUT" | grep -Eq "[0-9]+ failed" || { echo "FAIL: RED-2 未通过"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: 完整 GP 合同 → 冻结结构化注入 gp_contract，原有回归不破（不削弱一致性校验）
  动作: 跑本刀 RED-3 用例 + 原 dispatcher 主测试「把冻结 GP Contract 身份结构化注入下游 TaskBundle」
  预期观察: `bundle.inputs.gp_contract` 深等于 `{id,version:1,hash,golden_path_id,journey_id,step_id}`；两条命名测试均 1 passed（NFR 一致性校验不削弱）
  等待预算: 0s
  留证: 两次 vitest 输出末 20 行进 log_tail
  Test: manual:bash -c 'cd packages/brain && A=$(npx vitest run src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js -t "RED-3 完整" 2>&1); B=$(npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t "把冻结 GP Contract 身份结构化注入下游 TaskBundle" 2>&1); echo "$A" | tail -20; echo "$B" | tail -20; echo "$A" | grep -Eq "Tests +1 passed" && echo "$B" | grep -Eq "Tests +1 passed" && ! echo "$A$B" | grep -Eq "[0-9]+ failed" || { echo "FAIL: RED-3 或原回归未通过"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: 边界 fail-closed — anchor.gp_id 不一致 + journey_id 非 UUID 均抛错
  动作: 跑两条边界用例（完整合同但 anchor.gp_id≠golden_path_id；journey_id 非 UUID 且无 GP 字段）
  预期观察: 两条边界用例均断言 `buildInputs` throw `/GP_CONTRACT_IDENTITY_INVALID/`（一致性校验不削弱 + 非法输入 fail-closed）
  等待预算: 0s
  留证: vitest -t '边界' 输出末 20 行进 log_tail
  Test: manual:bash -c 'cd packages/brain && OUT=$(npx vitest run src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js -t "边界" 2>&1); echo "$OUT" | tail -20; echo "$OUT" | grep -Eq "Tests +[23] passed" && ! echo "$OUT" | grep -Eq "[0-9]+ failed" || { echo "FAIL: 边界 fail-closed 未通过"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-1 [test-include]: 永久回归文件落 CI include 路径且整文件全绿（回归永久保留，非 sprints/**）
  动作: 断言 `packages/brain/src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js` 存在，并整文件跑 vitest
  预期观察: 文件存在（在被扫描路径内）；整文件 `Tests N passed`、0 failed
  等待预算: 0s
  留证: 文件路径 + 整文件 vitest 汇总行进 log_tail
  Test: manual:bash -c 'test -f packages/brain/src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js || { echo "FAIL: 回归文件不在 CI include 路径"; exit 1; }; cd packages/brain && OUT=$(npx vitest run src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js 2>&1); echo "$OUT" | tail -20; echo "$OUT" | grep -Eq "Tests +[1-9][0-9]* passed" && ! echo "$OUT" | grep -Eq "[0-9]+ failed" || { echo "FAIL: 回归文件未全绿"; exit 1; }; echo OK'

## Invariant 映射（铁律逐条）

- INV-1 [test-include] → 见上方 `[BEHAVIOR] INV-1`（新测落 packages/brain/src/** 且真跑）
- INV-2 [fail-closed] → 见上方 `B-02` / `B-04`（partial 与非法输入均抛错，不静默降级）
- INV-3 [smoke-oracle] → 本合同全部 [BEHAVIOR] 均给可机检 vitest oracle（local_api 无 UI，避免 judge meta_verification_gap）
- INV-4 [ci-noise] → N/A：Deploy Preview Environment check 跨 PR 失败是 Brain infra 既有故障、非 required，不阻断本刀判定（本刀不改 CI 配置）
