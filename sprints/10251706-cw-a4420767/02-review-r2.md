---
task_id: a4420767-a098-47e1-96ee-710eb033dd85
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 8
可验证: 6
场景覆盖: 7
回归风险: 7
可执行: 6

## 上轮问题
- R-1: 关闭 —— S-3、Q-3 已改为只在顶层小节边界插入，移除新节后与固定基线逐字节比较；旧命令内部插字会失败。
- R-2: 关闭 —— S-4、S-5、Q-4 已加入固定基线至当前 HEAD 的逐提交、逐父路径及内容和模式检查，先改 `new-task.mjs` 后撤销也会检出；过去非 Git 现场仍由当时原生记录核验。

### R-3
针对: S-4, S-5, Q-4, I-4
严重度: 阻断
场景: QA 在含已提交 `03-build.md` 或 `04-evidence.md` 的当前 PR 上照 Q-4 对每条父子边执行 `git diff --binary --full-index`，终端直接显示被临时隐藏的开发报告正文；QA 因越过隔离边界不能合法完成这条测试计划。
依据: `packages/brain/scripts/coding-workflow/prompts/evaluate.md` 的 `QA_HISTORY_SCOPE_POLICY` 禁止读取当前及历史 03/04 正文，包括从 Git 历史提取；`activities/evaluate.mjs` 在 QA 会话中隐藏这两个工作区文件。S-4、S-5、Q-4 却对固定基线到 HEAD 的每条父子边无路径区分地要求运行 `git diff --binary --full-index <父> <提交>`；Git 补丁会输出 Markdown 新增或改动的正文，工作区隐藏不会遮住 Git 对象。
说明: 保留固定 initial base、完整 DAG、逐提交和逐父路径、blob 与 mode 归属及当前全仓范围验收；对 03/04 使用不暴露正文的 Git 元数据和本轮可信来源投影，正文、原字节及模式的受保护核验交来源门和会话后裁判。Q-4 的实际命令要按路径限定，不能让 QA 通过全量补丁读到隔离报告；发布前 verify 同样不能借全量补丁读取其它 sprint 报告正文。
