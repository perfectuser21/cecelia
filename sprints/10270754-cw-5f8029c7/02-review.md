---
task_id: 5f8029c7-6f55-441a-b7d0-70688ac0cfb9
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5", "02-spec.md#S-6"]
---
# 规格评审（第 3 轮）

## 评分
意图对齐: 7
可验证: 7
场景覆盖: 7
回归风险: 6
可执行: 7

## 换思路
逐项补 Q 场景已解决上轮的阶段错位，却仍会漏掉现有命令行入口的兼容性。先把 `new-task.mjs` 当前接受的仓库输入形状定为接口基线，再区分“已登记别名归一为 key”和“未登记目录被拒绝”；用真实建单路径验这两类输入，而不是继续只给 `cecelia` key 的场景补措辞。

## 上轮问题
- R-2: 关闭 —— S-1、S-2 现明确允许 `path` 携带完整 HTTPS URL，intent 在 Git 路径校验前返回 `unsupported/external_authority_unsupported`；Q-2 已写明通过 new-task 建单并运行真实 intent 子进程观察该缺口。
- R-3: 关闭 —— Q-6 现只让当前 QA 启动受控 runner、观察本轮子孙进程消失和失败回执；伪造登记及 Native owned 枚举留在 S-5 的发布前原生命令和独立核验，当前 QA 不再需要不存在的产品登记入口。

### R-4
针对: S-2, Q-1, I-3
严重度: 阻断
场景: 现有调用方用 `--repo perfectuser21/cecelia` 或计划里的 GitHub 仓库 URL 建 coding workflow 任务；开发者按“只接受已登记 key”实现校验后，命令在建单前报 `repo_unknown`，原本可用的任务入口被拒绝，而 Q-1 只用 `cecelia` key 验不出回归。
依据: `packages/brain/scripts/coding-workflow/new-task.mjs` 的 `validatePlan()` 将计划 `repo` 和 `--repo` 交给 `resolveRepo()`；`runner/lib/repos.mjs` 的 `resolveRepo()` 明确接受 key、slug、origin 与 aliases，`repos.json` 登记了 `perfectuser21/cecelia` 和 GitHub origin。S-2 的“repo 只接受 repos.json 已登记 key”若按字面执行，会收窄该既有接口；I-3 要求旧任务兼容，背景也限定本批不改无关调用方。
说明: S-2 应明确保留已登记别名、`owner/repo` 与 URL 的现有归一行为，最终仍写规范 key；只拒绝未登记仓库及临时目录路径。补一条经真实 `new-task.mjs` 建单的别名或 URL 回归操作和可见结果。
