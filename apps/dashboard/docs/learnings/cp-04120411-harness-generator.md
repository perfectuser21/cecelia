### 根本原因

WS2（Frontend 步骤列表 + 三栏钻取视图）的实现已在 WS1 PR 合并后随代码库同步完成。HarnessPipelineDetailPage.tsx 由 Workstream 1 的后端实现驱动，前端组件 StepList + ContentPanel + 手风琴模式在前一轮 harness 迭代中已写入。

### 下次预防

- [ ] Generator 在实现前先验证 DoD 测试命令是否已通过，避免重复实现已完成功能
- [ ] contract-dod-ws{N}.md 文件若不存在，应从 sprint-contract.md Workstreams 区块直接提取，不能依赖文件
