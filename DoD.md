contract_branch: cp-harness-propose-r2-44a5b42a-r7867ae4a-a15
sprint_dir: sprints/08280010-kernel-r79-provider-exit-fidelity

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 结构化上报保真透传，根除 provider_exit 语义埋没 [r79]

**范围**: runner 回执归一化（entrypoint.sh）+ kernel 失败归因分流（derive.js / ground-truth.js）；纯函数 + 真 bash/jq 离线重放。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] 冻结合同测试存在且真 import 被改模块（derive + ground-truth + 真 bash 抽取 entrypoint.sh 函数）
  Test: node -e "const c=require('fs').readFileSync('sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js','utf8');if(!(c.includes('orchestrator/derive.js')&&c.includes('orchestrator/ground-truth.js')&&c.includes('normalize_provider_failure')&&c.includes('validate_claude_terminal_receipt')))process.exit(1)"

- [x] [ARTIFACT] F1 永久回归测试存在（tests/gp/f1，避让既有 step3-* 文件名）
  Test: node -e "require('fs').accessSync('tests/gp/f1/step3-provider-exit-fidelity.test.js')"

- [x] [ARTIFACT] ground-truth.js 导出 GENERATOR_RUNTIME_ERROR_CODES（归因口径可锁）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/ground-truth.js','utf8');if(!/export\s+(const\s+)?GENERATOR_RUNTIME_ERROR_CODES|export\s*\{[^}]*GENERATOR_RUNTIME_ERROR_CODES/.test(c))process.exit(1)"

- [x] [ARTIFACT] 版本四处同步（packages/brain/package.json / package-lock.json / .brain-versions / DEFINITION.md）
  Test: manual:bash -c 'bash scripts/check-version-sync.sh'

## BEHAVIOR 条目

- [x] [BEHAVIOR] [L2] B-01: runner 保真透传结构化 BLOCKED 的 CONTRACT_* 错误码（r69 复刻）[接缝×2]
  动作: 真 bash 抽取 entrypoint.sh 的 normalize_provider_failure，喂入「结构化 BLOCKED + error.code=CONTRACT_SELF_CONTRADICTION 的 result_file + provider_exit=1」
  预期观察: 归一化产物 error.code 保真为 CONTRACT_SELF_CONTRADICTION、status=blocked，绝不降级为 provider_exit
  等待预算: 0s
  留证: vitest 用例输出（sprint 冻结测试「保真透传结构化 BLOCKED」it）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "保真透传结构化 BLOCKED" --reporter=dot'

- [x] [BEHAVIOR] [L2] B-02: runner 认可 commander-directive/v1 成功信封（r77 复刻）[接缝×2]
  动作: 真 bash 抽取 validate_claude_terminal_receipt，喂入「claude success 信封 + structured_output=commander-directive/v1 result + 匹配 session」
  预期观察: validate 返回 exit 0（认可成功），上游据此恢复 provider_exit=0 走成功透传，非 provider_exit failed
  等待预算: 0s
  留证: vitest 用例输出（sprint 冻结测试「认可 commander-directive/v1」it）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "认可 commander-directive/v1" --reporter=dot'

- [x] [BEHAVIOR] [L2] B-03: kernel CONTRACT_* → 合同故障重开 GAN 路径，不进 failed_targets
  动作: 真 import derive，喂入 generator 结构化 BLOCKED + error_code=CONTRACT_SELF_CONTRADICTION 的 attempt_callback
  预期观察: derive 返回 action=arbitrate:contract_fault、phase=gan，非 mark:failed、非 infrastructure 重试
  等待预算: 0s
  留证: vitest 用例输出（sprint 冻结测试「合同故障重开 GAN 路径」it）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "合同故障重开 GAN 路径" --reporter=dot'

- [x] [BEHAVIOR] [L2] B-04: 归因口径 GENERATOR_RUNTIME_ERROR_CODES 排除 CONTRACT_* 家族
  动作: 真 import ground-truth 的 GENERATOR_RUNTIME_ERROR_CODES Set
  预期观察: Set 含 provider_exit/provider_timeout，且不含 CONTRACT_SELF_CONTRADICTION/CONTRACT_TEST_UNSATISFIABLE/CONTRACT_CI_SCOPE_CONFLICT
  等待预算: 0s
  留证: vitest 用例输出（sprint 冻结测试「排除 CONTRACT_* 家族」it）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "排除 CONTRACT_* 家族" --reporter=dot'

- [x] [BEHAVIOR] [L2] INV-1: [负向不动] 真崩溃无结构化产出 → 仍 provider_exit，kernel 仍走 infrastructure 有界重派
  动作: 真 bash 跑 normalize_provider_failure（stdout 非 JSON 崩溃文本 + result 非法信封）；真 import derive 喂 provider_exit attempt
  预期观察: 归一化 error.code=provider_exit；derive reason=callback_infrastructure_blocked 且 action≠arbitrate:contract_fault、phase≠failed，黑名单语义不变
  等待预算: 0s
  留证: vitest 用例输出（「无结构化产出的真崩溃仍归一 provider_exit」+「infrastructure 有界重派」两 it）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "provider_exit" --reporter=dot'

- [x] [BEHAVIOR] [L2] INV-3: [RED先行] F1 永久回归全绿（修复后永久保留在 CI 作回归，真 import 被改边）
  动作: 从仓库根跑 tests/gp/f1 永久回归测试（真 import derive/ground-truth + 真 bash/jq）
  预期观察: 5 个 it 全绿（passthrough / 负向 provider_exit / kernel 分流 / 负向 infra / 归因口径）
  等待预算: 0s
  留证: vitest --reporter=dot 输出末行（Tests N passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run tests/gp/f1/step3-provider-exit-fidelity.test.js --reporter=dot'

## Invariant 覆盖（铁律逐条映射）

- INV-1 [负向不动]：见上 B-INV-1 可执行断言（真崩溃 → provider_exit/infrastructure，黑名单语义不变）。
- INV-2 [合同边界]：N/A 运行时断言 —— 由 task-plan.json ws1.files 白名单 + 封印闸 claim 校验保证；行为变更冲突的既有回归测试若出现须一并 claim（当前无冲突）。
- INV-3 [RED先行]：见上 B-INV-3（failing test 先行复刻 r69/r77，修复后永久保留在 CI；冻结测试真 import 被改边、禁 mock）。
- INV-4 [凭据隔离]：N/A —— 本 sprint 不触及凭据/账号资源（凭据互踢已于 08-28 根治，非本 sprint 范围，PRD L53）。
