---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 结构化上报保真透传，根除 provider_exit 语义埋没 [r82]

**范围**: runner/bridge 回执链路结构化终态保真透传（`kernel-attempt-handler.cjs` 回执归因；`entrypoint.sh` finalize 如需）+ kernel `attempt-store` failed_targets 采集排除 CONTRACT_* 家族。负向（真崩溃无结构化产出）语义零回归。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 冻结 RED 测试落在本 sprint tests/ 且真 import 被改模块（禁 mock 被改边）
  Test: node -e "const c=require('fs').readFileSync('sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js','utf8');if(!c.includes('kernel-attempt-handler.cjs')||!c.includes('attempt-store.js')||!c.includes('resolveProviderTerminalResult'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] tests/gp/f1/ companion 守卫存在（PRD 指定位置，文件名避让 main 同族）
  Test: node -e "const fs=require('fs');const p='tests/gp/f1/step3-contract-fault-fidelity-not-provider-exit.test.js';if(!fs.existsSync(p))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous 纯函数可重放）

- [ ] [BEHAVIOR] [L2] B-01: 结构化 BLOCKED + CONTRACT_* 遇非零退出，回执保真透传不被包装成 provider_exit（复刻 r69/r77）
  动作: 真读一份合法结构化 BLOCKED(.brain-result.json, error.code=CONTRACT_SELF_CONTRADICTION) + code=1 喂给 resolveProviderTerminalResult
  预期观察: 返回对象 status=blocked 且 error.code=CONTRACT_SELF_CONTRADICTION，绝不出现 provider_exit* 家族码
  等待预算: 0s
  留证: vitest 输出末尾（含该 it 绿行）进 behavior_tests.log_tail
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js -t "保真透传不被包装成 provider_exit" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-02: failed_targets 采集 SQL 排除 CONTRACT_* 家族，合同故障 target 不被拉黑
  动作: 真 createAttemptStore(stubPool).listFailedExecutionTargets(runId,'generator')，捕获实际发往 Postgres 的 SQL 文本
  预期观察: SQL 含 NOT LIKE 'CONTRACT_%' 家族排除（或 NOT IN 列举 CONTRACT 码），且时效窗口 make_interval 谓词保留
  等待预算: 0s
  留证: vitest 输出该 it 绿行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js -t "failed_targets 采集排除 CONTRACT" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-03: 负向不回退——无结构化产出的真崩溃 + 非零退出仍归 provider_exit（语义不变）
  动作: 传 resultPath 指向缺失文件 / 损坏 JSON + 非零 code 给 resolveProviderTerminalResult
  预期观察: 缺失路径返回 status=failed 且 error.code 匹配 ^provider_exit；损坏路径 status=failed 且 error.code 不匹配 ^CONTRACT_
  等待预算: 0s
  留证: vitest 两条负向 it 绿行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js -t "负向不回退" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-04: success 结果 JSON（completed）遇非零退出同样保真，不被误判为失败
  动作: 真读一份 status=completed 的 .brain-result.json + code=1 喂给 resolveProviderTerminalResult
  预期观察: 返回对象 status=completed（非零退出码不覆盖成功语义）
  等待预算: 0s
  留证: vitest 该 it 绿行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js -t "success 结果 JSON" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-05: F1/step3 companion 守卫全绿（PRD 指定 tests/gp/f1/ 位置，真 import 同两条边）
  动作: 从仓库根跑 tests/gp/f1/ companion 测试（tests/** 允许根跑）
  预期观察: 该文件全部 it 绿（保真 + CONTRACT_* SQL 排除 + 负向）
  等待预算: 0s
  留证: vitest 输出该文件汇总绿行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd /workspace && npx vitest run tests/gp/f1/step3-contract-fault-fidelity-not-provider-exit.test.js --reporter=basic'

- [ ] [BEHAVIOR] [L2] INV-1 归因保真不变量：整份冻结 sprint 测试全绿（保真 + 分流 + 负向零回归一体验收）
  动作: 从仓库根跑冻结 sprint 测试全量
  预期观察: 全部 it 绿；无 provider_exit 埋没 CONTRACT_*，无负向回退
  等待预算: 0s
  留证: vitest 汇总行（Tests N passed）进 behavior_tests.log_tail
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js --reporter=basic'

- [ ] [BEHAVIOR] [L2] INV-2 版本四处同步（package.json SSOT / package-lock.json / .brain-versions / DEFINITION.md）
  动作: 跑 check-version-sync.sh 校验四处版本一致
  预期观察: 输出 "All version files in sync"，exit 0
  等待预算: 0s
  留证: 脚本 stdout 末尾进 behavior_tests.log_tail
  Test: manual:bash -c 'cd /workspace && bash scripts/check-version-sync.sh'

## 铁律映射（历史约束三源）

- INV「归因保真」→ B-01/B-03/INV-1（结构化终态存在时 error_code 不得被 provider_exit 埋没；负向不回退）
- INV「结果契约」→ N/A：本 sprint 不改 evaluator `.brain-result.json` 顶层结构（exit_code+log_tail+behavior_tests[] 由既有 evaluator 保证），只保真透传 status+error.code
- INV「RED 纯净」→ Red commit 只 git add 精确 `*.test.js`（见 task-plan tdd 段），禁 git add . / .harness
- INV「测试契约表」→ Test Contract 表固定 4 列、testFile backtick 包裹（见下）
- INV「毕业顺序」→ 毕业 commit 后本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push
- INV「真环境」→ 纯函数可重放即本任务真环境（postgres:false，无真机/UI 接缝）
- INV「多租户/凭据安全/日志脱敏/端点鉴权/租户隔离/禁写死环境/单slot串行」→ N/A：本 sprint 不触及租户数据/凭据/端点/环境常量/并发调度

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 回执保真 + failed_targets 排除 + 负向零回归（冻结主测） | `sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js` | 保真透传不被包装成 provider_exit / failed_targets 采集排除 CONTRACT / 负向不回退 / success 结果 JSON | resolveProviderTerminalResult is not a function + SQL 无 CONTRACT 排除 → 6 failures（已实证 6/6 真红） |
| F1/step3 companion 守卫（PRD 指定位置补充行） | `tests/gp/f1/step3-contract-fault-fidelity-not-provider-exit.test.js` | 保真，error.code 不被埋没成 provider_exit / 真崩溃负向 / failed_targets 采集 SQL 排除 CONTRACT | 同上 → 3 failures（已实证 3/3 真红） |
