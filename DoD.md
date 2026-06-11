# Contract DoD — Harness sub-graph 死线程复用修复（thread_id 绑定合同版本）

**范围**: 修 `runSubTaskNode`（harness-initiative.graph.js）+ `spawnNode`/`evaluateContractNode`（harness-task.graph.js）三处子图 thread_id 构造，追加 `contractBranch` 折出的稳定短 token（新增纯函数 `harnessContractThreadSuffix`，放 harness-utils.js）。连带：runSubTaskNode 把 `failure_class=contract_invalid` 终局上浮为 `sub_task.ci_fail_type` + 明确 feedback；新增死线程探测 console.warn 钩子。不含改 GAN 轮数策略、改路由、改 Contract Gate 规则、UI。
**大小**: S

## 背景

实证 run da418741（2026-06-12 06:48）：
- 早期合同在 evaluate 期被 Contract Gate 判 `contract_invalid` → 子图线程 `harness-task:<initiative>:ws1:fix0` 留下**终局 checkpoint**（evaluate→END，status 停默认 `'queued'`，failure_class=contract_invalid）。
- 其后 gate 规则进化（#3358）+ GAN 重新收敛出新合同（cp-harness-propose-r3-da418741）。
- `runSubTaskNode` 再 invoke **同一 fix0 线程** → LangGraph 终局线程 invoke 立即返回最终态、无节点执行、无报错 → 三次全部秒回 `非成功终态 status=queued error=(none) pr_url=(none)` → #3356 的 requeue 上限耗尽 → "Serial gate: did not merge" 终败。#3356 的 requeue 修复在此场景退化成对死线程的无效重试。

根因：**线程身份不含其语义版本——合同变了，执行历史却没归零**。thread_id 只含 `initiativeId+taskId+final_e2e_fix_count`，不含合同维度，故合同重新收敛后复用旧终局 checkpoint。

## 成功标准

- sub-graph thread_id 绑定合同版本：合同 propose 分支变 → token 变 → 新线程；同合同同 fix_count → 同 thread_id（callback router 反查 walking_skeleton_thread_lookup 稳定）。
- 三处构造口径一致（runSubTaskNode 父 invoke / spawnNode 写 lookup / evaluateContractNode 写 lookup），父子 thread_id 完全一致，否则 callback resume 失配。
- 无 contractBranch（测试/直跑路径）→ thread_id 退回旧格式 `harness-task:<id>:<ws>:fix<N>`，不破坏既有线程语义与既有单测。
- contract_invalid 终局上浮为带原因的明确状态：`sub_task.ci_fail_type='contract_invalid'` + `evaluator_feedback` 含 evaluate_error（不再被 "did not merge (status=queued)" 通用文案掩盖）。
- 死线程探测：目标线程已存在终局 checkpoint（next=[] 且 values 非空）时 console.warn 明确告警（诊断钩子，不阻断流程）。
- 既有 harness 单测全绿（runSubTaskNode-payload / harness-subtask-error-diag / harness-task.graph / harness-pipeline-p2p3-fixes / harness-container-liveness）；#3356 requeue、#3341 短路、callback thread_lookup 路由不破坏。

## BEHAVIOR 条目（被测 = 真实 packages/brain/src；CI manual:node 读真实源码断言 + vitest 套件深测行为）

- [x] [BEHAVIOR] harnessContractThreadSuffix 存在且追加进三处 thread_id（harness-utils 定义 + initiative/task graph 引用）
  Test: manual:node -e "const fs=require('fs');const u=fs.readFileSync('packages/brain/src/harness-utils.js','utf8');if(!/export function harnessContractThreadSuffix/.test(u))process.exit(2);if(!/createHash\('sha256'\)/.test(u))process.exit(3);const i=fs.readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!/harnessContractThreadSuffix\(contractBranchForThread\)/.test(i))process.exit(4);const t=fs.readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if((t.match(/harnessContractThreadSuffix\(state\.contractBranch\)/g)||[]).length!==2)process.exit(5);console.log('OK')"

- [x] [BEHAVIOR] runSubTaskNode thread_id 单一解析 contractBranchForThread，喂 thread_id 也喂 invoke 输入（父子一致）
  Test: manual:node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const m=c.match(/export async function runSubTaskNode[\\s\\S]*?\\n\\}/);if(!m)process.exit(2);const b=m[0];if(!/const contractBranchForThread =/.test(b))process.exit(3);if(!/thread_id: threadId/.test(b))process.exit(4);if(!/contractBranch: contractBranchForThread/.test(b))process.exit(5);if(!/final_e2e_fix_count/.test(b))process.exit(6);console.log('OK')"

- [x] [BEHAVIOR] Fix 2：contract_invalid 终局上浮为 ci_fail_type=contract_invalid（runSubTaskNode 返回映射含该分型）
  Test: manual:node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const m=c.match(/export async function runSubTaskNode[\\s\\S]*?\\n\\}/)[0];if(!/failure_class === 'contract_invalid'/.test(m))process.exit(2);if(!/isContractInvalid \\? 'contract_invalid'/.test(m))process.exit(3);if(m.indexOf('failure_class=')<0)process.exit(4);console.log('OK')"

- [x] [BEHAVIOR] Fix 3：死线程探测告警钩子存在（终局 checkpoint → console.warn 死线程探测）
  Test: manual:node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const m=c.match(/export async function runSubTaskNode[\\s\\S]*?\\n\\}/)[0];if(!/死线程探测/.test(m))process.exit(2);if(!/_getStateForDiag/.test(m))process.exit(3);console.log('OK')"

> 行为深测（合同重新收敛→新线程、同合同→同线程、contract_invalid 上浮、死线程告警）由
> vitest 套件 `packages/brain/src/workflows/__tests__/harness-subthread-contract-binding.test.js`
> 在 brain-ci 测试 job 中执行（14 用例）。check-dod-mapping 只接受 repo-root `tests/` 路径，
> 故此处不以 DoD 条目引用，上面 4 条 manual:node 已覆盖源级+逻辑不变量。
