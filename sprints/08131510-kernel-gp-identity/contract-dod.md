---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 修复 Harness TaskBundle 的 GP 合同身份误判（journey-only 不触发全字段校验）

**范围**: `packages/brain/src/orchestrator/dispatcher.js` 中 `gpContractIdentity` 的触发判定 + `dispatcher.test.js` 永久回归。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] sprint 组包 oracle 探针存在且覆盖五场景
  Test: node -e "const c=require('fs').readFileSync('sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs','utf8');['journey-only','journey-illegal','partial-gp','complete-gp','empty'].forEach(k=>{if(!c.includes(\"'\"+k+\"'\"))process.exit(1)})"
  期望: exit 0

- [ ] [ARTIFACT] 永久回归移植进 packages/brain 的 dispatcher.test.js（含 journey-only 断言，随 brain-ci 常驻）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/__tests__/dispatcher.test.js','utf8');if(!(c.includes('journey-only')&&c.includes('gp_contract')))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 仅 journey_id 的 spawn:generator-fix 组包成功、不注入 gp_contract、不 assembly fault
  动作: 以 payload 仅含 journey_id 真调 createDispatcher('spawn:generator-fix') 走真实组包路径
  预期观察: 返回对象 failure_class 非 assembly_fault、detail 非 GP_CONTRACT_IDENTITY_INVALID；createAttempt 被调用产出 TaskBundle 且 bundle.inputs.gp_contract 为 undefined
  等待预算: 0s
  留证: probe stdout（OK 行）进 behavior_tests.log_tail
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && node sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs journey-only'

- [ ] [BEHAVIOR] [L2] B-02: 仅 journey_id 且格式非法仍旁路 GP 全字段校验
  动作: 以 payload 仅含非法格式 journey_id（'not-a-uuid'）真调组包路径
  预期观察: 不触发 GP 全字段校验（failure_class 非 assembly_fault），组包成功且 bundle.inputs.gp_contract 为 undefined
  等待预算: 0s
  留证: probe stdout（OK 行）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && node sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs journey-illegal'

- [ ] [BEHAVIOR] [L2] B-03: 空 payload（无 journey_id 无 GP 字段）→ 返回 null、组包成功、无 gp_contract
  动作: 以空 payload 真调组包路径
  预期观察: 触发集全空 → gpContractIdentity 返回 null；createAttempt 被调用，bundle.inputs.gp_contract 为 undefined
  等待预算: 0s
  留证: probe stdout（OK 行）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && node sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs empty'

- [ ] [BEHAVIOR] [L2] B-04: 完整 GP 身份 → gp_contract 六字段结构化透传不变
  动作: 以六字段（id/version/hash/golden_path_id/journey_id/step_id）齐全合法的 payload 真调组包路径
  预期观察: bundle.inputs.gp_contract 深等于 {id,version,hash,golden_path_id,journey_id,step_id}（沿用 dispatcher.test.js:135 既有期望）
  等待预算: 0s
  留证: probe stdout（OK 行）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && node sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs complete-gp'

- [ ] [BEHAVIOR] [L2] INV-1: 出现任一 GP 触发字段但六字段不全 → 继续 fail-closed（GP_CONTRACT_IDENTITY_INVALID）
  动作: 以 payload 含 journey_id + 单个 golden_path_id（触发集非空但不全）真调组包路径
  预期观察: 抛 GP_CONTRACT_IDENTITY_INVALID → 返回 failure_class=assembly_fault 且 detail=GP_CONTRACT_IDENTITY_INVALID；createAttempt 不被调用（fail-closed 不建 attempt）
  等待预算: 0s
  留证: probe stdout（OK 行）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && node sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs partial-gp'

- [ ] [BEHAVIOR] [L2] INV-2: 默认 fail-closed 不整体放宽——本修复只豁免「纯 journey_id/空触发集」，部分 GP 仍拦
  动作: 组合验证——journey-illegal（纯 journey_id 非法）放行 + partial-gp（部分 GP）拦截，两者退出码共同证明豁免边界精确
  预期观察: journey-illegal exit 0（放行）且 partial-gp exit 0（其内部断言 fail-closed 成立）——只有精确豁免面被放开，GP 触发面保持 fail-closed
  等待预算: 0s
  留证: 两条 probe stdout（均 OK 行）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && node sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs journey-illegal && node sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs partial-gp'

- [ ] [BEHAVIOR] [L2] B-05: 永久回归入 brain-ci——generator 移植后 brain vitest 的 journey-only 回归全绿
  动作: 在 packages/brain 下运行 brain vitest，过滤 dispatcher.test.js 中 journey-only 回归用例
  预期观察: 命中的 journey-only 回归用例全部 passed，无 failed（证明修复后转绿并永久保留）
  等待预算: 0s
  留证: /tmp/gp-reg.txt 末尾 Tests 汇总行
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}/packages/brain" && NODE_OPTIONS=--max-old-space-size=3072 npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t journey-only 2>&1 | tee /tmp/gp-reg.txt >&2; grep -Eq "Tests +[0-9]+ passed" /tmp/gp-reg.txt && ! grep -Eq "Tests.*[0-9]+ failed" /tmp/gp-reg.txt'
