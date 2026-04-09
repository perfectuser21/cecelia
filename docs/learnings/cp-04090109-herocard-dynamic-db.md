---
branch: cp-04090109-ec3ccc43-a881-4b18-8a61-cf1a13
task: feat(miniapp): 首页动态数据接入 — heroCard从DB加载
merged_pr: zenithjoy-miniapp#2 (38326af)
date: 2026-04-09
---

# Learning: heroCard 动态加载实现

### 根本原因

Brain 调度此任务时，zenithjoy-miniapp 仓库中已有 PR #2 完成了 `loadHeroCard()` 实现并合并。Brain 任务状态未及时回写为 completed，导致任务重复派发。

### 实现要点

- `wx.cloud.database().collection('dynamic_content')` 查询时需指定 `type: 'hero_card'` + `active: true`
- `orderBy('updated_at', 'desc').limit(1)` 确保取最新一条
- 失败时用 `console.warn` 静默降级，保持静态默认值不崩溃
- `onLoad()` 中调用 `this.loadHeroCard()`，不阻塞其他初始化

### 下次预防

- [ ] miniapp 功能开发完成后立即回写 Brain 任务状态，不要等到 CI 通知
- [ ] Brain 任务派发前检查目标仓库是否已有相关 PR/commit，避免重复执行
- [ ] 跨仓库任务（cecelia Brain → zenithjoy-miniapp）完成后需在两处都标记：miniapp PR + Brain task status
