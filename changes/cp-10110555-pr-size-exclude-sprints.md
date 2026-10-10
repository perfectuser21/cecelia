## Brain {VERSION} — CI：pr-size-check 行数统计不计 sprints/ 过程记录

- 金丝雀 4 #6232 跑到第 10 轮时被 pr-size-check 拦下：新增 3129 行超过 3000 行硬门槛，其中代码只有 566 行，其余是 sprints/ 下的规格、QA 报告与裁判报告（任务 1a94983b）。
- coding workflow 的 GAN 轮次无上限（invariant 02d8e749），过程记录随轮次增长；计入行数会让多轮 PR 必然被要求拆分，而记录无法拆出。
- 行数统计抽成 `.github/workflows/scripts/pr-size-count.sh`，`git diff --numstat` 排除 `sprints/`；3000 行硬门槛与 800 行软警告不变。
- 回归测试 `pr-size-count.test.sh`：临时 git 仓库真实提交，4 个用例覆盖只改代码、代码加大量记录、只有记录、删除行；去掉排除条件时 3 条变红。挂在 lint-auto-merge-decision job，所有 PR 与 push 都跑。
