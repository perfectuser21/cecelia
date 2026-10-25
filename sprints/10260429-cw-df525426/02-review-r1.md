---
task_id: df525426-c735-44d1-abee-82023053fd93
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 6
场景覆盖: 7
回归风险: 8
可执行: 6

### R-1
针对: S-1, Q-1, I-1
严重度: 重要
场景: QA 照 Q-1 运行原文命令后，尝试在内存删除 `--match-head-commit` 并“重跑同一断言函数”，却没有可调用的函数，无法取得规格要求的非零退出反例。
依据: Q-1 给出的 `node -e` 代码直接执行两个 `for` 循环，只定义 `all`、`t`，没有定义接受内存文本的断言函数；S-1 明确要求内存破坏对抗。
说明: 把 Q-1 改成一条可直接运行的只读命令：定义接收文本的检查函数，先对原文运行，再分别对内存删除后的文本运行并断言各自失败；保留人工核对双入口条件与失败语义。

### R-2
针对: S-2, Q-2, I-2, I-4
严重度: 重要
场景: QA 检出一个不包含固定 initial base 的分叉 HEAD，执行 Q-2 列出的 `rev-parse`、`rev-list base..HEAD` 和逐父 `diff-tree` 均可退出 0，随后把这一组输出误认作“固定 base→当前 HEAD 的完整 DAG”证据。
依据: `git rev-parse --verify 'base^{commit}'` 只证实 base 对象存在；`git rev-list base..HEAD` 是集合差，即使 base 不是 HEAD 祖先也可成功；Q-2 没有执行 `git merge-base --is-ancestor base HEAD` 或等效祖先判定，却把这些命令的 exit 0 列为完整 DAG 验收结果。
说明: 在 Q-2 的当前 Git 核验中增加固定 initial base 对精确 `tested_head` 的祖先判定，失败即拒绝把范围输出解释为该 base 至 HEAD 的路径；保留现有逐提交、逐父边、全差异及全仓现场检查。
