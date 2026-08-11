---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 账号 CAPPED 判定接线 + seven_day 硬过滤

**范围**: kernel 选号在派发前剔除 CAPPED / seven_day 打满账号（five_hour 仅次级排序），payload 钉号生效，capped/额度判定共用 account-usage 单一事实源。
**大小**: M
**PR 标题必须以 `feat(harness):` 开头。**

## ARTIFACT 条目

- [ ] [ARTIFACT] `expandUnresolvedAccountTargets` 接受额度感知 opts（accountUsage/seven_day 硬过滤/五时次级排序）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/preflight/execution-targets.js','utf8');if(!/seven_day_pct/.test(c)||!/five_hour_pct/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `account-usage.js` 导出单一事实源 seven_day 硬过滤谓词
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/account-usage.js','utf8');if(!/export\s+function\s+isAccountSevenDayCapped/.test(c)||!/SEVEN_DAY_CAP_PCT/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `harness-skill-relay.js` 构造 acctOpts 携带 payload.CECELIA_CREDENTIALS
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-skill-relay.js','utf8');if(!/CECELIA_CREDENTIALS/.test(c)||!/payload/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令；五行剧本）

- [ ] [BEHAVIOR] [L2] B-01: 核心红线 — account1 CAPPED 时解析出 account2
  动作: 以 account1 CAPPED（seven_day=100）、account2 正常 调 expandUnresolvedAccountTargets(opts) 再 resolveExecutionTarget
  预期观察: 展开候选排除 account1（`['account2']`），解析出的 target.account === 'account2'（解析出 account1 即判失败）
  等待预算: 0s
  留证: vitest -t "B-01" 输出末 5 行（含 pass）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08121550-account-capped-wiring/tests/account-capped-wiring.test.ts -t "B-01" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-02: seven_day 硬过滤 — seven_day=100/five_hour=0/omelette 缺失账号被排除（当天事故复现）
  动作: 以 account1{seven_day:100,five_hour:0,无 omelette}、account2{seven_day:12} 调 expandUnresolvedAccountTargets(opts)
  预期观察: 结果为 `['account2']`；且 isAccountSevenDayCapped({seven_day_pct:100})===true、SEVEN_DAY_CAP_PCT===95（omelette 缺失不按 0 判健康）
  等待预算: 0s
  留证: vitest -t "B-02" 输出末 5 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08121550-account-capped-wiring/tests/account-capped-wiring.test.ts -t "B-02" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-03: 次级排序 — 两账号 seven_day 均低仅 five_hour 不同 → five_hour 升序（行为不变）
  动作: 以 account1{five_hour:50,seven_day:10}、account2{five_hour:5,seven_day:20} 调 expandUnresolvedAccountTargets(opts)
  预期观察: 结果按 five_hour 升序 `['account2','account1']`
  等待预算: 0s
  留证: vitest -t "B-03" 输出末 5 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08121550-account-capped-wiring/tests/account-capped-wiring.test.ts -t "B-03" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-04: INV-1 降级铁律 — 不注入 opts → 保持白名单声明顺序（零回归）
  动作: 调 expandUnresolvedAccountTargets([unresolved-claude]) 不带 opts
  预期观察: 展开为 `['account1','account2']`，与既有静态白名单顺序逐字相等
  等待预算: 0s
  留证: vitest -t "B-04" 输出末 5 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08121550-account-capped-wiring/tests/account-capped-wiring.test.ts -t "B-04" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-05: INV-1 降级铁律 — isAccountCapped 抛错 → 不 crash，所有账号按可用处理
  动作: 注入 isAccountCapped 抛错 + accountUsage 两账号均低 调 expandUnresolvedAccountTargets(opts)
  预期观察: 不抛异常，返回账号集合 == {account1, account2}（不误剔好账号）
  等待预算: 0s
  留证: vitest -t "B-05" 输出末 5 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08121550-account-capped-wiring/tests/account-capped-wiring.test.ts -t "B-05" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-06: 人工钉号 — payload.CECELIA_CREDENTIALS 透传到 resolveAccount
  动作: 以 payload.CECELIA_CREDENTIALS='creds-account2' 调 spawnSkillRelaySession（注入 resolveAccountFn 捕获间谍）
  预期观察: resolveAccount 收到的 env.CECELIA_CREDENTIALS === 'creds-account2'（显式钉号入口打通）
  等待预算: 0s
  留证: vitest -t "B-06" 输出末 5 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08121550-account-capped-wiring/tests/manual-pin-relay.test.ts -t "B-06" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-07: 零回归 — dispatcher/execution-targets/account-usage/account-rotation 既有单测全绿
  动作: 跑 execution-targets、execution-targets-capped、dispatcher、account-usage、account-rotation 既有单测
  预期观察: 全部 exit 0，无 fail（既有选号/轮换/派发行为不回退）
  等待预算: 0s
  留证: vitest --reporter=dot 汇总行（Test Files N passed）
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/orchestrator/preflight/execution-targets.test.js src/orchestrator/preflight/execution-targets-capped.test.js src/orchestrator/__tests__/dispatcher.test.js src/__tests__/account-usage.test.js src/spawn/middleware/__tests__/account-rotation.test.js --reporter=dot'
