你是开发方。真人 QA 在 PR 预览环境里黑盒验收了你的改动，没有通过。当前目录就是仓库，已检出 PR 分支 {{BRANCH}}。输出必须使用简体中文。

输入信息（以下各行为机器可读，原样保留）：
ROLE: qa_fix
QA_REPORT_PATH: {{QA_REPORT_PATH}}
INTENT_PATH: {{INTENT_PATH}}
SPEC_PATH: {{SPEC_PATH}}
PRIOR_RULINGS: {{PRIOR_RULINGS}}

QA 判定未通过的条目：
{{QA_ISSUES}}

要求：
1. 读 QA_REPORT_PATH：每条 `### T-n`（按 QA 场景测）/ `### X-n`（探索发现）里有 QA 真实执行的命令和真实输出——这是用户真的会遇到的问题，不要辩解，按用户可见的结果修。
   如果它是独立裁判的裁决（`06-judge-rN.md`）：QA 判了通过，但不同模型的裁判对照需求、QA 证据和你的改动后认定需求没真正做到；每条 `### J-n` 写了位置与说明——同样不要辩解，按需求把它做完整。
2. 读 INTENT_PATH 与 SPEC_PATH 理解需求和 QA 场景，读相关代码找到根因。
3. TDD：先写能复现该问题的失败测试（覆盖 QA 给出的输入与期望），再改代码让它通过，运行相关测试确认。修 bug 的测试永久留着。
4. 只修 QA 指出的问题和它的根因，不借机做无关改动。
5. 规格（SPEC_PATH）的条款是合同，有约束力；PRIOR_RULINGS 是前几轮裁判的裁决（你已照它们改过代码）。如果本次要修的问题要求的行为与规格条款或前轮裁决相反（例如前轮要求「读不到时报错」、本次要求「读不到时返回空」），不要来回改：不提交任何改动，输出最后单独一行写 `RULING_CONFLICT: <本次条目> 与 <规格条款或前轮条目> 矛盾：<各自要求>`，交 coding commander 按规格裁决。
6. 提交到当前分支（可以多个提交），提交信息用 `fix(...): ` 开头的中文说明，写清 QA 看到的现象和根因。

禁止：
- 不修改 sprints/ 下任何文件（需求、规格、QA 报告是验收记录），不修改 .claude/、CLAUDE.md、AGENTS.md，不修改 runner 生成的 QA 回归 smoke（packages/brain/scripts/smoke/cw-*-qa-smoke.sh，由 runner 按 QA 报告固化，勿手改）。
- 不删除或放宽已有测试的断言来"让它通过"。
- 不 push、不调用 gh、不改写已有提交（不 amend、不 rebase、不 reset）。
- 结束时工作区必须干净（没有未提交改动）。
