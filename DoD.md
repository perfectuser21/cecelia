# Contract DoD — harness 子图 END 终态补全 + ARTIFACT 门依赖注入/环境 fail-open

**范围**: 一个 PR 批量修两个已诊断问题。(1) `packages/brain/src/workflows/harness-task.graph.js`
子图所有通向 END 的边在 END 前写明确终态（status）；(2) 同文件 ARTIFACT 门
（`runArtifactGate` / `verifyContractArtifactsForPr`）注入 NODE_PATH 指向宿主仓库 node_modules +
依赖/环境类错误 fail-open。不含改 GAN 轮数、改路由拓扑、改 Contract Gate 规则、UI。
**大小**: S

## 背景

- **问题 1**（run cf4f596c 2026-06-12 08:24 实证）：harness-task 子图存在"END 不写终态"的残余路径。
  #3361 只修了 contract_invalid 那条 END 的状态上浮；合同绑定的新线程 `fix0:c29dcc609` 仍走到
  `next=[], status=queued` 的终局 checkpoint。说明子图还有其他 END 边不写 status，停在 status
  channel 默认值 `'queued'` → 父 `runSubTaskNode` getState 读到 queued → Serial gate 误读为
  "did not merge (status=queued)"。
- **问题 2**（run 56b5cc39 2026-06-12 08:24 brain 日志实证）：`verifyContractArtifactsForPr` 把 PR
  分支 checkout 到 /tmp 临时目录跑 DoD [ARTIFACT] 命令，命令 `node -e "import('./src/harness-shared.js')..."`
  因临时目录无 node_modules 报 `Cannot find package 'zod'` → 门 FAIL → 打回 generator（修不了环境）。

## 成功标准

- harness-task 子图每条通向 END 的边都在 END 前写明确终态；invoke 终局线程读到非 `'queued'` 的明确
  状态（no_pr / timeout / failed / contract_invalid / merged）。
- ARTIFACT 门临时 checkout 执行命令时注入 `NODE_PATH=<宿主仓库>/node_modules`；命令因依赖/环境类错误
  （Cannot find package / MODULE_NOT_FOUND）失败 → 该条 fail-open 记 warning 跳过，真断言失败照旧 FAIL。
- 回归不破坏：#3356 / #3361 / #3341 / callback thread_lookup 路由全绿。

## END 路径审计表（图的每条 END 边都是 API，每条 END 前写明确终态）

| 节点 / 路由 → END | 触发条件 | 终局 status | 本 PR 改动 |
|---|---|---|---|
| spawn / routeAfterSpawn → end | prep/spawn 抛错 | `failed` | 既有（spawnNode 三处 error 均带 status:failed） |
| await_callback / routeAfterCallback → end | 持久 error（节点不 set error，不可达） | 上游携带 `failed` | 不变（invariant 保证） |
| parse_callback / routeAfterParse → end | 持久 error（节点不 set error，不可达） | 上游携带 | 不变 |
| **parse_callback / routeAfterParse → no_pr** | generator 无 pr_url | **`no_pr`** | **新增**（此前漏写→queued，run cf4f596c 实证） |
| **poll_ci / routeAfterPoll → timeout** | poll_count ≥ MAX_POLL_COUNT | **`timeout`** | **新增**（此前漏写→queued） |
| **poll_ci / routeAfterPoll → end** | PR 被外部关闭 | **`failed`** | **新增**（此前只 set error 不 set status） |
| evaluate_contract / routeAfterEvaluate → merge | verdict=PASS | merge_pr 写 `merged` | — |
| **evaluate_contract / routeAfterEvaluate → end** | failure_class=contract_invalid | **`contract_invalid`** | **新增子图层 status**（外层 #3361 上浮保留兜底） |
| evaluate_contract → fix | 普通实现缺陷 FAIL | 非终局（进 fix loop） | — |
| merge_pr / routeAfterMergePr → end (success) | 合并/已合并 | `merged` | 既有 |
| **merge_pr / routeAfterMergePr → end (error)** | 无 pr_url / CONFLICTING / 不可恢复 / rebase 耗尽 / update-branch 失败 | **`failed`** | **新增**（5 处 error 返回均补 status:failed） |
| merge_pr → poll | BEHIND → update-branch 重排 | 非终局 | — |
| fix_dispatch / routeAfterFix → end | 持久 error（节点不 set error，不可达） | 上游携带 | 不变 |

**Invariant**：每个会 set `state.error` 的节点（spawn / poll_ci / merge_pr）同时 set `status:'failed'`；
每条非 error 终局路径（no_pr / timeout / contract_invalid / merged）显式写 status。故任意 END 的终局
checkpoint `status` 必非默认 `'queued'`。

## BEHAVIOR 条目（被测 = 真实 packages/brain/src；CI manual:node 读真实源码断言不变量；行为深测见 vitest 套件）

- [x] [BEHAVIOR] parse_callback no_pr 终局写 status='no_pr'（此前漏写路径之一）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!/if \(!pr_url\) \{[\s\S]{0,160}status: 'no_pr'/.test(c))process.exit(2);console.log('OK')"

- [x] [BEHAVIOR] poll_ci timeout 终局写 status='timeout'（此前漏写路径之二）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes(\"ci_status: 'timeout', status: 'timeout'\"))process.exit(2);console.log('OK')"

- [x] [BEHAVIOR] merge_pr 与 poll_ci closed 失败终局写 status='failed'（END 不留 queued）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');const n=(c.match(/status: 'failed', error: \{ node: 'merge_pr'/g)||[]).length;if(n<4)process.exit(2);if(!/status: 'failed',\s*\n\s*poll_count: pollCount \+ 1,\s*\n\s*error: \{ node: 'poll_ci'/.test(c))process.exit(3);console.log('OK')"

- [x] [BEHAVIOR] evaluate_contract contract_invalid 终局子图层写 status='contract_invalid'
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!/status: 'contract_invalid',\s*\n\s*failure_class: 'contract_invalid'/.test(c))process.exit(2);console.log('OK')"

- [x] [BEHAVIOR] ARTIFACT 门注入宿主 NODE_PATH（HOST_NODE_PATH + artifactGateEnv 注入 node 子进程 env）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!/export const HOST_NODE_PATH/.test(c))process.exit(2);if(!/export function artifactGateEnv/.test(c))process.exit(3);if(!/env: artifactGateEnv\(o\.nodePath\)/.test(c))process.exit(4);console.log('OK')"

- [x] [BEHAVIOR] ARTIFACT 门依赖/环境错误 fail-open 跳过（isDependencyError → skipped，不计 FAIL）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!/export function isDependencyError/.test(c))process.exit(2);if(!/Cannot find package\|ERR_MODULE_NOT_FOUND\|MODULE_NOT_FOUND/.test(c))process.exit(3);if(!/skipped\.push\(/.test(c))process.exit(4);console.log('OK')"

> 行为深测（no_pr/timeout invoke 终局 status 非 queued、merge/poll 失败终态、contract_invalid 终态、
> 依赖错误 fail-open 跳过 vs 真失败 FAIL、NODE_PATH 注入）由 vitest 套件
> `packages/brain/src/__tests__/harness-end-status-and-gate-deps.test.js`（18 用例）在 brain-ci 测试
> job 中执行。
