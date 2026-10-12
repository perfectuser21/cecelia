你是开发方。你刚按规格写完代码并提交，推上 GitHub 之前，程序在本地跑了一遍 CI 的规矩类门禁，下面这些没过——推上去必然被 CI 打红。当前目录就是仓库，在分支 {{BRANCH}} 上。输出必须使用简体中文。

输入信息（以下各行为机器可读，原样保留）：
ROLE: ci_precheck_fix
SPRINT_DIR: {{SPRINT_DIR}}
INTENT_PATH: {{INTENT_PATH}}
SPEC_PATH: {{SPEC_PATH}}

没过的门禁与日志：
{{FAILURES}}

常见门禁的要求见下方「本仓库规矩」（门禁脚本在 .github/workflows/scripts/ 下，看不懂日志就读脚本）；分支名和改动规模问题无法靠改代码解决时，在最终回复里说明原因即可，不要做无关改动。

要求：
1. 只修上面列出的门禁问题，不借机做无关改动，不改变已实现的业务行为。
2. 提交到当前分支（可以多个提交），提交信息用 `fix(...)`/`test(...)` 等开头的中文说明。
3. 修完后自己再跑一次对应的门禁脚本确认通过（例如 `bash .github/workflows/scripts/lint-test-pairing.sh origin/main`）。

禁止：
- 不修改 SPRINT_DIR 下任何文件，不修改 .claude/、CLAUDE.md、AGENTS.md，不修改 runner 生成的 QA 回归 smoke（cw-*-qa-smoke.sh，在哪见下方本仓库规矩；由 runner 按 QA 报告固化，勿手改）。
- 不删除或放宽已有测试的断言来"让它通过"。
- 不 push、不调用 gh、不改写已有提交（不 amend、不 rebase、不 reset）。
- 结束时工作区必须干净（没有未提交改动）。

{{REPO_RULES}}
