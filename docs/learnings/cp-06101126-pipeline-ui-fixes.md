## cp-06101126 Pipeline UI Fixes

### 根本原因

1. **Mermaid 方向错误**：`HARNESS_MERMAID` 使用 `graph TD`（从上到下），导致节点纵向排列占用大量垂直空间。Pipeline 拓扑是线性的（Start→Planner→Proposer→...），从左到右更紧凑。

2. **Pipeline 标题空白（"未命名"）**：`pipeline-detail` 端点通过 `task_type === 'sprint_planner'` 找 planner 任务，但新 LangGraph Pipeline 入口类型是 `harness_initiative`，导致 planner 为 null，进而 `title` 读不到。

### 下次预防

- [ ] 新增 task_type 时同步更新 `pipeline-detail` 里的类型匹配逻辑
- [ ] Mermaid 架构图方向：线性 pipeline 用 `graph LR`，树状用 `graph TD`
