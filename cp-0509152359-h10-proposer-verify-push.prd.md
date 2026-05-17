# PRD: H10 proposer 节点 verify origin push

**Brain task**: 9f2e58dd-86ac-4738-9c89-6d3c8fce281f
**Spec**: docs/superpowers/specs/2026-05-09-h10-proposer-verify-push-design.md
**Sprint**: langgraph-contract-enforcement / Stage 1 (4/4)

## 背景

W8 v10 跑里 proposer r3 容器 exit=0 但 cp-harness-propose-r3-* 分支没 push 到 origin → inferTaskPlan 节点 git show 失败 → graph 卡死。brain 把 docker exit_code=0 等同节点 success，没主动验证 proposer 实际产出的远端 branch + task-plan.json。

## 修法

harness-gan.graph.js：
1. import fetchAndShowOriginFile + LLM_RETRY
2. createGanContractNodes ctx 加 fetchOriginFile DI（默认 = fetchAndShowOriginFile）
3. proposer 节点 return 前调 fetchOriginFile(worktreePath, proposeBranch, sprintDir+'/task-plan.json')，失败 throw 'proposer_didnt_push: ...'
4. buildHarnessGanGraph 给 proposer 节点加 retryPolicy: LLM_RETRY（3 次 backoff retry）

## 成功标准

- proposer 容器 exit=0 但 origin 没 propose_branch + task-plan.json 时，节点 throw 'proposer_didnt_push'，LangGraph retry 3 次后整 graph fail（强信号曝露 push creds 问题，不是 silent 推到 inferTaskPlan）
- proposer push 成功时节点正常 return

## 不做

- 不改 reviewer / inferTaskPlan / sub-task graph
- 不引入 needs_retry / error 字段到 GanContractState
- 不动 proposer 容器内部 SKILL
- 不引入完整 contract enforcement layer（stage 2 范围）
