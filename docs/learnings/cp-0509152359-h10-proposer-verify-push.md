# Learning: H10 — proposer 节点 verify origin push

**PR**: cp-0509152359-h10-proposer-verify-push
**Sprint**: langgraph-contract-enforcement / Stage 1（4/4 收官）

## 现象

W8 v10 跑里 proposer r3 容器 exit=0 但 cp-harness-propose-r3-* 分支没 push 到 origin → inferTaskPlan 节点 git show 失败 → graph 卡死。看 stderr 没明确 root cause，14h 诊断绕远路。

### 根本原因

brain 把 docker `exit_code=0` 直接等同于节点 success。proposer 节点跑完只读容器 stdout（解析 propose_branch）和本地 worktree（读 contractContent + access task-plan.json），但 origin 上 branch + task-plan.json 真不真存在 brain 完全不验。proposer 容器内部 SKILL 的 git push 失败被 set -e 静默吞，或某些 race 让本地 commit 但没 push 到 origin —— brain 看不出区别。

哲学层根因：LangGraph 节点是 (state) → state_delta 形态时，节点的"成功"应基于**实际副作用 happened** 而不是**子进程 exit code**。LLM/容器节点必须在 return 前显式 verify 它该交付的产出（push、PR、commit、API call 等）。这是 LangGraph community standard "Best Practices for Agent Loop"。Stage 2 应抽 packages/brain/src/lib/contract-verify.js 把这层显式化。

### 下次预防

- [ ] 任何 LangGraph 节点跟 LLM/容器交互产出"远端副作用"（git push / PR create / API call），return 前必须 brain-side verify
- [ ] LLM/容器节点 default 加 retryPolicy: LLM_RETRY，让瞬时网络抖动不让 graph fail
- [ ] PR review 凡涉及 LangGraph 节点改动，问"它的副作用是什么 / brain 怎么验"
