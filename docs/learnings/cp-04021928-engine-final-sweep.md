# Learning: Engine 最终扫尾

**日期**: 2026-04-02

## 背景
三路并行 agent 审计发现：5个测试已删脚本的测试文件、branch-protect.sh 死掉的 seal 防伪代码、
hook-utils.sh 的 develop/master 死分支检查、运行时产物被 git 跟踪、.git-rewrite 历史残留。

### 根本原因
1. 测试文件没跟随被测脚本一起删除
2. branch-protect.sh 的 seal 防伪在 devloop-check v4.0.0 删除时未同步清理
3. 运行时产物（.quality-evidence.json 等）不在 .gitignore 中

### 下次预防
- [ ] 删除脚本时 grep -rl 找所有引用（包括测试文件和 RCI 条目）一起删
- [ ] .gitignore 必须覆盖所有运行时产物模式
