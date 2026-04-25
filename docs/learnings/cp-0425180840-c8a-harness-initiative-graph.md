# Learning — C8a harness-initiative 真图重设计

## 背景
PRD: docs/design/brain-v2-c8-d-e-handoff.md §3
Spec: docs/superpowers/specs/2026-04-25-c8a-harness-initiative-graph-design.md
Brain task: e4d08a28-3dc4-42b0-b25e-3c8e8ef939f2

## 干了什么
把 packages/brain/src/workflows/harness-initiative.graph.js 阶段 A 的 528 行单 function `runInitiative` 改造为 5 节点 LangGraph 状态机：
- prep → planner → parsePrd → ganLoop → dbUpsert → END
- 每节点首句幂等门 (`if state.X return ...`) 解 C6 smoke 的 spawn replay 问题
- legacy runInitiative 528 行原状保留
- env flag `HARNESS_INITIATIVE_RUNTIME=v2` 切换两套实现，灰度推进
- workflows/index.js 用 listWorkflows() 幂等检查并注册 harness-initiative
- executor.js L2807 加 v2 gate 走 runWorkflow

### 根本原因
Brain v2 Phase C2/C3 时 .graph.js 文件名字带 graph 但实质是 runner（单 function）。导致 1-2h harness-initiative 任务在 Brain 重启时清零（无节点级 checkpoint）。C8a 是把它升级为真 LangGraph 图的第一棒。

### 下次预防
- [ ] 加新 workflow 文件时，文件命名严格遵守约定：`.graph.js` = StateGraph 真实现，`.runner.js` = 单 function。审查时 grep `addNode\|StateGraph` 验证
- [ ] LangGraph 真图节点必加幂等门：每节点首句 `if (state.X) return { X: state.X }`，否则 resume replay 会重 spawn 容器
- [ ] env flag 灰度 — legacy 路径必须保留至少 1 周生产观察期，确认 v2 稳定后才删
- [ ] workflows/index.js 注册新 workflow 用 listWorkflows() 检查（不要单个 getWorkflow try/catch），多 workflow 共存幂等
- [ ] phase 拆分边界：阶段 A 进图，阶段 C 函数（runPhaseCIfReady 等）保留独立 export 不进图——避免一次重构耦合
