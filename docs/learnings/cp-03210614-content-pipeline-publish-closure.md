# Learning: KR3 内容流水线发布闭合

## 根本原因

`content-pipeline-orchestrator.js` 的 `content-export` 完成分支直接将 pipeline 标记为 `completed`，
没有为下游 8 个发布平台创建 `content_publish` 任务。
`executor.js` 已有完整的 8 平台路由逻辑（content_publish + platform → /xxx-publisher），
但缺少"上游触发"，导致内容生产到发布的链路完全断开。

## 修复

在 `advanceContentPipeline` 的 `content-export` 完成分支，新增 `_createPublishJobs()` 调用，
为 `PUBLISH_PLATFORMS`（8 个平台）逐一创建 `content_publish` 任务（fire-and-forget），
再将 pipeline 标记为 `completed`。含幂等保护：同一 pipeline + platform 不重复创建。

## 下次预防

- [ ] 新增 Pipeline 阶段时，检查最终阶段是否需要触发下游任务
- [ ] `_createPublishJobs` 等"触发下游"函数加 `// KR3 闭合` 注释，方便定位
- [ ] 测试中区分不同类型 INSERT 时，用 params[0]（title 特征）而非 params[N]（需要了解 SQL 参数位置）

## 关键数据

- 修改文件：`packages/brain/src/content-pipeline-orchestrator.js`（+65 行）
- 修改文件：`packages/brain/src/__tests__/content-pipeline-orchestrator.test.js`（+120 行）
- 测试数量：19 tests（新增 7 个测试用例覆盖 8 平台闭合逻辑）
- 8 个发布平台：douyin/kuaishou/xiaohongshu/weibo/shipinhao/wechat/zhihu/toutiao
