# Learning — C8b content-pipeline 真图加固

## 背景
PRD: docs/superpowers/specs/2026-04-25-c8b-content-pipeline-hardening-design.md
Brain task: d5434582-f6ca-45fa-bb04-78e1b090d0fe
分支: cp-0425203339-c8b-content-pipeline-graph

## 干了什么
content-pipeline.graph.js（已是 6 节点真图）加 3 加固：
- runDockerNode 顶部加 6 节点幂等门 (cfg.outputs[0] 兜底取 primary output)
- compileContentPipelineApp 改 async + 默认 getPgCheckpointer
- 3 个非 verdict 节点 (research/copywrite/generate) plain edge 改 conditional + stateHasError 短路
- verdict 节点 (copy_review/image_review) 完全不动（保留 round>=3 兜底）

## ⚠️ Handoff §4 PRD 错误
原 handoff §4 假设 content-pipeline 是 625 行单 function，事实已是 C5 完成的 6 节点真图。
入口（research subagent 调研发现）：

### 根本原因
LangGraph resume 时会 replay 上次未完成节点 → 重 spawn 起重复容器，烧 docker / LLM / 时间。
原 compileContentPipelineApp 默认 MemorySaver → Brain 重启即丢 state，所有持久化能力依赖 caller 显式传 checkpointer。
原 buildContentPipelineGraph 的 plain edge 在节点 error 时仍按拓扑流到下游 → 下游拿空数据继续 spawn。
verdict 节点（copy_review/image_review）docker flake 设 state.error 但保留 verdict — 直接 error → END 会破坏 round>=3 兜底语义。

### 下次预防
- [ ] 加新 LangGraph 真图节点时，runDockerNode 顶部模板化加幂等门（cfg.outputs[0] 兜底）
- [ ] compileXxxApp 默认应走 getPgCheckpointer 单例（不依赖 caller 显式传）
- [ ] plain addEdge 改 conditional + stateHasError 仅适用于"错了就该 END"的非 verdict 节点
- [ ] verdict 节点（含 round 兜底）docker flake 由 verdict 路由本身吸收，不要前置 stateHasError
- [ ] handoff PRD 与代码现状脱节时，research subagent 必须先验代码现状再启动 brainstorming
