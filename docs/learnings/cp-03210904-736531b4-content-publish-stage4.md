# Learning: content_publish Stage 4 manifest_path 传播修复

## 任务
修复 content-pipeline Stage 4（export→publish）断链：`_createPublishJobs` 未将 findings 传入 content_publish 任务 payload

### 根本原因
`advanceContentPipeline` 调用 `_createPublishJobs` 时未传入 `findings` 参数，导致 content_publish 任务的 payload 中缺少 `manifest_path` 和 `card_files`，发布 skill 无法定位内容。

### 下次预防
- [ ] Pipeline 阶段之间传递数据时，明确检查是否所有 findings 都被下游方法接收
- [ ] 新增阶段时同步更新 executor.js 的 PRD 构建逻辑（content_publish 需要特殊 PRD 含内容路径）
- [ ] Pipeline rescue 前必须先读取 `.task-{branch}.md` 确认实际任务，而不是依赖根目录 DoD.md（后者可能是过期文件）
