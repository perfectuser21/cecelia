# Learning — Harness sub-graph 死线程复用（thread_id 必须绑定合同版本）

**分支**: cp-06120655-subthread-contract-binding
**实证 run**: da418741（2026-06-12 06:48）
**P1**: 合同经 GAN 重新收敛后，run_sub_task 复用带旧终局 checkpoint 的线程，invoke 秒回死状态

## 教训（一句话）

**线程身份必须包含其语义版本——合同变了，执行历史就该归零。**

## 现象

run da418741 的 sub_task ws1 三次推进全部秒回 `非成功终态 status=queued error=(none) pr_url=(none)`，无任何节点执行、无报错日志，最终 "Serial gate: did not merge" 终败。#3356 的 requeue 上限被无效重试耗尽。

## 根本原因

LangGraph 子图 thread_id 只由 `initiativeId + subTaskId + final_e2e_fix_count` 构成，**不含合同版本维度**。

时间线：
1. 早期合同在 evaluate 期被 Contract Gate 判 `contract_invalid` → `routeAfterEvaluate` 直接 END。该 END 路径**不写 status**（停在默认 `'queued'`），故子图线程 `harness-task:<init>:ws1:fix0` 留下一个 **终局 checkpoint**（next=[]，status='queued'，failure_class='contract_invalid'）。
2. gate 规则进化（#3358）+ GAN 重新收敛出新合同（新 propose 分支）。
3. `runSubTaskNode` 用**同一个 fix0 thread_id** 再 invoke → LangGraph 对已到 END 的线程 invoke 会**立即返回最终态、不执行任何节点**（next 为空 = 无 pending task）→ 秒回 status='queued'。
4. 父图把 'queued' 当非成功终态，requeue 重试，每次重试又落到同一死线程 → 三连空转 → #3356 上限耗尽 → 终败。

两个叠加缺陷：
- **主因**：thread_id 不绑合同，新合同复用旧终局线程。
- **掩盖因**：contract_invalid 终局只在子图 state 里留 `failure_class`/`evaluate_error`，`runSubTaskNode` 返回映射没读它，父层只看到通用 status=queued → 排障得靠日志拼时间线。

## 修复

1. 新增纯函数 `harnessContractThreadSuffix(contractBranch)`（harness-utils.js）：把 contractBranch 折成 `:c<8位sha256hex>` 稳定短 token；null/'' → 空串（向后兼容旧格式）。
2. 三处子图 thread_id 构造统一追加该后缀，口径一致（否则 callback router 反查 walking_skeleton_thread_lookup 失配）：
   - `runSubTaskNode`（父 invoke，决定 checkpoint thread）
   - `spawnNode`（写 thread_lookup）
   - `evaluateContractNode`（写 thread_lookup）
   合同重新收敛 → propose 分支变 → token 变 → **新线程**，执行历史归零。
3. 连带（掩盖因）：`runSubTaskNode` 把 `failure_class=contract_invalid` 上浮为 `sub_task.ci_fail_type='contract_invalid'` + feedback 含 evaluate_error；warn 日志带 failure_class。
4. 防御：`runSubTaskNode` invoke 前 getState 探测目标线程是否已是终局 checkpoint（next=[] 且 values 非空）→ console.warn「死线程探测」诊断钩子（合同绑定后正常应是 fresh，告警=绑定失效信号）。

## 下次预防

- [ ] 任何 LangGraph 子图 thread_id 设计，必须问：**这个线程的"输入语义"会不会在重试间变化？** 会变（合同/PRD/spec 重新生成）就必须把该语义版本编进 thread_id，否则复用旧终局 checkpoint。
- [ ] 子图任何 END 路径若不显式写 status，父层就会看到默认 'queued' 误判——终局态必须写明确 status 或父层按 failure_class 分型，不能只靠 status。
- [ ] requeue/retry 类修复（如 #3356）上线后要问：**重试会不会落到同一个死线程？** 若是，requeue 只是放大无效重试，不是修复。
