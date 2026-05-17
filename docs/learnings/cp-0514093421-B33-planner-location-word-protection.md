# B33 — Planner 位置词死规则（W43 实证）

## 根本原因

thin_prd 含位置词 "playground" 时，Planner 未识别位置约束，把 endpoint 写到了
`packages/brain/src/routes/status.js`（`GET /api/brain/ping`），而非 thin_prd 指定的
`playground/server.js`（`GET /ping`）。

B20 的主题词死规则只防止 endpoint 名称漂移（/ping→/health-check），不防止模块位置漂移
（playground→Brain）。

## 下次预防

- [ ] thin_prd 含位置词时，planner Step 0 第二件事检查位置词 → 映射到对应模块
- [ ] 四个位置词映射关系已固化到 SKILL.md Step 0 位置词死规则（B33）
- [ ] 验证 thin_prd 含 "playground" 时，generator PR 的改动文件在 playground/ 下
