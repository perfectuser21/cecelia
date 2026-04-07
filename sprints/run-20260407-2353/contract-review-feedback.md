# 合同审查反馈（第 1 轮）

## 判决：REVISION

合同整体结构良好，Feature 1 和 Feature 2 的核心路径描述清晰。但以下两个问题会导致 Evaluator 在评判时产生歧义，必须修复。

---

## 必须修改

### 1. [缺边界情况] Feature 1 未定义 `sprint_dir=`（空字符串）的行为

**问题**：当调用方传入 `GET /api/brain/tasks?sprint_dir=`（空字符串）时，合同没有说明预期行为。Generator 可能选择：
- 将空字符串视为"无过滤条件"→ 返回全量任务
- 将空字符串视为精确匹配 `sprint_dir = ''` → 返回空数组
- 报错返回 4xx

两种实现均可声称"符合合同"，Evaluator 无法判断哪个正确。

**要求**：在 Feature 1 硬阈值中明确补充一条：
> 传入空字符串 `sprint_dir=` 时，行为为 [X]（选择一个：同不存在返回 `[]`，或 HTTP 400，或同不传参处理）

---

### 2. [不一致] Feature 3 硬阈值与行为描述不匹配，缺少 `status` 字段验证

**问题**：行为描述明确列出了 `id`、`title`、`status`、`sprint_dir` 四个字段，但硬阈值只验证了 `id`（非 null UUID）、`title`（非 null 字符串）、`sprint_dir`（键存在），**未验证 `status` 字段**。

这导致 Generator 可以返回不含 `status` 的响应，仍然通过硬阈值检查。

**要求**：在 Feature 3 硬阈值中补充：
> 响应数组中每条记录的 `status` 字段为非 null 字符串（如 `pending`、`in_progress`、`completed` 等）

---

## 可选改进

- Feature 2 的行为描述使用了实现内部细节（"使用 `getTopTasks(limit)` 路径"、"走 status/task_type 过滤路径"），Evaluator 无法直接观测代码路径。建议改为可观测行为：
  > 不传 `sprint_dir` 时，调用 `GET /api/brain/tasks?limit=5` 返回任务数 ≤ 5，且每条记录的 `sprint_dir` 不受过滤（可为任意值）

- `task_type + sprint_dir` 组合过滤未显式描述，虽然 AND 逻辑应能覆盖，但明确列出更安全

---

## 合格路径确认

以下方面已满足 APPROVED 条件，修复上述 2 点后可直接 APPROVED：

- ✅ Feature 1 正常路径：精确过滤，逐条验证 sprint_dir 值
- ✅ Feature 1 失败路径：不存在的 sprint_dir → 空数组 + HTTP 200
- ✅ Feature 1 响应时间阈值：< 500ms（量化）
- ✅ Feature 2 AND 组合逻辑：status + sprint_dir 双条件均已量化描述
- ✅ Feature 3 基本字段覆盖：id/title/sprint_dir 均有具体验证标准
- ✅ PRD 所有功能点均已覆盖
- ✅ 技术实现方向清晰，无明显陷阱
