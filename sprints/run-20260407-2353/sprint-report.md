# Sprint Report — Harness v3.1

生成时间: 2026-04-08 01:02:45 CST
Sprint: run-20260407-2353
PR: https://github.com/perfectuser21/cecelia/pull/1998

---

## 目标（来自 PRD）

为 `GET /api/brain/tasks` 新增 `sprint_dir` 精确过滤参数，允许 Harness 按 sprint 运行目录隔离查询任务，同时保持不传参数时完全向后兼容。

---

## 功能清单

| # | Feature | 描述 |
|---|---------|------|
| 1 | 按 sprint_dir 精确过滤 | 传入 sprint_dir 参数时，返回 sprint_dir 等值匹配的任务列表 |
| 2 | 不传 sprint_dir 时零破坏 | 空字符串自动转 null 忽略，不传时行为与原来完全兼容 |
| 3 | 返回完整任务字段 | 过滤结果包含所有任务字段（id/title/status/result 等） |

---

## GAN 合同对抗（Proposer vs Reviewer）

| 轮次 | 角色 | 结论 | 问题 |
|------|------|------|------|
| Round 1 | Proposer (P1) | 合同草案提交 | — |
| Round 1 | Reviewer (R1) | REVISION | 空字符串边界处理未定义；Feature 3 返回字段缺少 status 约束 |
| Round 2 | Proposer (P2) | 合同草案 v2 提交 | 修复两个问题 |
| Round 2 | Reviewer (R2) | **APPROVED** | 合同写入 sprint-contract.md |

共进行 **2** 轮 GAN 对抗，**1** 次修订后通过。

---

## 代码对抗（Generator vs Evaluator）

| 轮次 | 结论 | 失败项 | 说明 |
|------|------|--------|------|
| R1 | **FAIL** | Feature 1, Feature 2, Feature 3 | `tasks` 表缺少 `sprint_dir` 列，API 返回 HTTP 500 |
| R2 | **PASS** | — | 全部 Feature 通过验收 |

共进行 **2** 轮代码对抗，**1** 次修复后通过。

---

## 修复清单

### Fix R1 → R2

- **问题根因**: Generator 仅修改了路由代码（`packages/brain/src/routes/status.js`），未添加对应 DB migration，导致 `tasks.sprint_dir` 列不存在
- **修复内容**:
  - 新增 `packages/brain/migrations/221_tasks_sprint_dir.sql`
    ```sql
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sprint_dir text;
    CREATE INDEX IF NOT EXISTS idx_tasks_sprint_dir ON tasks (sprint_dir);
    INSERT INTO schema_version (version, description, applied_at)
    VALUES ('221', 'tasks 表新增 sprint_dir 列用于 Harness sprint 过滤', NOW())
    ON CONFLICT (version) DO NOTHING;
    ```
  - bump `EXPECTED_SCHEMA_VERSION` 220 → 221（`selfcheck.js`）
  - 同步 `DEFINITION.md` schema_version 220 → 221
  - 更新 selfcheck 测试断言
- **修复时间**: 2026-04-08 00:36 CST（task: 371f78bb）

---

## 实现细节

**核心修改文件**: `packages/brain/src/routes/status.js`

实现逻辑：
- 从 query params 读取 `sprint_dir`
- 空字符串自动转 `null`（忽略空传）
- 非 null 时在 SQL WHERE 子句追加 `AND tasks.sprint_dir = $N`
- 与现有 `status`、`task_type`、`limit` 过滤 AND 组合

---

## 成本统计

| 任务类型 | 任务数 | Token 消耗 | 费用 (USD) |
|---------|--------|-----------|------------|
| sprint_planner | 1 | — | — |
| sprint_generate | 1 | — | — |
| sprint_evaluate | 2 | — | — |
| sprint_fix | 1 | — | — |
| sprint_report | 1 | — | — |
| **合计** | **6** | **N/A** | **N/A** |

> 注：本次 sprint 任务 result 字段未记录 token/cost 数据（Sprint 3 成本追踪功能已合并，但本次运行任务在成本字段写入前已执行）。

---

## 结论

Harness v3.1 完成。目标需求经过：

- **2 轮 GAN 合同对抗**（1 次修订）→ 合同 APPROVED
- **2 轮代码对抗**（1 次修复）→ 全部 Feature PASS
- **CI 全绿**（L1/L2/L3/L4）
- **PR #1998 已合并至 main**

根本问题：Generator 遗漏 DB migration，Evaluator 在 R1 正确识别并触发修复流程，体现了 Harness v3.1 对抗机制的核心价值。
