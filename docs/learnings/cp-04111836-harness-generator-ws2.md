### 根本原因

实现 Harness Pipeline 节点卡片改版 + 步骤详情子页面（WS2 前端）。关键发现：api pages 目录只是 re-export 层，真实组件在 apps/dashboard/src/pages/harness-pipeline/。

### 下次预防

- [ ] 改 dashboard pages 前先检查 api/features/execution/pages/ 是否有同名 re-export 文件，二者需同步
- [ ] StepPage 的 navigate 路径必须与路由 manifest 中注册的 path 完全一致
- [ ] 新增路由后需在 manifest 的 components 字典中同步注册 lazy import
