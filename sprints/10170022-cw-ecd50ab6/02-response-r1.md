### R-1
处理: 采纳
说明: `runner/lib/source-merge.mjs` 的 `createSourceMerge` 用 `commit-tree ... -p before -p main` 生成双父提交；普通 `git diff-tree <merge>` 会漏掉父边改动。S-4、Q-4 已改为从固定基线取得完整 DAG，对双父提交分别比较第一父、第二父的路径、内容与 mode，并检查上游历史；同时保留最终差异、暂存区、工作区和全仓未跟踪检查。Q-4 增加临时 Git 仓库反例：上游改 README，同步后再还原；即使最终 README 与基线相同，也必须从父边及上游历史发现越界并判不能验收。
