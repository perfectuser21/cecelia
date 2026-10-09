## Brain {VERSION} — coding harness：判卷代码来自可信基线、QA 验的必须是待合并 head 的构建

- 审计 P0 #1（对应旧 harness「judge 不在被评 worktree 跑」「合同产物只读」）：runner 的契约、执行器、各活动入口、QA 门的 evaluate 入口一律从 runner 专用 clone（每轮自更新到 main）加载，不再从任务 / PR worktree 加载——build 改过的 verify、evaluate 不能拿来判它自己。
- 审计 P0 #2（对应旧 evaluator「必须在 PR 分支代码上验」、verdict 锚定 PR head）：QA 门读预览 Brain /api/brain/health 的 git_sha，必须等于 PR head 才开验；推送后还没重新部署则等（stale_since 留痕），超过时限升级 qa_preview_stale。检出的分支必须正是列表里的 head；evaluate 活动收到 head_sha 开跑前再核一次（不符 retryable preview_stale），QA 报告环境记录 sha。
