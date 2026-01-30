# QA Decision: 性能监控集成

## Decision: NO_RCI
## Priority: P2
## RepoType: Business

## 问题分类
- **类型**: Feature Enhancement
- **影响范围**: PerformanceMonitoring 页面
- **风险等级**: Low

## 测试策略

### 测试需求
| DoD 条目 | 方式 | 位置 |
|---------|------|------|
| PerformanceMonitoring 使用 settingsApi | manual | 访问页面验证 |
| 页面显示真实服务健康状态 | manual | 查看 UI |
| 构建无类型错误 | auto | npm run build |

### Tests
- dod_item: "PerformanceMonitoring 页面使用 settingsApi.getSystemHealth() 获取数据"
  method: manual
  location: manual:浏览器访问性能监控页面，检查 Network 请求

- dod_item: "页面正确显示各服务健康状态"
  method: manual
  location: manual:验证 brain/workspace/quality/n8n 服务状态显示

- dod_item: "代码构建无类型错误"
  method: auto
  location: npm run build

### RCI
- new: []
- update: []

## Reason
这是 UI 集成任务，将 PerformanceMonitoring 页面从 mock 数据改为使用正式的 settingsApi.getSystemHealth() API，显示真实的多服务健康状态。无需新增回归契约，通过构建检查和手动验证即可确保正确性。
