---
task_id: 4ea44bcf-780b-41e2-b150-299f1a7a5bd7
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 9
可验证: 8
场景覆盖: 8
回归风险: 8
可执行: 8

## 上轮问题
- R-1: 关闭 —— S-4 已把 `spec-review.mjs:75` 的 `made_by` 改为 `system`，并在 `spec-review.test.mjs` 里锁住；Q-5 的 body 和期望已同步为 `made_by=system`。S-2 对 made_by/priority 也在写库前校验，返回 400 并带 `allowed_made_by`/`allowed_priorities`；23514 兜底按 `err.constraint` 映射出字段名。已核对 migration 193 第 9-10 行：这些是没有显式命名的列级 CHECK，Postgres 自动命名为 `decisions_made_by_check`/`decisions_priority_check`，和 S-2 的映射表一致，查不到时回落为「未知」，不会泄漏约束原文。另外新增 Q-7 做预览环境黑盒验证，可以验收。
- R-2: 关闭 —— S-4 的 grep 已补 `*.tsx`，并把 DecisionRegistry 列为真实调用方。改法是：默认 category 改为 `''`，交给服务端走缺省值；占位文案去掉非法值；提交后判断 `res.ok`，非 2xx 时在弹窗内显示 `error`、不关弹窗，同时复位 `saving`。新增的 Q-8 走 `mac_web`，和 E2E 路由规则一致。已核对 `DecisionRegistry.tsx:44-46` 的卡片会渲染 `d.category` 标签，列表请求是 `status=active&limit=100`，新建记录默认就是 active，所以「列表出现该主题且分类为 decision」是用户真能看到的结果。
