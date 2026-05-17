# Learning — B20 Planner 偏 thin_prd 主题

### 根本原因

W41 实证 planner 把 task title "B19 修后真验" 当主题，忽略 thin_prd "加 /ping" → 写成"测 B19 演练"PRD → 下游 generator/evaluator 按错合同跑 → final_evaluate FAIL。

### 下次预防

- [x] Planner skill Step 0 强制 thin_prd 主题字面照搬
- [x] 禁止 task title 当主题（title 是元数据）
- [x] 自查 checklist grep PRD 含 thin_prd 关键词字面
