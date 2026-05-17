# Learning: LiveMonitorPage goals 类型过滤遗漏 area_kr

**分支**: cp-04080822-a67c0070-2305-426e-a497-3ed1d8
**PR 类型**: fix

### 根本原因

Brain API (`/api/brain/goals`) 返回的 goal 类型为 `area_kr`（不是 `kr`），但 LiveMonitorPage 第 1249 行的过滤条件为：

```js
goals.filter((g) => ['area_okr', 'global_okr', 'kr'].includes(g.type))
```

遗漏了 `area_kr`，导致所有 KR 被过滤掉，OKR 面板"活跃 KR"始终显示 0。

RoadmapPage 已有正确处理（normalize `area_kr` → `kr`），但 LiveMonitorPage 没有同步。

### 下次预防

- [ ] 任何直接比较 goal type 的地方，需同时处理 `kr` 和 `area_kr`（Brain 会返回后者）
- [ ] 新增 goal 展示页面时，参考 RoadmapPage 的 `normalizeGoalType` 函数
- [ ] 两处 normalize 逻辑趋同时，考虑提取为共享 util

