---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: coding 路由收归 kernel（改代码任务派发打标强制进 harness，决策 bf361265）

**范围**: `packages/brain/src/task-router.js`（改代码识别白名单 + `classifyCodeChange`/`resolveDispatchChannel` 纯函数）、`packages/brain/src/dispatcher.js`（spawn 前 reroute 到 kernel + `code_change`/`gear`/`origin_task_type` 打标 + 幂等）、`packages/brain/src/__tests__/coding-route-kernel.test.js`（回归测试）。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 回归测试文件存在且含 reroute 断言（断言 spawn 层收到 task_type='harness_initiative'）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/coding-route-kernel.test.js','utf8');if(!c.includes('harness_initiative')||!c.includes('classifyCodeChange'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] task-router.js 导出改代码分类 API（classifyCodeChange / resolveDispatchChannel / CODE_CHANGE_TASK_TYPES）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');if(!/export\s+(function|const)\s+classifyCodeChange/.test(c)||!c.includes('resolveDispatchChannel')||!c.includes('CODE_CHANGE_TASK_TYPES'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（五行剧本 + 内嵌 manual:bash 单行命令；autonomous / local_api / brain-unit vitest）

- [ ] [BEHAVIOR] [L2] B-01: 改代码识别—dev/codex_dev → code_change=true & channel=kernel（真实 task-router）
  动作: 调 `classifyCodeChange({task_type:'dev'})` 与 `resolveDispatchChannel`（vitest 真跑，不 mock task-router）
  预期观察: dev/codex_dev 返回 code_change=true 且 channel='kernel'；CODE_CHANGE_TASK_TYPES 含 codex_dev
  等待预算: 0s
  留证: vitest 输出末行（`Tests  N passed`）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/coding-route-kernel.test.js -t "判定改代码" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-02: 非改代码 research/arch_review/talk/data → code_change=false & channel=legacy（Invariant 非改代码不受影响）
  动作: 调 `classifyCodeChange` / `resolveDispatchChannel` 逐个校验非白名单 task_type
  预期观察: 四类均返回 code_change=false 且 channel='legacy'
  等待预算: 0s
  留证: vitest 输出末行
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/coding-route-kernel.test.js -t "非改代码 task_type=research" --reporter=dot'

- [ ] [BEHAVIOR] [L1] B-03: dev 改代码任务派发 → spawn 层收到 reroute+打标（真跑 dispatchNextTask，db/executor 边界为替身）
  动作: `dispatchNextTask(['goal-1'])` 派发一个 task_type=dev 的改代码任务，spy `triggerCeceliaRun`
  预期观察: triggerCeceliaRun 单次调用，入参 task_type='harness_initiative' 且 payload.code_change===true 且 payload.gear ∈ {default,hotfix,segmented} 且 payload.origin_task_type==='dev'
  等待预算: 0s
  留证: vitest 输出末行 + 断言通过计数
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/coding-route-kernel.test.js -t "dev 改代码任务派发" --reporter=dot'

- [ ] [BEHAVIOR] [L1] B-04: 非改代码 research 任务派发 → task_type 不变、无 code_change 标（Invariant 行为不变）
  动作: `dispatchNextTask(['goal-1'])` 派发一个 task_type=research 任务
  预期观察: triggerCeceliaRun 入参 task_type='research' 不变，payload.code_change===undefined
  等待预算: 0s
  留证: vitest 输出末行
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/coding-route-kernel.test.js -t "非改代码 research 任务派发" --reporter=dot'

- [ ] [BEHAVIOR] [L1] B-05: 重复派发打标幂等 → 不二次 reroute、origin_task_type 不被覆盖
  动作: 派发一个已是 task_type='harness_initiative' 且 payload.code_change=true 的任务
  预期观察: triggerCeceliaRun 单次调用，payload.origin_task_type 仍为 'dev'（未被覆盖成 harness_initiative）
  等待预算: 0s
  留证: vitest 输出末行
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/coding-route-kernel.test.js -t "幂等" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-06: 既有 dev 派发链回归全绿（reroute 不破 triggerCeceliaRun 单调同 id / 非 dev 不变 / skill-relay 降级）
  动作: 跑既有回归 `dispatcher-dev-no-langgraph.test.js` 全文件
  预期观察: 6 passed（triggerCeceliaRun 单次调用且同 id、runtime≠v2、code_review 行为不变、skill-relay executor=codex 保留）
  等待预算: 0s
  留证: vitest 输出末行（`Tests  6 passed`）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/dispatcher-dev-no-langgraph.test.js --reporter=dot'

## Invariant 覆盖（铁律逐条映射）

- [ ] [BEHAVIOR] INV-1 [非改代码不受影响] 非改代码 task_type 派发行为不变——由 B-02（分类层）+ B-04（派发层）双向守
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/coding-route-kernel.test.js -t "非改代码 research 任务派发" --reporter=dot'

- [ ] [BEHAVIOR] INV-2 [不动provider] reroute 只 merge payload、保留 provider/executor/orchestrator 语义——由 dispatcher-dev-no-langgraph 的 skill-relay 降级用例（executor=codex 仍生效）守
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain" && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/dispatcher-dev-no-langgraph.test.js -t "codex" --reporter=dot'

- INV-3 [不动merge闸] N/A：本 sprint 改动仅限 dispatcher.js / task-router.js 派发层，不触及 merge 裁决闸模块（归任务 51740e13）。
