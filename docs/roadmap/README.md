# Cecelia Roadmap

> 持久化 roadmap 入口总表。人和 agent 都能查到：当前聚焦什么 / 还要做什么 / 已放弃什么。
> 相关文档：[EPICS.md](./EPICS.md) · [superpowers-sync.md](./superpowers-sync.md) · [blind-spots.md](./blind-spots.md)

---

## Current Quarter Focus

**Q1 2026 聚焦 autonomous + Superpowers 对齐**

核心主题：
- autonomous 全流程稳定跑通（Decomp → Dev → CI → Merge 端到端不掉链）
- 与官方 Superpowers 5.0.7 交互点 1:1 对齐（F 系列 PR 已完成 79% skill 覆盖 / 95% 交互点）
- Brain 自主派发链路补强（调度死穴修复 + 决策层 LangGraph 化）
- PRD/DoD 工程化可验证（A 系列 PR 的 PRD Viewer + DoD 机械化验证）

---

## Now（本周在做，≤ 3 项）

| # | 项目 | 负责分支/PR | 状态 |
|---|------|------------|------|
| 1 | R1 Roadmap 视觉系统（本 PR） | cp-04181010-r1-roadmap | in_progress |
| 2 | F4 Superpowers 1:1 复刻收尾 | #2386 已合 | done |
| 3 | Brain Docker 化执行器稳定化 | #2384 已合，观察中 | monitoring |

---

## Next（下阶段待启动，按优先级）

| # | 项目代号 | 说明 | 预估工时 |
|---|---------|------|---------|
| 1 | A3 | PR body 自动回写 Brain task status（闭环） | 2h |
| 2 | A4 | Dashboard /tasks/:id 页面展示 PRD + DoD 勾选状态 | 4h |
| 3 | D1 | Brain decomp 决策引擎接入 LangGraph（替换手写路由） | 6h |
| 4 | D2 | Brain tick 心跳 5min 周期引入 back-pressure | 3h |
| 5 | E1 | LLM 成本观测看板（Codex/Claude usage 接入 Brain DB） | 4h |
| 6 | E3 | Skill 版本 migration 机制（/engine 升级时回退能力） | 6h |
| 7 | F4.1 | Superpowers 交互点剩余 5% 补齐（非关键路径） | 2h |

---

## Later（长期愿望池，暂无 ETA）

- Dashboard roadmap 可视化 UI（R1.1 接续）
- 真实 DB 化 roadmap（从 markdown → PostgreSQL）
- 自动回填历史 commit/PR → EPICS.md
- Superpowers 月度自动 diff 报告（升级冲击分析）
- 跨 worktree 并行 agent 冲突检测器

---

## Completed（近 30 天合并 PR）

2026-04-18：
- #2370 autonomous Day1 Stop Hook typescan
- #2373 PRD Viewer A1
- #2376 PR body 自动贴 PRD 链接 A2
- #2378 Harness v5.2 稳定化
- #2379 Preflight payload priority fix
- #2380 Stop Hook 跨会话修复
- #2382 F3 Superpowers 三缺口补齐
- #2386 F4 Superpowers 1:1 复刻
- #2389 LangGraph Phase 0 骨架
- #2390 Brain LLM service 路由暴露
- #2393 selectNextDispatchableTask claimed_by 过滤
- #2394 Brain 进程健康 vs 系统内存压力区分
- #2396 Brain tick back-pressure 初版
- #2383 4 个 P0 死穴 bug 救急
- 本 PR：R1 Roadmap 视觉系统

---

## Abandoned（已放弃项，带原因）

| 项目 | 放弃原因 | 放弃时间 |
|------|---------|---------|
| _（空）_ | _（模板位，放弃项出现时填入）_ | _YYYY-MM-DD_ |

---

## 维护规则

- **Now 更新**：每周一手工更新，≤ 3 项
- **Next/Later 更新**：每次 /plan 或 strategy-session 产生新方向时追加
- **Completed 回填**：每次 PR 合并后追加一行（本 PR 的 A3 会实现自动化）
- **Abandoned 归档**：每次 /decomp 或 Brain decision 裁决"不做"时归档
