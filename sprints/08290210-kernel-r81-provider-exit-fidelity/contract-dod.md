---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 结构化上报保真透传，根除 provider_exit 语义埋没 [r81]

**范围**: `normalize_provider_failure`（entrypoint）+ `kernel-attempt-handler` close-result 解析的结构化终态前置读取与保真透传；CONTRACT_* 家族分类进合同故障重开路径的护栏断言。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] kernel-attempt-handler 导出纯函数 resolveProviderCloseResult
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs','utf8');if(!/resolveProviderCloseResult/.test(c)||!/module\.exports[\s\S]*resolveProviderCloseResult/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 冻结 RED 测试落盘 sprints/<sprint_dir>/tests/（seal 闸校验路径）
  Test: node -e "const c=require('fs').readFileSync('sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js','utf8');if(!c.includes('resolveProviderCloseResult')||!c.includes('normalize_provider_failure'))process.exit(1)"

- [ ] [ARTIFACT] 需求3 分类护栏测试落盘 tests/gp/f1/
  Test: node -e "const c=require('fs').readFileSync('tests/gp/f1/step3-contract-fault-not-infrastructure.test.js','utf8');if(!c.includes('ARBITRATE_CONTRACT_FAULT'))process.exit(1)"

- [ ] [ARTIFACT] 版本 bump 四处同步（check-version-sync）
  Test: manual:bash -c 'bash scripts/check-version-sync.sh'

## BEHAVIOR 条目（五行剧本 · L2 服务端真验 · 真 import/真跑被改边，禁 mock）

- [ ] [BEHAVIOR] [L2] B-01: kernel-attempt-handler 导出可离线重放纯函数 resolveProviderCloseResult
  动作: 真 import packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs，读取导出成员
  预期观察: typeof resolveProviderCloseResult === 'function'（当前未导出 → RED）
  等待预算: 0s
  留证: vitest basic 报告末 10 行（含该 it 绿）
  Test: manual:bash -c 'npx vitest run sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js -t "导出纯函数 resolveProviderCloseResult" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-02: 非零退出 + 结构化 success → 透传 completed（埋没点①②，r77/r76）
  动作: 喂 exit 1 + 合法结构化 success result.json，分别过纯函数 resolveProviderCloseResult 与真跑 bash normalize_provider_failure
  预期观察: 两侧回执 status=="completed"（当前实现覆盖为 failed/provider_exit → RED）
  等待预算: 0s
  留证: vitest 报告（① out.status、② normalized.status 均 completed）
  Test: manual:bash -c 'npx vitest run sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js -t "结构化 success result → 透传 completed" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-03: 非零退出 + 结构化 BLOCKED+CONTRACT_* → 保真透传 error.code（埋没点①②，r69）
  动作: 喂 exit 1 + 结构化 BLOCKED（error.code=CONTRACT_TEST_UNSATISFIABLE），过纯函数与真跑 bash normalize_provider_failure
  预期观察: 两侧回执 status=="blocked" 且 error.code=="CONTRACT_TEST_UNSATISFIABLE"（当前覆盖为 provider_exit → RED）
  等待预算: 0s
  留证: vitest 报告（error.code 保真）
  Test: manual:bash -c 'npx vitest run sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js -t "结构化 BLOCKED + CONTRACT_* → 保真透传 error.code" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-04: INV-1 负向 kernel — 无 result.json（真崩溃）→ provider_exit_${code} 语义不变
  动作: 喂 exit 3 + 无 result.json，过纯函数 resolveProviderCloseResult
  预期观察: 回执 status=="failed" 且 error.code=="provider_exit_3"（透传闸不误伤真崩溃）
  等待预算: 0s
  留证: vitest 报告（负向绿）
  Test: manual:bash -c 'npx vitest run sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js -t "provider_exit_${code} 语义不变" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-05: 负向 kernel — exit 0 + 非法 result.json → provider_result_invalid 语义不变
  动作: 喂 exit 0 + 非法 JSON result.json，过纯函数 resolveProviderCloseResult
  预期观察: 回执 status=="failed" 且 error.code=="provider_result_invalid"（解析失败回退不变）
  等待预算: 0s
  留证: vitest 报告
  Test: manual:bash -c 'npx vitest run sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js -t "provider_result_invalid 语义不变" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-06: INV-1 负向 entrypoint — 无 result.json（真崩溃）→ provider_exit 语义不变
  动作: 真跑 bash normalize_provider_failure，喂 exit 1 + 良性崩溃 stdout + 无 result.json
  预期观察: normalized status=="failed" 且 error.code=="provider_exit"（黑名单语义不动）
  等待预算: 0s
  留证: vitest 报告（负向绿）
  Test: manual:bash -c 'npx vitest run sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js -t "provider_exit 语义不变" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-07: 铁律 entrypoint — exit 124（超时）→ provider_timeout 语义不变
  动作: 真跑 bash normalize_provider_failure，喂 exit 124（即便存在合法 success result.json）
  预期观察: normalized error.code=="provider_timeout"（超时优先，不被结构化 success 透传抢占）
  等待预算: 0s
  留证: vitest 报告
  Test: manual:bash -c 'npx vitest run sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js -t "exit 124（超时）→ provider_timeout" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-08: 需求3 — CONTRACT_* 结构化 BLOCKED → 合同故障重开（arbitrate:contract_fault）非 infrastructure
  动作: 真 import derive，喂 generator status=blocked + error.code=CONTRACT_TEST_UNSATISFIABLE 回执
  预期观察: derive 返回 action==ARBITRATE_CONTRACT_FAULT 且 reason==contract_fault_appeal（不进 failed_targets/infrastructure）
  等待预算: 0s
  留证: vitest 报告
  Test: manual:bash -c 'npx vitest run tests/gp/f1/step3-contract-fault-not-infrastructure.test.js -t "error.code=CONTRACT_TEST_UNSATISFIABLE" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-09: 需求3 对照 — provider_exit（infrastructure）不进合同故障重开路径
  动作: 真 import derive，喂 generator status=failed + failure_class=infrastructure_blocked + error.code=provider_exit
  预期观察: derive 返回 action != ARBITRATE_CONTRACT_FAULT 且 != REOPEN_GAN_CONTRACT，reason==callback_infrastructure_blocked
  等待预算: 0s
  留证: vitest 报告
  Test: manual:bash -c 'npx vitest run tests/gp/f1/step3-contract-fault-not-infrastructure.test.js -t "provider_exit（infrastructure）→ 不进合同故障重开路径" --reporter=basic'
