# WS3 Dashboard 详情面板移植到正确路由页

### 根本原因
WS3 修改了 `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx`，但 Dashboard 通过 Core API DynamicRouter 加载的是 `apps/api/features/execution/pages/HarnessPipelinePage.tsx`。两个路径不同，WS3 的改动不可见。

### 下次预防
- [ ] Dashboard UI 改动必须检查 DynamicRouter 实际加载哪个文件（`apps/api/features/execution/pages/` 下的文件）
- [ ] `apps/dashboard/src/pages/` 下的文件可能是旧路径，优先改 `apps/api/features/execution/pages/`
- [ ] final_evaluate 分析真实运行页面路径，可以发现此类错误
