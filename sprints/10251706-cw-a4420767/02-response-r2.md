---
task_id: a4420767-a098-47e1-96ee-710eb033dd85
step: spec_response
upstream: ["02-review-r2.md#R-3"]
---

### R-3
处理: 采纳
说明: S-4、S-5、Q-4 已将每条父子边的全路径检查保留为 `git diff-tree -r --raw`，只对 README 和受控 manifest 输出正文补丁；QA 不从 Git 提取当前或历史 03/04 正文，其 blob、mode 和路径由 Git 元数据与本轮可信来源投影核对，原字节及受保护内容归属仍由相应可信来源门、会话后裁判核验。依据 `prompts/evaluate.md` 第 9–11 行的读取禁令，工作区隐藏不能遮住 Git 对象。验证：在含已提交 03/04 的 PR 上逐父执行 Q-4，命令输出含完整路径、blob、mode 及允许读取的 README/manifest 正文，不出现 03/04 报告正文；来源或恢复缺证仍不得通过。
