---
task_id: f2980a63-f4cd-4797-a2ab-7c2bd75728d4
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 3 轮）

## 评分
意图对齐: 8
可验证: 7
场景覆盖: 7
回归风险: 8
可执行: 8

## 换思路
只增加失败分支说明仍会让“字段齐全”的示例漏过验收。把示例本身当成待校验的计划：在不调用 CLI、不访问 Brain 的前提下，让 Q-1 用源码允许的枚举和 `validatePlan` 核对示例值；之后再检查文案与失败语义。

## 上轮问题
- R-2: 关闭 —— S-2 已写明字符串依赖可通过前段校验、在 `body()` 抛错；S-3 与 Q-3 已加入无返回 ID 时按项目和任务信息只读查 Brain 实账、禁止整批盲重跑的路径。

### R-3
针对: S-1, Q-1, I-1
严重度: 重要
场景: 文档作者写出字段齐全、`map_scope_hint` 为 `F1`、`gp_anchor` 为 `none(docs)`，但 `change_kind` 为 `docs` 的单任务示例；QA 按 Q-1 检查字段与 JSON 解析均通过，操作者照抄执行 `--dry-run` 却看到“计划不合格：#1:invalid_change_kind”并退出 2。
依据: I-1 要求示例与源码逐项对应；S-1 只规定含 `change_kind`，Q-1 只规定提取 JSON 后逐字段检查，没有规定其值须通过校验。`packages/brain/src/impact-contract/change-kind.js` 的 `normalizeChangeKind` 只接受四个规范值及旧值映射；`packages/brain/scripts/coding-workflow/new-task.mjs` 的 `validatePlan` 捕获非法值并产生 `invalid_change_kind`。
说明: S-1 明定示例使用源码接受的 `change_kind` 值；Q-1 对示例值做静态或纯函数校验，并让非法枚举导致本场景失败。
