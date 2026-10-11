你在修一个 PR 的 CI 失败。当前目录就是仓库，已检出 PR 分支 {{BRANCH}}（{{PR_URL}}）。

失败的检查：{{FAILED_CHECKS}}

失败日志摘录（每个失败 job 取末尾若干行）：

{{CI_LOGS}}

要求：
1. 先判断哪些失败是本 PR 的改动造成的（`git log origin/main..HEAD` 与 `git diff origin/main...HEAD` 看本 PR 改了什么）。与本 PR 无关的失败（所有 PR 都红的检查、基础设施抖动、网络超时）不要去改。
2. 对本 PR 造成的失败：先在本地运行对应的测试命令复现，再改代码修复，修完重新运行确认通过。注意 CI 跑在 Linux，本机是 macOS：shell、sed、date、bash 版本差异要按 Linux 行为修。
3. 修复提交到当前分支（可以多个提交），提交信息用 `fix(...): ` 开头的中文说明，写清 CI 里看到的现象和根因。
4. 不 push、不调用 gh、不改写已有提交（不 amend、不 rebase、不 reset）。
5. 不修改 sprints/ 下任何文件（那是本 PR 的需求与验收记录），不修改 .claude/、CLAUDE.md、AGENTS.md，不修改 runner 生成的 QA 回归 smoke（packages/brain/scripts/smoke/cw-*-qa-smoke.sh，由 runner 按 QA 报告固化，勿手改），不删除或放宽已有测试的断言。
6. 结束时工作区必须干净（没有未提交的改动）。
7. 如果判断所有失败都与本 PR 无关，不要提交任何东西，说明原因后结束。
