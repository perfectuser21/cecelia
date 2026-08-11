---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: kernel 账号选择接入用量数据（429 周限触发 target 轮换而非 run 终态）

**范围**: packages/brain 纯函数/纯状态机三点改动——(1) execution-contract 配额失败分类 account_exhausted；(2) derive account_exhausted 非终态重试；(3) resolveExecutionTarget 消费 account-usage CAPPED 判定。不改生产安全参数，不动 codex/grok target 语义，不合并两套账号系统。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] execution-contract.js 新增 account_exhausted failure_class 枚举 + 配额分类逻辑
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/execution-contract.js','utf8');if(!c.includes('account_exhausted'))process.exit(1)"
- [ ] [ARTIFACT] derive.js attemptCallbackRoute 处理 account_exhausted 非终态分支
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!c.includes('account_exhausted')||!c.includes('callback_account_exhausted'))process.exit(1)"
- [ ] [ARTIFACT] execution-targets.js resolveExecutionTarget 接入 is_account_capped 判定
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/preflight/execution-targets.js','utf8');if(!c.includes('is_account_capped'))process.exit(1)"

## Invariant 覆盖条目（历史铁律映射）

- [ ] [BEHAVIOR] [L2] INV-1 [vitest 范围] 三个新增回归测试落在 vitest.config.js include(`src/**/*.test.js`) 且不在 exclude，exit code 真实反映真回归
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/preflight/execution-targets-capped.test.js src/orchestrator/__tests__/quota-exhaustion-classify.test.js src/orchestrator/__tests__/derive-account-exhausted.test.js --reporter=dot'
- INV-2 [local_api meta]：本 sprint 以 vitest DB/日志证据替代 UI 证据（无 UI smoke），E2E 段全部 vitest exit-code oracle —— 已在 contract-draft.md ## E2E 验收 落实（N/A UI 证据）。
- INV-3 [证据充分]：judge 侧铁律，本 sprint 交付物（纯函数改动）不触及 judge 证据流；N/A：本 sprint 不改 judge/evaluator 证据链。

## BEHAVIOR 条目（内嵌可执行 manual: 命令 — 五行剧本，L2 服务端真验）

- [ ] [BEHAVIOR] [L2] B-01: 429 weekly limit 归类 account_exhausted（Golden Path Step 1）
  动作: 调 parseHarnessResult(status=failed, error={code:http_429, message:"You've hit your weekly limit"}, role=generator)
  预期观察: 返回对象 failure_class === "account_exhausted"（区别于 runner_failure）
  等待预算: 0s
  留证: vitest dot 输出该 it PASS，进 behavior_tests.log_tail
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/quota-exhaustion-classify.test.js -t "429 weekly limit 的 failed 结果归类为 account_exhausted" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-02: 偶发 429 无配额语义保持 runner_failure（Golden Path Step 2，边界）
  动作: 调 parseHarnessResult(status=failed, error={code:http_429, message:"Too Many Requests"})
  预期观察: failure_class === "runner_failure"（不误判为账号耗尽，不过度轮换）
  等待预算: 0s
  留证: vitest dot 输出该 it PASS
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/quota-exhaustion-classify.test.js -t "偶发 429 无配额语义关键词" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-03: account_exhausted 不判 run 终态·同 run 重派（Golden Path Step 3）
  动作: 调 derive(observed) 携 attempt callback {status:failed, failure_class:account_exhausted, role:generator}
  预期观察: 返回 {phase:"generate", action:"spawn:generator-fix", reason:"callback_account_exhausted"}，phase 不为 failed/terminal
  等待预算: 0s
  留证: vitest dot 输出该 it PASS
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/derive-account-exhausted.test.js -t "account_exhausted 的 attempt callback" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-04: runner_failure 仍判 run 终态（Golden Path Step 4，回归护栏）
  动作: 调 derive(observed) 携 attempt callback {status:failed, failure_class:runner_failure}
  预期观察: 返回 {phase:"failed", action:"mark_failed", reason:"callback_runner_failure"}（既有终态语义不回退）
  等待预算: 0s
  留证: vitest dot 输出该 it PASS
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/derive-account-exhausted.test.js -t "普通 runner_failure 仍判 run 终态" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-05: 选目标跳过 CAPPED account1 轮换到 account2（Golden Path Step 5）
  动作: 调 resolveExecutionTarget(preferred=account1, candidates=[account1,account2], is_account_capped=t=>t.account==="account1")
  预期观察: status="ok" 且 target.account==="account2"（CAPPED 账号被跳过）
  等待预算: 0s
  留证: vitest dot 输出该 it PASS
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/preflight/execution-targets-capped.test.js -t "CAPPED 的 preferred 账号被跳过" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-06: 两账号均 CAPPED → blocked 不静默假死（Golden Path Step 6，边界）
  动作: 调 resolveExecutionTarget(candidates=[account1,account2], is_account_capped=()=>true)
  预期观察: status="blocked" 且 fallback_reason="all_execution_targets_exhausted"（此时才允许 run 走终态）
  等待预算: 0s
  留证: vitest dot 输出该 it PASS
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/preflight/execution-targets-capped.test.js -t "两账号均 CAPPED" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-07: account-usage 不可达降级静态顺序不 crash（Golden Path Step 7，边界）
  动作: 调 resolveExecutionTarget(preferred=account1, candidates=[account1,account2], is_account_capped=()=>{throw new Error("unreachable")})
  预期观察: 不抛异常，status="ok" 且 target.account==="account1"（降级静态白名单顺序）
  等待预算: 0s
  留证: vitest dot 输出该 it PASS
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/preflight/execution-targets-capped.test.js -t "抛错时降级为静态白名单顺序" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-08: 既有 orchestrator 测试零回归（白名单基数 18 + 既有分类/路由不回退）
  动作: 复跑 execution-contract.test.js + derive.test.js + execution-targets.test.js
  预期观察: 三文件全绿（Test Files N passed, 0 failed）
  等待预算: 0s
  留证: vitest dot 输出全 passed
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/execution-contract.test.js src/orchestrator/__tests__/derive.test.js src/orchestrator/preflight/execution-targets.test.js --reporter=dot'
