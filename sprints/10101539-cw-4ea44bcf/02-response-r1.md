---
task_id: 4ea44bcf-780b-41e2-b150-299f1a7a5bd7
step: spec_response
upstream: ["02-review-r1.md#R-1", "02-review-r1.md#R-2"]
---
# 规格回应（第 1 轮）

### R-1
处理: 采纳
说明: 已核实 `migrations/193_knowledge_doc_author.sql:9-12` 对 decisions.made_by/priority 有 CHECK，`spec-review.mjs:75` 发 `made_by:'ai'` 必被拒，场景成立。按方案①改：S-4 把调用方 `made_by` 改为 `system`，并在 `spec-review.test.mjs` 的写库断言里加 `made_by:'system'` 锁住；Q-5 body 与期望同步改为 `made_by=system`。同时补齐 R-1 指出的同病：S-1 增加 `DECISION_MADE_BY`、`DECISION_PRIORITIES` 常量（漂移测试对 migration 193 锁死），S-2 对 made_by/priority 写库前校验，非法回 400 并带 `allowed_made_by` / `allowed_priorities`；23514 兜底按 `err.constraint` 映射出字段名回给调用方（不含约束名/SQL 原文）。S-3 新增用例 7（`made_by:'ai'`、`priority:'P9'` → 400 未写库），新增 Q-7 预览环境验证。
验证: `npx vitest run src/routes/__tests__/strategic-decisions-category.test.js scripts/coding-workflow/__tests__/spec-review.test.mjs` 全绿；Q-5 返回 201 且回读 `made_by=system`；Q-7 两次 400 且带合法值数组。

### R-2
处理: 采纳
说明: 已核实 `DecisionRegistry.tsx:68` 默认 `category:'general'`、:110 占位含非法 `product/strategy`、:74-81 不判 `res.ok` 就关弹窗，S-4 的 grep 漏了 `*.tsx`，场景成立。S-4 改为：grep 补 `--include=*.tsx`；表单默认 category 改为空串（走服务端缺省 `decision`），占位改为“留空即 decision”；提交检查 `res.ok`，非 2xx 时在弹窗内显示服务端 `error`（其中已列合法值）且不关弹窗。前端不抄写允许列表，避免与 INV-76cb816c 冲突。S-2「真实调用方 shape」补列该页面。新增 Q-8（Cecelia `mac_web` 本机 localhost:5174）：分类留空提交 → 列表出现且分类为 decision；填 `product` → 弹窗内看到列出合法值的错误、列表无该条。
