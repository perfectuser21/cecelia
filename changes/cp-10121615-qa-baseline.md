fix: local QA 基线从合同指定的固定 commit 只读提取到独享临时目录，不再要求 git worktree add；缺少历史起点仍 CANNOT_VERIFY，保留黑盒和 Git 元数据只读边界。 QA 记录只对当前任务/轮次报告和截图 force-add，兼容目标仓忽略规则；smoke 保持普通 add，空记录、预暂存、越界和链接拒绝。
