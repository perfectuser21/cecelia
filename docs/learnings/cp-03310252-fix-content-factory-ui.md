# Learning: 修复 ContentFactory + PipelineOutputPage UI 状态问题

## 根本原因

1. **ContentFactory pipeline 列表用 `<button>` 而非 `<Link>`**：原设计为展开/收起，未考虑导航需求。测试文件已预期 Link，但实现未跟进。

2. **无自动轮询机制**：ContentFactory 和 PipelineOutputPage 均只在 mount 时加载一次数据，用户必须手动刷新才能看到进度更新。

3. **StatusBadge 缺少 'pending' 映射**：fallback 直接展示原始英文 status 字符串。

4. **GenerationTab 只展示已创建的 stage**：用 `Object.entries(stages.stages)` 只迭代 DB 中已有的子任务，pipeline 执行中时只有部分阶段可见，用户无法看到整体进度。

5. **PipelineOutputPage.test.tsx 时间戳测试用 `findByText`（要求唯一匹配）**：多个 stage 有 `started_at` 时产生多个 "开始：" 元素，导致测试失败。

## 下次预防

- [ ] Pipeline 列表类 UI 设计时优先考虑 Link 导航（数据详情页），展开/收起作为辅助功能
- [ ] 有进度更新需求的页面必须加轮询（setInterval + cleanup），而非依赖手动刷新
- [ ] StatusBadge 新增 status 枚举时同步更新所有可能的 status 值映射（包括 'pending'）
- [ ] 基于有序常量（如 PIPELINE_STAGE_ORDER）渲染所有步骤，而非仅渲染已存在的数据
- [ ] 测试中多元素匹配场景用 `findAllByText` / `getAllByText`，而非 `findByText` / `getByText`
