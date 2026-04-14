### 根本原因

WS3 实现了 Harness v6-hardening 监控与 UI 层：
1. `harness.js` 的 `buildStages()` 从 6 步扩展为 10 步（新增 evaluate/auto-merge/deploy/smoke-test/cleanup），前端 StageTimeline 补全未到达的步骤显示为 not_started
2. `harness.js` 新增 `/stats` 端点，通过 SQL COUNT/AVG 计算 completion_rate、avg_gan_rounds、avg_duration
3. `health-monitor.js` 在运行结果中注入 `callback_queue_stats`（unprocessed + failed_retries），查询 callback_queue 表
4. 新建 `HarnessPipelineStatsPage.tsx`，在两个 feature manifest（system-hub/execution）中注册

### 下次预防

- [ ] find 命令结果可能含目录，readFileSync 前需 statSync().isFile() 过滤，否则 EISDIR
- [ ] 前端新增页面需在两处注册：system-hub/index.ts + execution/index.ts（如果 execution 有独立 pages 目录）
- [ ] execution/pages/ 如已有同名组件，检查是否独立实现还是 re-export，保持一致性
