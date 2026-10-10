你在解决一个 PR 与 main 的合并冲突。当前目录就是仓库，已检出 PR 分支 {{BRANCH}}（{{PR_URL}}），runner 已经执行了 `git merge origin/main`，合并停在冲突上。

有冲突的文件：

{{CONFLICT_FILES}}

本 PR 合并前的 head 是 {{BEFORE}}。用 `git diff origin/main...{{BEFORE}}` 看本 PR 原本改了什么，用 `git log {{BEFORE}}..origin/main` 看 main 这段时间改了什么。

要求：
1. 逐个解决上面列出的冲突：main 的改动全部保留，同时保留本 PR 的意图。不能为了消掉冲突丢掉任何一边的改动。
2. 只动冲突相关的内容，不顺手改别的，不新增功能，不改需求。
3. 如果 main 新增的数据库迁移和本 PR 的迁移用了同一个编号（packages/brain/migrations/NNN_*.sql），把本 PR 的迁移用 `git mv` 顺延到 main 之后第一个空闲编号，并同步改引用它的测试、回滚文件和 selfcheck 期望版本。
4. 解决完运行与冲突文件相关的测试，确认通过。注意 CI 跑在 Linux，本机是 macOS。
5. 用 `git add` 加入解决后的文件，再 `git commit --no-edit` 完成这次合并；第 3 条的迁移顺延可以在合并完成后单独提交，提交信息用 `fix(...): ` 开头的中文说明。
6. 不 push、不调用 gh、不改写已有提交（不 amend、不 rebase、不 reset、不 `git merge --abort`）。
7. 不修改 sprints/ 下任何文件（那是本 PR 的需求与验收记录），不修改 .claude/、CLAUDE.md、AGENTS.md，不删除或放宽 main 上已有测试的断言。
8. 结束时合并必须已经完成（没有 MERGE_HEAD），工作区干净（没有未提交的改动）。
