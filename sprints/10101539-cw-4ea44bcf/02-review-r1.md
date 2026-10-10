---
task_id: 4ea44bcf-780b-41e2-b150-299f1a7a5bd7
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 7
可验证: 5
场景覆盖: 6
回归风险: 5
可执行: 7

### R-1
针对: Q-5, S-2, I-3
严重度: 阻断
场景: QA 按 Q-5 用 coding workflow 真实 shape（`made_by:"ai"`、`category:"judgment"`）POST，预期 201，实际拿到 400「字段取值不符合约束」（改动前是 500 + `decisions_made_by_check` 原文）；Q-5 必然验收失败，coding workflow 判定点写库在生产上也一直写不进去。
依据: `packages/brain/migrations/193_knowledge_doc_author.sql:9-10` 给 decisions.made_by 加了 `CHECK (made_by IN ('user','cecelia','system'))`，全仓 migrations 没有任何一处放宽到 `ai`；`packages/workflows/skills/harness-contract-reviewer/SKILL.md:468` 也明写“'ai' 会被 DB 拒”。而 `packages/brain/scripts/coding-workflow/activities/spec-review.mjs:75` 发 `made_by:'ai'`，`brainJson` 遇非 2xx 直接抛错（:51）。规格 S-2 写“judgment 在允许列表里，行为不变”，只核对了 category，没核对同一请求体里其它受 CHECK 约束的字段。
说明: 规格必须对这条真实调用方给出结论，二选一并写进 S-n 与 Q-5：①一并修调用方——`spec-review.mjs` 的 `made_by` 改为约束内的值（如 `system`），Q-5 的 body 与期望 `made_by` 同步改，并在 spec-review 测试里锁住；或 ②明确 Q-5 期望为 400，并把“判定点写库被 made_by 约束拒”登记为另开任务（带 Brain 任务 ID）。另外，S-2 catch 兜底把所有 23514 统一回“字段取值不符合约束”，调用方仍然不知道是哪个字段、该填什么——与 I-1 的初衷（“调用方不知道该填什么”）同病。建议对 made_by、priority（同 migration 193 有 `CHECK (priority IN ('P0','P1','P2','P3'))`）也像 category 一样写库前校验并回 `allowed_*`，或至少在 23514 响应里给出字段名（不含约束名/SQL 原文）；对应补 Q-n（例如 `made_by:"ai"` → 400 且响应说明合法取值）。

### R-2
针对: S-4, I-1, I-2
严重度: 重要
场景: 主理人在 Dashboard「决策登记台」点“记录决策”，不改“分类”输入框直接提交（默认 `general`），或按占位提示填 `product`/`strategy`；改动后接口回 400，但页面不读响应，弹窗照常关闭、列表刷新后没有这条决策，也没有任何报错——用户以为记下了，实际丢了。
依据: `apps/api/features/knowledge/pages/DecisionRegistry.tsx:68` 表单默认 `category: 'general'`，:110 占位文案 `如 technical、product、strategy`（product/strategy 都不在 migration 384 允许列表），:74-81 `await fetch(...)` 后不判 `res.ok` 就 `onCreated(); onClose();`。S-4 的全仓搜索命令只带 `--include=*.ts`，不含 `*.tsx`，这个真实调用方会被漏掉；S-2「真实调用方 shape」里也没列它。
说明: S-4 的 grep 补上 `*.tsx`，把 DecisionRegistry 列为真实调用方：默认 category 改为空串（走 S-2 的缺省 `decision`）或改成从允许列表选的下拉，占位文案去掉非法值；提交后检查响应，非 2xx 时把 `error` 显示给用户、不关弹窗。补一条 Cecelia `mac_web` 环境的 QA 场景（打开决策登记台→不改分类提交→列表出现该条且分类为 decision；填非法分类→看到列出合法值的错误提示），或在 `## 未覆盖真实链路` 里登记并说明理由。
