## Brain {VERSION} — 对话捕获只收真人原话 + 长寿会话只挂近 24h 提到的任务

- 生产首轮实测（任务 c8b27bc5）：Claude Code 以 role=user 写进 transcript 的任务通知（`origin.kind=task-notification`）、技能正文（`isMeta`）、本地命令回显、压缩续接摘要被当成真人原话入库，摘要兜底摘录也全是噪声；新增 `isMeta` / `origin.kind` 判定，老格式按前缀排除
- 一个 tmux 会话连做几天：关联任务只认最近 24h 内提到的 `--task-id` / claim，不再把今天的摘要挂到几天前已完成的任务上
