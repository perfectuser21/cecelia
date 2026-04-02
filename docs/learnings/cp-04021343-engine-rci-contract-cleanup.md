# Learning: regression-contract.yaml 孤儿条目清理

**日期**: 2026-04-02
**分支**: cp-04021343-engine-rci-contract-cleanup

## 背景

删除功能文件时，regression-contract.yaml 中对应的 RCI 条目没有同步删除，
导致 `evidence.run` 执行 `test -f` 检查时会找不到文件而失败。

## 清理结果

- 删除 5 个已失效 RCI 条目（PE-001/DEVGATE-PLAYWRIGHT-EVAL-001/PE-002/RCI-sprint-report/RCI-sprint-contract-loop）
- 删除 2 个孤儿脚本（push-metrics.sh/check-learning.sh）

### 根本原因

大型重构（slim-engine-heartbeat）删除功能脚本时，regression-contract.yaml 中的
对应条目没有在同一 PR 批次清理，形成"文件已删但合约条目仍存在"的矛盾状态。

### 下次预防

- [ ] 删除 scripts/devgate/ 下任何文件时，同一 PR 必须检查并删除 regression-contract.yaml 中引用该文件的条目
- [ ] DoD 测试应检查 RCI 条目 id（精确匹配），而不是文件名字符串（会误匹配 changelog 注释）
