# Learning: tasks API 支持 okr_initiative_id 字段读写

## 根本原因
PR #1441 添加了 `tasks.okr_initiative_id` DB 列，但 `task-tasks.js` 的 POST/PATCH
端点没有同步暴露该字段，导致 API 层和 DB 层脱节，无法通过 API 将 Task 关联到 OKR Initiative。

## 修复方案
在 `task-tasks.js` 两处添加 `okr_initiative_id`：
- POST `/`：destructure + INSERT SQL 加列 + RETURNING 加列
- PATCH `/:id`：destructure + 动态 SET clause

## 下次预防

- [ ] 新增 DB 列时，同一个 PR 必须同时更新所有暴露该列的 API 端点（POST/PATCH/GET）
- [ ] PR Review 清单：新增 migration 列 → 检查对应 route 文件是否同步更新
- [ ] task-tasks.js 和 tasks.js 是两个不同的路由文件，改列时两处都要检查
