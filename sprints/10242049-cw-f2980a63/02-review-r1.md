---
task_id: f2980a63-f4cd-4797-a2ab-7c2bd75728d4
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 8
场景覆盖: 7
回归风险: 8
可执行: 7

### R-1
针对: S-1, Q-1, I-1
严重度: 重要
场景: 操作者把单任务示例误存成非法 JSON 后执行手册命令，实际看到“读不了计划文件”与退出码 2，按规格写成的手册却告诉他会看到“计划不合格”，因此按错误提示排查时找不到对应结果。
依据: `packages/brain/scripts/coding-workflow/new-task.mjs` 的 `main` 在 `JSON.parse(fs.readFileSync(...))` 的 `catch` 中输出“读不了计划文件”并返回 2；只有后续 `validatePlan` 产生 errors 才输出“计划不合格”。S-1 同时要求覆盖非法 JSON 输入和写明计划错误统一显示“计划不合格”。
说明: 将读取或解析失败与可解析计划的字段校验失败分开描述；Q-1 的静态断言分别核对两条源码分支及对应的用户可见提示。
