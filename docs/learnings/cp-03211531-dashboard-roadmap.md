# Learning: Dashboard Roadmap 页面

## 概述
新建 Dashboard Roadmap 页面，展示 OKR 进度、Now/Next/Later 项目分布、Cecelia SelfDrive 思考、Agent 状态。

### 根本原因
Dashboard 原有 RoadmapView 展示的是旧的 Project/Feature/PRD 视图，不符合 OKR 体系。需要一个实时反映系统状态的新 Roadmap 页面。

### 下次预防
- [ ] CI DoD Test 中不要使用 `curl localhost` 作为测试命令，CI 环境无法连接本地服务
- [ ] 新建页面时同步创建 Learning 文件，避免遗漏
- [ ] Feature manifest 中注册新组件时保留旧组件引用（兼容性）

## 技术决策
1. **SelfDrive API**: 新增 `/api/brain/self-drive/latest` 端点，查询 `cecelia_events` 表中 `event_type = 'self_drive'` 且 `subtype = 'cycle_complete'` 的最新事件
2. **Projects 分组**: 优先使用 `current_phase` 字段，回退到 `status` 映射（in_progress=now, pending=next, 其他=later）
3. **配置驱动**: 复用现有 feature manifest 架构，在 planning/index.ts 注册新组件
