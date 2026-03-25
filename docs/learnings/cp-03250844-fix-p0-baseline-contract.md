# Learning: P0 修复 — brain-integration-baseline 归零

## 根本原因

`packages/brain/ci/brain-integration-baseline.txt` 的值为 `1`，导致 CI L4 brain-integration 检查允许最多 1 个集成测试失败仍然通过。这是一个技术债机制，使得 main 分支可以在带有失败集成测试的情况下合并代码。

根源：baseline 文件原本用于"渐进式修复"期间临时容忍失败，但从未被清零，演变为永久性豁免机制。

## 下次预防

- [ ] baseline 文件变更必须有 PR + 审查，不允许悄悄调高 baseline 值
- [ ] CI L4 检查中添加注释：baseline=0 是契约值，调高需要技术负责人批准
- [ ] 新建 baseline 文件时，在文件旁边放 README 说明其用途和归零时间表
