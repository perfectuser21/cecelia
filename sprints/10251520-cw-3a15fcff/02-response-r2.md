---
task_id: 3a15fcff-3af4-49b4-a4c2-b0c7c743ef49
step: spec_revise
upstream: ["02-review-r2.md#R-2"]
---
# 规格修订回应（第 2 轮）

## 换思路

采纳按读取权限拆分验收责任的方向。评审文件未单列“换思路”小节，但 R-2 明确给出这一方向：QA 保留固定基线至 HEAD 的完整 DAG、逐提交逐父全路径 raw blob/mode 与归属核验，只读允许的正文；03/04 正文身份和会话后恢复由可信来源门与独立裁判核实。S-4、Q-4 已按此重写正文核验步骤，而非继续对全路径运行正文 diff。

### R-2
处理: 采纳
说明: `evaluate.md` 的 `QA_HISTORY_SCOPE_POLICY` 禁止 QA 读取当前及历史 03/04 正文，`qa-isolation.mjs` 仅隐藏工作区文件；原 Q-4 的不限路径 `git diff --binary` 确会显示 Git 中的报告正文。S-4、Q-4 现要求 QA 对固定 initial base 后每个提交、每个父提交运行全路径 `git diff --raw --no-abbrev --no-renames`，逐路径核 blob/mode 和归属；只对确认允许读正文的单一路径执行带 `-- <允许路径>` 的 binary diff，禁止读取当前或历史 03/04 的 Git 正文。03/04 的正文身份、来源和会话后原字节及模式恢复仍由可信 source gate、独立裁判实际核实，缺证不能通过。QA 可见结果是完整范围结论及明确的未恢复边界，不会显示隔离报告正文。验证：逐项检查 Q-4 命令不再包含不限路径的正文 diff，同时保留全 DAG、逐父 raw、当前暂存区/工作区、全仓未跟踪及后续独立核验要求。
