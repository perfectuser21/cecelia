contract_branch: cp-harness-propose-r1-356449b7-rcdad746e-a4
sprint_dir: sprints/08111036-kernel-356449b7

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: kernel 账号选择接入用量数据（429 周限触发 target 轮换而非 run 终态）

**范围**: packages/brain 纯函数/纯状态机三点改动——(1) execution-contract 配额失败分类 account_exhausted；(2) derive account_exhausted 非终态重试；(3) resolveExecutionTarget 消费 account-usage CAPPED 判定。不改生产安全参数，不动 codex/grok target 语义，不合并两套账号系统。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] execution-contract.js 新增 account_exhausted failure_class 枚举 + 配额分类逻辑
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/execution-contract.js','utf8');if(!c.includes('account_exhausted'))process.exit(1)"
- [x] [ARTIFACT] derive.js attemptCallbackRoute 处理 account_exhausted 非终态分支
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!c.includes('account_exhausted')||!c.includes('callback_account_exhausted'))process.exit(1)"
- [x] [ARTIFACT] execution-targets.js resolveExecutionTarget 接入 is_account_capped 判定
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/preflight/execution-targets.js','utf8');if(!c.includes('is_account_capped'))process.exit(1)"

## Invariant 覆盖条目（历史铁律映射）

- [x] [BEHAVIOR] [L2] INV-1 [vitest 范围] 三个新增回归测试落在 vitest.config.js include(`src/**/*.test.js`) 且不在 exclude，exit code 真实反映真回归
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/preflight/execution-targets-capped.test.js src/orchestrator/__tests__/quota-exhaustion-classify.test.js src/orchestrator/__tests__/derive-account-exhausted.test.js --reporter=dot'

## BEHAVIOR 条目（内嵌可执行 manual: 命令 — 五行剧本，L2 服务端真验）

- [x] [BEHAVIOR] [L2] B-01: 429 weekly limit 归类 account_exhausted（Golden Path Step 1）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/quota-exhaustion-classify.test.js -t "429 weekly limit 的 failed 结果归类为 account_exhausted" --reporter=dot'

- [x] [BEHAVIOR] [L2] B-02: 偶发 429 无配额语义保持 runner_failure（Golden Path Step 2，边界）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/quota-exhaustion-classify.test.js -t "偶发 429 无配额语义关键词" --reporter=dot'

- [x] [BEHAVIOR] [L2] B-03: account_exhausted 不判 run 终态·同 run 重派（Golden Path Step 3）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/derive-account-exhausted.test.js -t "account_exhausted 的 attempt callback" --reporter=dot'

- [x] [BEHAVIOR] [L2] B-04: runner_failure 仍判 run 终态（Golden Path Step 4，回归护栏）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/derive-account-exhausted.test.js -t "普通 runner_failure 仍判 run 终态" --reporter=dot'

- [x] [BEHAVIOR] [L2] B-05: 选目标跳过 CAPPED account1 轮换到 account2（Golden Path Step 5）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/preflight/execution-targets-capped.test.js -t "CAPPED 的 preferred 账号被跳过" --reporter=dot'

- [x] [BEHAVIOR] [L2] B-06: 两账号均 CAPPED → blocked 不静默假死（Golden Path Step 6，边界）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/preflight/execution-targets-capped.test.js -t "两账号均 CAPPED" --reporter=dot'

- [x] [BEHAVIOR] [L2] B-07: account-usage 不可达降级静态顺序不 crash（Golden Path Step 7，边界）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/preflight/execution-targets-capped.test.js -t "抛错时降级为静态白名单顺序" --reporter=dot'

- [x] [BEHAVIOR] [L2] B-08: 既有 orchestrator 测试零回归（白名单基数 18 + 既有分类/路由不回退）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/execution-contract.test.js src/orchestrator/__tests__/derive.test.js src/orchestrator/preflight/execution-targets.test.js --reporter=dot'
