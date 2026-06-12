# Contract DoD — harness 子图 fix loop 感知任务终态（在飞执行不感知终态 P2 修复）

**范围**: `packages/brain/src/workflows/harness-task.graph.js` 在 spawn / fix_dispatch / evaluate 三个
起容器入口前查 `tasks.status`（新增 `isInitiativeTerminal`）。initiative 已 failed/completed →
写明确终态 `status='aborted'` 走 END，不再 spawn generator/evaluator。不含改 GAN、改路由拓扑、UI。
**大小**: S

## 背景

实证（run cf4f596c 2026-06-12 08:28-08:34）：initiative cf4f596c 已被标 `failed` 后，其**进程内图
实例**的 fix loop 仍每 ~2 分钟 spawn 一个 generator（r5、r6…），直到手动重启 Brain 才停。这是 P2
Issue「在飞执行不感知任务终态」的最强实证——子图 fix loop 只看自己内部 verdict，从不回查任务是否
已被外层/Serial gate 判终态。

## 成功标准

- harness-task 子图 fix loop 路由边 + generator/evaluator spawn 节点入口，在每次 spawn 前查
  `tasks.status`；任务已 `failed`/`completed`/`cancelled`/`aborted` → 直接走 END，写明确终态
  `status='aborted'`（与 #3364 END 终态口径一致）。
- 任务标 failed 后 fix 路由不再 spawn（fixDispatchNode 返回 aborted + error → routeAfterFix→end）。
- fail-open：查不到任务行/DB 查询失败 → terminal=false，不误杀在飞 run（仅 warn）。
- 回归不破坏：#3356 / #3361 / #3364 / #3341 / callback 路由全绿；in_progress 任务正常 fix loop。

## 终态门覆盖点

| 入口 | 触发 | 终态后行为 | 路由 → END |
|---|---|---|---|
| spawnNode（generator，含 fix loop 重 spawn） | initiative terminal | 返回 `status='aborted'` + error，不调 spawnDetached/ensureWorktree | routeAfterSpawn error→end |
| fixDispatchNode（fix loop 路由边） | initiative terminal | 返回 `status='aborted'` + error，不 ++fix_round/不 reset containerId | routeAfterFix error→end |
| evaluateContractNode（evaluator） | initiative terminal | 返回 `status='aborted'` + verdict=FAIL，不调 spawnDetached | routeAfterEvaluate status==='aborted'→end |

## BEHAVIOR 条目（被测 = 真实 packages/brain/src；CI manual:node 读真实源码断言；行为深测见 vitest 套件）

- [x] [BEHAVIOR] isInitiativeTerminal 存在且查 tasks.status，终态集合含 failed/completed/cancelled
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!/export async function isInitiativeTerminal/.test(c))process.exit(2);if(!/SELECT status FROM tasks WHERE id/.test(c))process.exit(3);if(!/TERMINAL_TASK_STATUSES = new Set\(\['failed', 'completed', 'cancelled'/.test(c))process.exit(4);console.log('OK')"

- [x] [BEHAVIOR] fixDispatchNode 起手查终态：terminal → status=aborted + error(node=fix_dispatch)，先于 ++fix_round
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');const m=c.match(/export async function fixDispatchNode[\s\S]*?\n\}/)[0];if(!/isInitiativeTerminal/.test(m))process.exit(2);if(!/status: 'aborted', error: \{ node: 'fix_dispatch'/.test(m))process.exit(3);if(m.indexOf('isInitiativeTerminal')>m.indexOf('fix_round || 0'))process.exit(4);console.log('OK')"

- [x] [BEHAVIOR] spawnNode 幂等门后查终态：terminal → status=aborted（不起 generator）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!/status: 'aborted', error: \{ node: 'spawn'/.test(c))process.exit(2);console.log('OK')"

- [x] [BEHAVIOR] evaluateContractNode 幂等门后查终态 + routeAfterEvaluate aborted→end
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!/status: 'aborted',\s*\n\s*evaluate_verdict: 'FAIL'/.test(c))process.exit(2);if(!/if \(state\.status === 'aborted'\) return 'end'/.test(c))process.exit(3);console.log('OK')"

> 行为深测（failed/completed/cancelled→terminal、in_progress/无行/查询抛错→fail-open、fix 路由
> aborted→end vs in_progress→spawn、spawn/evaluate 终态后不 spawn）由 vitest 套件
> `packages/brain/src/__tests__/harness-fixloop-terminal-abort.test.js`（12 用例）在 brain-ci 测试
> job 中执行。
