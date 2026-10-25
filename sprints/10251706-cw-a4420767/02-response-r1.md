---
task_id: a4420767-a098-47e1-96ee-710eb033dd85
step: spec_revise
upstream: ["02-review-r1.md#R-1", "02-review-r1.md#R-2"]
---

# 规格评审回应（第 1 轮）

### R-1
处理: 采纳
说明: 现有 README 的“运行回执如何判读”确有 `status.mjs [--log-dir <dir>] [--json]`，原有序子序列验法允许命令内部插字。S-3、Q-3 改为只允许在原顶层小节边界插入完整新节；删除新增节后与固定基线逐字节相等，并单独断言原命令及代码块完整。读者仍能执行原命令，QA 插入一个字符即可验证断言会失败；原文无需在含新节的整篇文档中连续出现。

### R-2
处理: 采纳
说明: 原命令的提交父关系加最终差异不足以发现 `new-task.mjs` 先改后撤销。S-4 明确发布前 verify 当场对固定基线至当时 HEAD 的每个提交、每条父子边运行 `git diff-tree -r --raw --no-commit-id <父> <提交>` 和 `git diff --binary --full-index <父> <提交>`，保留原生命令、完整输出及退出码；S-5、Q-4 要求发布后 QA 对当前固定 initial base 至测试 HEAD 的完整 DAG 同样逐父核路径、内容、blob 和 mode，合并提交两父均核。用户看到的产品仍仅 README；QA 可从中间提交检出并拒绝改后撤销，同时核当前暂存区、工作区和全仓未跟踪文件。发布前非 Git 现场仍由当时 verify 原生记录与外层独立核验，QA 不重造历史现场。
