# Learning: P0 修复 — brain-integration-baseline 归零

## 根本原因

`packages/brain/ci/brain-integration-baseline.txt` 的值长期为 `1`，导致 CI L4 brain-integration 允许最多 1 个集成测试失败仍然通过门禁。
这个机制原本是"渐进式修复"期间的临时容忍机制，但从未被归零，演变为永久性技术债：main 分支可以在带有失败集成测试的情况下合并代码。
根本原因是 baseline 文件缺乏所有权和生命周期管理——没有注释说明用途、没有归零 deadline、没有变更审批机制。

## 下次预防

- [ ] baseline 文件变更必须有 PR + 审查，禁止直接调高 baseline 值
- [ ] CI L4 检查中添加注释：baseline=0 是契约值，调高需要技术负责人批准
- [ ] 新建 baseline 文件时，文件内必须包含注释说明其用途和归零时间表
