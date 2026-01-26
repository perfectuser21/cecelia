# QA Decision

Decision: NO_RCI
Priority: P2
RepoType: Business

Tests:
  - dod_item: "总览统计卡片显示正确（4个指标）"
    method: manual
    location: "manual:访问 /features 页面，验证统计卡片显示 Total Features、Sub-features、RCI Coverage、GP Coverage"

  - dod_item: "多维度分类统计完整（4个维度，支持切换）"
    method: manual
    location: "manual:切换 Category/Instance/Priority/Status 四个 tabs，验证图表数据正确"

  - dod_item: "Feature 列表表格功能完整"
    method: manual
    location: "manual:测试搜索、筛选、排序、分页功能"

  - dod_item: "Feature 详情抽屉显示完整信息"
    method: manual
    location: "manual:点击任一 Feature 的'查看详情'，验证所有字段显示正确"

  - dod_item: "依赖关系正确展示"
    method: manual
    location: "manual:在详情抽屉中验证 Dependencies 和 Dependents 列表"

  - dod_item: "实例过滤正常工作"
    method: manual
    location: "manual:Core 实例默认只显示 Core + Both 的 features"

  - dod_item: "响应式设计适配"
    method: manual
    location: "manual:在不同屏幕尺寸下测试布局"

  - dod_item: "数据层正确实现"
    method: auto
    location: "apps/dashboard/frontend/src/data/features-data.ts 的统计函数"

  - dod_item: "TypeScript 类型定义完整"
    method: auto
    location: "apps/dashboard/frontend/src/data/features-data.ts 类型定义"

RCI:
  new: []
  update: []

Reason: 这是一个纯展示型 UI 页面（Platform Feature），数据硬编码自 FEATURES.md，无核心业务逻辑变更，不涉及系统稳定性契约。此功能为辅助性工具（Priority: P2），不满足 RCI 的"Must-never-break"标准。测试以手动验证为主（UI/UX），辅以数据层的单元测试。
