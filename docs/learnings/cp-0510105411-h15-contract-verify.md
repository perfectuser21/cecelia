# Learning: H15 — contract-verify.js 治本第一步

**PR**: cp-0510105411-h15-contract-verify
**Sprint**: langgraph-contract-enforcement / Stage 2 MVP
**Date**: 2026-05-10

## 现象

12+ hour 修了 8 个 PR (H7-H14)，每个 PR 治一个具体 bug，但 audit 揭示根因同源：把 docker exit_code=0 当节点 success，没主动验副作用。Anthropic 哲学说 evaluator 应**真跑应用看结果**；LangGraph 哲学说**节点输出 schema/副作用 validate 是用户责任**。我们偷懒 skip 了。

### 根本原因

Pipeline 治标修了 8 PR 仍存在洋葱式 bug — 因为治标只 patch 已暴露的具体崩法，没碰**节点 silent 推进的根本机制**。Anthropic 官方 long-horizon harness 明确把 validation 划在用户责任，但 Cecelia 8 days 重构没人实现 contract-verify layer。结果每个 PR 跑 vitest mock PASS 就合并，**没人真跑 W8 端到端**，5 次 fail 只暴露同根因的不同表现。

哲学层根因：**节点完成 != 副作用发生**。LangGraph 节点的"成功"应基于"它该交付的副作用真 happened"，而不是"子进程 exit 0"。Anthropic Managed Agents 抽象 evaluator/generator 为独立 sandbox tool call，brain 只 dispatch 不验证 — Cecelia 把 evaluator 跟 brain 进程耦合是 architectural 偏离。

### 下次预防

- [ ] 任何 LLM 节点 / 容器节点结束都必须 brain-side verify 副作用真发生（git push / PR / file / DB record）
- [ ] LangGraph addNode 默认配 retryPolicy 让 ContractViolation 自动 retry 3 次
- [ ] PR review 凡涉及节点新增/改动，必须 grep "exit_code === 0" 类假设，要求显式 verify 副作用
- [ ] 长期 P2 重构：evaluator 跟 generator 都解耦成独立 sandbox tool call（参考 Anthropic Managed Agents），brain 只 dispatch
- [ ] W8 类"测 brain 自身"sprint 在当前架构下不可能 status=completed，应换成测外部应用（zenithjoy lead）
