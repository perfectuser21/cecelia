---
task_id: c8fab3c8-c85e-4e7e-a610-ce776c4aefe2
step: intent
upstream: []
---
# 修复 decisions_made_by_check 不含 ai：coding-workflow 判定点 made_by=ai 在迁移建出的库上 POST strategic-decisions 返回 500

## 背景

从任务 bd2b1556 拆出（裁判 J-2：需求外范围）。spec-review.mjs 写判定点带 made_by:ai，迁移 193 的 decisions_made_by_check 只允许 user/cecelia/system，CI 空库/预览环境/全新部署上返回 500 并透出约束原文。参考已撤回提交 b7ec64115。

### I-1
coding-workflow 判定点 shape（made_by=ai）POST /api/brain/strategic-decisions 在迁移建出的库上返回 201，GET ?category=judgment 能查到

### I-2
迁移只增不减：现有 made_by 取值与迁移外加宽的取值全部保留，重跑幂等（真库验收）
