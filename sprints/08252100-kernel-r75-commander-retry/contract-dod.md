---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: commander lease 过期有界自动重派 [r75]

**范围**: kernel 编排器 `derive.js` 把 commander 纳入有界（上限 5）infrastructure 重试；同步更新 #5058 既有回归测试的场景铺垫；版本四处 bump。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] derive.js 含 commander 有界重试实现（CAP 常量 + 序号计数 + role=commander 未达上限 return null 分支）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!c.includes('COMMANDER_INFRA_RETRY_CAP')||!/role === 'commander'/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 冻结合同测试存在且真 import derive.js
  Test: node -e "const c=require('fs').readFileSync('sprints/08252100-kernel-r75-commander-retry/tests/commander-lease-expired-retry-bounded.test.ts','utf8');if(!c.includes(\"orchestrator/derive.js\"))process.exit(1)"

- [ ] [ARTIFACT] Brain 版本四处 bump 到 1.273.140（package.json）
  Test: node -e "if(require('./packages/brain/package.json').version!=='1.273.140')process.exit(1)"

## BEHAVIOR 条目（五行剧本，L2=真 import derive.js 非替身，evaluator 内嵌 manual: 命令原样执行）

- [ ] [BEHAVIOR] [L2] B-01: 单条 commander infra 过期（<上限）不再挂人审
  动作: 构造含 1 条 commander infra expired 行（+首个 spawn:commander 锚）的 decisionLog，调 derive
  预期观察: derive 返回 action ≠ wait:human_review 且 reason ≠ callback_infrastructure_route_unknown（改由 coordinator 重派）
  等待预算: 0s
  留证: vitest -t 单用例绿输出 + /tmp/r75-e2e.log
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run tests/gp/f1/step3-commander-lease-expired-retry.test.js -t "单条 commander" --reporter=dot 2>&1 | grep -qE "Tests +1 passed"'

- [ ] [BEHAVIOR] [L2] B-02: 边界 累计 4 条（第 5 条前）仍不挂人审
  动作: 构造含 4 条 commander infra expired 行的 decisionLog，调 derive
  预期观察: derive 返回 action ≠ wait:human_review（第 5 条前均重派）
  等待预算: 0s
  留证: vitest -t 单用例绿输出
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run tests/gp/f1/step3-commander-lease-expired-retry.test.js -t "边界 累计4条" --reporter=dot 2>&1 | grep -qE "Tests +1 passed"'

- [ ] [BEHAVIOR] [L2] B-03: 达上限 第 5 条 expired → fail-closed wait:human_review + callbackHop 锚
  动作: 构造含 5 条 commander infra expired 行（末条 hop=112）的 decisionLog，调 derive
  预期观察: action=wait:human_review, reason=callback_infrastructure_route_unknown, callbackHop=112
  等待预算: 0s
  留证: vitest -t 单用例绿输出（含 callbackHop 断言）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run tests/gp/f1/step3-commander-lease-expired-retry.test.js -t "达上限 第5条" --reporter=dot 2>&1 | grep -qE "Tests +1 passed"'

- [ ] [BEHAVIOR] [L2] B-04: 负向 非 commander 角色（planner）infra 过期语义不变
  动作: 构造含 5 条 planner infra expired 行的 decisionLog，调 derive
  预期观察: action=spawn:planner, reason=callback_infrastructure_blocked（走既有重派，不受 commander 上限影响，永不进 commander route_unknown）
  等待预算: 0s
  留证: vitest -t 单用例绿输出
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run tests/gp/f1/step3-commander-lease-expired-retry.test.js -t "非commander角色" --reporter=dot 2>&1 | grep -qE "Tests +1 passed"'

- [ ] [BEHAVIOR] [L2] B-05: 既有 #5058 消费闭环在「达上限」场景下 6 用例全绿
  动作: 跑既有（本 sprint 更新后）#5058 测试文件全量
  预期观察: 达上限 wait+callbackHop=112、approve 后消费出口（不再 wait）、r75 未达上限不挂人审、三条负向 fail-closed 全部成立
  等待预算: 0s
  留证: vitest 该文件 6 passed 输出
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run tests/gp/f1/step3-route-unknown-review-approve-consume.test.js --reporter=dot 2>&1 | grep -qE "Tests +6 passed"'

## INV 铁律覆盖（Step 1.3 三源之一 — 逐条映射或 N/A）

- [ ] [BEHAVIOR] [L2] INV-1 纯函数可重放：derive 只依赖 decisionLog 行时序，无时钟/随机/外部 IO
  动作: 检查本改动新增段落不引入 Date/Math.random/pg
  预期观察: 实现里不出现 Date/Math.random/new Date/require('pg')；同一 decisionLog 连续两次调 derive 结果相等（由 B-03 确定性断言隐含覆盖）
  等待预算: 0s
  留证: grep 反向扫描输出（无命中）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/orchestrator/derive.js\",\"utf8\").split(\"COMMANDER_INFRA_RETRY_CAP\")[1]||\"\";if(/Date\.now|Math\.random|new Date\(|require\(.pg.\)/.test(c)){process.exit(1)}"'

- [ ] [BEHAVIOR] [L2] INV-2 fail-closed 带锚：达上限必 wait:human_review 且带 callbackHop，禁静默放行/丢锚
  动作: 构造达上限（第5条）+ 超上限（第6条）decisionLog 调 derive
  预期观察: 两例均 action=wait:human_review 且 callbackHop 为整数（= 末条 expired 行 hop）
  等待预算: 0s
  留证: B-03 + 超上限用例绿输出
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run tests/gp/f1/step3-commander-lease-expired-retry.test.js -t "达上限 第5条" --reporter=dot 2>&1 | grep -qE "Tests +1 passed" && npx vitest run tests/gp/f1/step3-commander-lease-expired-retry.test.js -t "超上限 第6条" --reporter=dot 2>&1 | grep -qE "Tests +1 passed"'

- [ ] [BEHAVIOR] [L2] INV-3 禁 mock 被改的边：合同测试真 import derive.js，无 vi.mock/stub 该边
  动作: 扫描三测试文件是否 mock 了 derive / infrastructureRetryForCallback
  预期观察: 三文件均 import 真 derive.js，无 vi.mock 命中被改边
  等待预算: 0s
  留证: grep 反向扫描输出（无命中）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && ! grep -rEn "vi\.mock|jest\.mock|infrastructureRetryForCallback\s*=|stub\(" tests/gp/f1/step3-commander-lease-expired-retry.test.js tests/gp/f1/step3-route-unknown-review-approve-consume.test.js sprints/08252100-kernel-r75-commander-retry/tests/commander-lease-expired-retry-bounded.test.ts'

- [ ] INV-4 多账号授权隔离：N/A —— 本 sprint 是 kernel 内部纯函数路由，不触及跨账号资源操作（PRD 明示该铁律与本后端变更无关，仅登记）

## 版本同步

- [ ] [BEHAVIOR] [L2] 版本四处同步（package.json / package-lock.json / .brain-versions / DEFINITION.md）
  动作: 跑仓库版本同步校验脚本
  预期观察: 四处版本一致（1.273.140），check-version-sync 通过
  等待预算: 0s
  留证: check-version-sync.sh 输出「All version files in sync」
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && bash scripts/check-version-sync.sh'
