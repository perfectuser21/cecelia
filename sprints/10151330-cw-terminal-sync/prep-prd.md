# Coding workflow 终态可靠收尾

Task: 427d7e49-27c5-4612-b115-9214f03d47f9
GP-Anchor: none(infra)
路径 A：已复现 bug。根会话授权，隔离手动 worktree。

## 问题与边界
合并删分支后仅 open 列表参与镜像，merged 与次轮 preview_stopped 漏写；终态 GET/PATCH 失败后无重试，且 GET 失败可能用空 prior 覆盖历史。新生成交接把 AI QA 称作真人并混淆最终通过轮与历史记录数。

## 验收
- PR 身份持久化，退出 closed100/merged30 列表仍可逐项核真实状态、重试；每轮至多 30 个窗口外身份。
- task 来源为已核 branch/ref，仓库、task 与 PR 显式矛盾拒绝；分命名空间；GET 失败不 PATCH。
- 保留非镜像历史字段，移除本机已撤销的镜像字段；仅确认成功才更新快照。
- 合并前保留 exacthead intent，外部成功后进程崩溃重启只收账；不改变合并权限。
- Learning 非幂等：只发一次，按唯一 IDs、数量、分页原文核验；未知/部分成功不重发。
- 新交接称 AI QA、第 approved.round 轮通过、历史记录数；历史失败、报告与批准不改写。

## Proven-to-fire
`runner/__tests__/state-store-retry.test.mjs` 与 `run-once-terminal-sync.test.mjs` 在修复前 7 FAIL / 1 PASS，红提交 afa888649。完整证据位于本机会话 artifact terminal-sync/red.log。

## 不在范围
不操作常驻服务、真实任务终态、业务生产；ZENITHJOY #2132 禁合并。后续两条真实无人干预任务由根会话验收。
