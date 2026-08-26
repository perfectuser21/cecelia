---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: generator 合同故障码保真透传（根除 provider_exit 语义埋没）[r76]

**范围**: 仅 `packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs` 新增纯函数 `reconcileProviderCloseResult` 并在 provider close 处理器改用它；版本四处 bump。不改 derive.js / attempt-store.js（既有 CONTRACT_* 路由与 error_code 落库已在 main）。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] kernel-attempt-handler.cjs 导出 reconcileProviderCloseResult 且 close 处理器改用它（非零退出不再无条件 provider_exit）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs','utf8');if(!c.includes('reconcileProviderCloseResult'))process.exit(1)"

- [ ] [ARTIFACT] 冻结合同测试文件存在（seal 锚）
  Test: node -e "const c=require('fs').readFileSync('sprints/08261440-kernel-r76-contract-fault-code/tests/step3-contract-fault-code-passthrough.test.js','utf8');if(!c.includes('reconcileProviderCloseResult'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous 模板；真 require 被改模块 + 真 fs，禁 mock 被改的边）

- [ ] [BEHAVIOR] [L2] B-01: 结构化 BLOCKED + CONTRACT_SELF_CONTRADICTION 非零退出被保真透传
  动作: 写盘合法结构化 BLOCKED result（error.code=CONTRACT_SELF_CONTRADICTION），以 code=1 调 reconcileProviderCloseResult
  预期观察: 返回 result.status='blocked' 且 result.error.code='CONTRACT_SELF_CONTRADICTION'，无 provider_exit 降级
  等待预算: 0s
  留证: vitest 单测输出（1 passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08261440-kernel-r76-contract-fault-code/tests/step3-contract-fault-code-passthrough.test.js -t "preserves CONTRACT_SELF_CONTRADICTION structured BLOCKED on non-zero provider exit" --no-color'
  期望: 1 passed

- [ ] [BEHAVIOR] [L2] B-02: CONTRACT_CI_SCOPE_CONFLICT error_code 保真且命中 derive 子集匹配
  动作: 写盘结构化 BLOCKED result（error.code=CONTRACT_CI_SCOPE_CONFLICT），以 code=3 调 reconcileProviderCloseResult
  预期观察: 返回 error.code='CONTRACT_CI_SCOPE_CONFLICT'，tokenize 后 {CI,CONFLICT} 为 derive CONTRACT_FAULT_CORE_TOKENS 超集
  等待预算: 0s
  留证: vitest 单测输出（1 passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08261440-kernel-r76-contract-fault-code/tests/step3-contract-fault-code-passthrough.test.js -t "preserves CONTRACT_CI_SCOPE_CONFLICT structured BLOCKED error_code faithfully" --no-color'
  期望: 1 passed

- [ ] [BEHAVIOR] [L2] B-03: INV-1 真崩溃负向——无结构化写盘 provider_exit 语义不变
  动作: resultPath 指向不存在文件，以 code=137 调 reconcileProviderCloseResult
  预期观察: 返回 status='failed' 且 error.code='provider_exit_137'，无 CONTRACT 子串
  等待预算: 0s
  留证: vitest 单测输出（1 passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08261440-kernel-r76-contract-fault-code/tests/step3-contract-fault-code-passthrough.test.js -t "falls back to provider_exit on genuine crash without structured result" --no-color'
  期望: 1 passed

- [ ] [BEHAVIOR] [L2] B-04: 写盘非法 JSON 非零退出回落 provider_exit（真崩溃族）
  动作: 写盘半个/非法 JSON，以 code=2 调 reconcileProviderCloseResult
  预期观察: 返回 error.code='provider_exit_2'，不当作可信结构化申诉透传
  等待预算: 0s
  留证: vitest 单测输出（1 passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08261440-kernel-r76-contract-fault-code/tests/step3-contract-fault-code-passthrough.test.js -t "falls back to provider_exit when result file is invalid on non-zero exit" --no-color'
  期望: 1 passed

- [ ] [BEHAVIOR] [L2] B-05: 非 blocked 结构化 result 非零退出不误入合同透传
  动作: 写盘 status='failed' 的结构化 result，以 code=9 调 reconcileProviderCloseResult
  预期观察: 返回 error.code='provider_exit_9'（仅 status=blocked 才走保真透传）
  等待预算: 0s
  留证: vitest 单测输出（1 passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08261440-kernel-r76-contract-fault-code/tests/step3-contract-fault-code-passthrough.test.js -t "does not misroute non-blocked structured result on non-zero exit to passthrough" --no-color'
  期望: 1 passed

- [ ] [BEHAVIOR] [L2] B-06: 零退出路径回归——结构化 result 保真解析不变
  动作: 写盘 status='completed' 结构化 result，以 code=0 调 reconcileProviderCloseResult
  预期观察: 返回 status='completed' 且 error=null，零退出行为与 main 一致
  等待预算: 0s
  留证: vitest 单测输出（1 passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08261440-kernel-r76-contract-fault-code/tests/step3-contract-fault-code-passthrough.test.js -t "parses structured result unchanged on zero exit" --no-color'
  期望: 1 passed

## Invariant 覆盖（铁律映射）

- [ ] [BEHAVIOR] [L2] INV-1 [真崩溃保真] provider 真进程崩溃（无结构化上报）仍按 provider_exit / infrastructure 处理
  动作: 分别以 无写盘(code=137) 与 非法写盘(code=2) 调 reconcileProviderCloseResult
  预期观察: 两种真崩溃场景均返回 provider_exit_<code>，铁律未被破坏
  等待预算: 0s
  留证: vitest 单测输出（2 passed，crash + invalid）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08261440-kernel-r76-contract-fault-code/tests/step3-contract-fault-code-passthrough.test.js -t "falls back to provider_exit" --no-color'
  期望: 2 passed
- INV-2 [合同边界] claim 与可写白名单显式包含（新测试、被改实现文件、版本四处、DoD.md、sprints/<sprint_dir>/**）：N/A 于运行时行为断言——由 claim gate 与 runner finalizer HEAD 树校验强制，本 sprint 不新建计划外文件。
