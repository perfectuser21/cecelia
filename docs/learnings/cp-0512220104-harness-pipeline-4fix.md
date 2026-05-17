# Learning — B14 harness pipeline 4 hole 真过 P1

### 根本原因

W36 跑 73 min 撞 final_evaluate FAIL，深挖发现 4 个 hole：

1. **brain spawn evaluator 没传 PR_BRANCH** — evaluator container 起在 initiative 主 worktree (main)，跑 server 看不见 generator 在 PR 分支写的代码
2. **evaluator skill 1.3.0 写"pre-merge gate"但 Step 0 没指令 git checkout PR 分支** — 即使 brain 传了 env 也不会用
3. **proposer 7.6.0 有 size S/M/L 阈值但没硬规则强制切** — W36 实证把 335 行三文件塞 1 ws
4. **planner 没 thin slice 字数上限** — W36 实证 254 行 PRD + 32 DoD 条目

P1 一直过不去因为这 4 个 hole 任何一个都让 evaluator 必 FAIL。

### 下次预防

- [ ] 任何"读环境变量"的 skill 必须在 SKILL.md 写明 env vars 清单，graph spawn 端 env: {} 块和 SKILL.md 清单要对账
- [ ] pre-merge gate 类 skill 必须在 Step 0 显式切到目标分支，不能依赖 LLM 自己 infer
- [ ] proposer / planner 必须有量化硬阈值（行数 / 文件数 / DoD 条数），不能只写"建议"或"S/M/L 推荐"
- [ ] 任何 "fix loop 跑 N round 都 FAIL" 类 issue 第一时间 grep evaluator stdout 找 root cause，不要假设是 generator 质量问题
