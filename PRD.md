# PRD: Harness v2 M6 — Initiative Dashboard

详见 docs/design/harness-v2-prd.md §6.7。
本 PR 实现 Dashboard 层：后端 DAG API + 前端 InitiativeDetail + 新建按钮 + 飞书通知 + Report SKILL。

## 成功标准
/api/brain/initiatives/:id/dag 返回完整 DAG；前端 /initiatives/:id 渲染 Mermaid + 3 阶段 + 成本；列表页新建按钮切 v1/v2；harness v2 关键事件推飞书；harness-report SKILL 含 Initiative 级报告章节。
