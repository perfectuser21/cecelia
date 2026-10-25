### R-1
处理: 采纳
说明: Q-1 的原命令确实只有直接执行的循环，无法重跑断言。现改为定义接收内存文本的 `check`，先检查原文，再分别删除 `--match-head-commit`、`awaiting_human` 并断言检查抛出 AssertionError；S-1 要求的可失败对抗由这条只读命令落实。QA 可直接运行命令并人工核对双入口及失败语义。

### R-2
处理: 采纳
说明: `rev-parse` 只证明对象存在，`rev-list base..HEAD` 在 base 不是祖先时仍可退出 0。S-2、Q-2 现要求先核 HEAD 等于可信 `tested_head`，再执行 `git merge-base --is-ancestor`；非零即拒绝把范围输出认作固定 base 至测试 HEAD 的 DAG。原有逐提交、逐父边、全差异与当前 index/worktree/全仓 untracked 检查保留，发布前非 Git 现场仍由当时 verify 原生账及后续独立核验承担。
