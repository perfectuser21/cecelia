### R-1
处理: 采纳
说明: `lib/qa-isolation.mjs` 的 `startQaIsolation` 在原件与 HEAD 的字节和 mode 一致后执行 `fs.unlinkSync(source)`；`activities/evaluate.mjs` 在 QA 命令前启动隔离，只在会话结束后恢复。因此 Q-4 原先把所有当前工作区差异视为脏现场，会误判本轮 03/04 的预期删除。S-3、S-4 和 Q-4 已限定例外：QA 将 `git diff --raw` 中这两条删除逐项匹配可信控制器提供的本 task/round/测试 HEAD、`hidden` 状态、准确路径及 HEAD blob/mode 的隔离投影，并确认工作区确实缺文件；其它 index/worktree/untracked 差异仍逐项验归属，缺投影或不匹配即失败。用户可见结果是合法隔离不会误报 FAIL，额外改动仍不能通过；验证按 Q-4 的真实只读 Git 命令及投影比对执行。03/04 是否恢复仍由会话后控制器和终态门核验，QA 不读取原文或保护根。
