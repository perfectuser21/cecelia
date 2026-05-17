# Learning: Dashboard OKR Roadmap 页面

**分支**: cp-03210049-fd6b4106-548c-4ed8-b0c8-89ed91
**日期**: 2026-03-21

## 变更摘要

新增 Dashboard `/okr-roadmap` 路由页面，展示 OKR 实时看板（Now/Next/Later 三列 + KR 进度 + SelfDrive 思考 + Agent 活动）。

### 根本原因

Brain 已有完整的 OKR/Projects/Agent 调度体系，但缺少统一的「现在在做什么」视图。用户需要快速了解：哪些项目正在推进、每个项目的 KR 进度是多少、SelfDrive 最近做了什么决策。

### 关键发现

1. **SelfDrive 数据存在 cecelia_events 表，非 brain_events**：`/api/brain/events` 查询的是 `brain_events`，SelfDrive 的 cycle_complete 事件存在 `cecelia_events`。因此页面对 cycle_complete 的查询通常返回空，需要降级显示 `[SelfDrive]` 前缀任务作为代理。

2. **goals 表没有 kr 类型**：实际数据只有 `area_okr` 和 `vision` 两种 type，没有 `kr` 类型。KR 数据即为 area_okr 类型的 goals。

3. **feature manifest 注册模式**：Dashboard 页面注册在 `apps/api/features/system-hub/index.ts` 的 components 对象中，路径写为 `() => import('../../../dashboard/src/pages/xxx/XxxPage')`。这是添加新页面的正确位置。

4. **Now/Next/Later 分类**：用 project.status 区分（in_progress=Now，pending+有kr_id=Next，其余=Later），completed/canceled 项目过滤掉。

### 下次预防

- [ ] 新增 Dashboard 页面时，先检查 `system-hub/index.ts` 是否有对应 navItem、route、component 三处都要添加
- [ ] 查询 SelfDrive 历史时，应用 `cecelia_events` 而非 `brain_events`，或直接查带 `[SelfDrive]` 前缀的任务作为代理
- [ ] goals 类型枚举应从实际 API 响应推断，不要假设有 `kr` 类型
