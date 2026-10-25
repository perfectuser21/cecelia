---
task_id: f2980a63-f4cd-4797-a2ab-7c2bd75728d4
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 8
可验证: 8
场景覆盖: 6
回归风险: 8
可执行: 8

## 上轮问题
- R-1: 关闭 —— S-1 与 Q-1 已分别规定读取或解析失败显示“读不了计划文件”、字段校验失败显示“计划不合格”，均为退出 2；与 `new-task.mjs` 的 `main` 两条分支相符。

### R-2
针对: S-2, S-3, Q-2, Q-3, I-3
严重度: 重要
场景: 操作者把两任务计划第二项的 `depends_on` 误写成字符串 `"a"`（前项 key 为 `"a"`）后真实提交，第一项已建成，第二项抛出 `t.depends_on.map is not a function`；终端没有规格承诺的“已建”数组，操作者按手册只找返回 ID 会漏掉第一项，整批重试又建出重复任务。
依据: `packages/brain/scripts/coding-workflow/new-task.mjs` 的 `validatePlan` 用 `for (const dep of t?.depends_on ?? [])` 遍历字符串，`"a"` 可通过已有 key 检查；`main` 已逐条 POST 第一项后，`body` 对第二项执行 `t.depends_on.map(...)` 抛错，未进入打印失败对象和“已建”数组的分支。S-3 将中途失败核账落在这两个返回位置，Q-3 也只断言双重核查。
说明: S-3 应写明命令异常退出且没有返回 ID 时，仍须按项目和任务信息只读核对 Brain 实账后才能处理或重试；Q-3 加入这个可静态复现的边界核对，不把所有中途失败写成一定有“已建”数组。
