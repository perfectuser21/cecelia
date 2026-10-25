---
task_id: 3a15fcff-3af4-49b4-a4c2-b0c7c743ef49
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 8
可验证: 5
场景覆盖: 7
回归风险: 6
可执行: 6

## 上轮问题
- R-1: 关闭 —— S-4、Q-4 已补固定基线至 HEAD 的逐提交、逐父路径及 blob/mode 检查，改后恢复的越界提交不再只靠最终差异判断。

### R-2
针对: S-4, Q-4, I-4
严重度: 阻断
场景: 本轮 03-build.md 和 04-evidence.md 已被提交但在 QA 会话中临时隐藏；QA 照 Q-4 对包含这些文件的提交执行 `git diff --binary`，终端直接显示开发报告正文，黑盒 QA 读到了合同禁止读取的自测材料。
依据: Q-4 要对固定基线后每个提交及每个父提交运行不限定路径的 `git diff --binary --no-ext-diff --no-renames`；新增或修改 Markdown 时该命令输出文件正文。`packages/brain/scripts/coding-workflow/prompts/evaluate.md` 的 QA_HISTORY_SCOPE_POLICY 明确禁止读取当前及历史 03/04 正文，包括从 Git 历史提取；`packages/brain/scripts/coding-workflow/lib/qa-isolation.mjs` 也只临时隐藏工作区文件，不能阻止 Git diff 显示正文。I-4 要求完整 DAG 与逐提交归属，同时保留 03/04 隔离。
说明: 保留全 DAG、逐提交、逐父、全路径的 raw blob/mode 与归属核验；QA 只对允许读取正文的路径做内容对照，03/04 正文身份与完整恢复交由可信来源门和会话后裁判独立核验。Q-4 的命令和期望须明确排除从 Git 差异读取 03/04 正文，不能用缩减 DAG 或最终差异代替范围检查。
