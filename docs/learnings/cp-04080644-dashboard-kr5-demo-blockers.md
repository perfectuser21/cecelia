# Learning: Dashboard KR5 演示阻断 Bug 修复

**分支**: cp-04080644-b24f59ec-2aa1-4eaa-bfe0-c246f4
**日期**: 2026-04-08

## 修复内容

1. **RoadmapPage** (`/okr-roadmap`) — Now 列永远为空
2. **RoadmapPage** — Later 列有 120 个 inactive 项目
3. **OKRPage** (planning) — Objective 进度永远显示 0%
4. **OKRPage** (planning) — 显示 28 个 Objective（含 archived/cancelled）

### 根本原因

**Bug 1 (RoadmapPage Now 列空)**:
`classifyProject` 只检查 `status === 'in_progress'`，但 Brain projects 实际使用 `active`/`queued` 等状态。导致 Now 列永远为空。

**Bug 2 (RoadmapPage Later 列爆表)**:
`activeProjects` 只过滤 `completed`，120 个 `inactive` 项目全部进入 Later 列，演示体验极差。

**Bug 3 (OKRPage Objective 0%)**:
Brain `area_okr` 数据中 `progress` 和 `current_value` 均为 `null`（只有 `area_kr` 子项才有进度数据）。代码用 `obj.progress ?? 0` 导致永远显示 0%。应从子 KR 的平均进度动态计算。

**Bug 4 (OKRPage 显示已归档项)**:
`areaOkrs` 过滤条件缺少 `status === 'active'`，导致 26 个 archived/cancelled 的 Objective 也显示出来。

### 下次预防

- [ ] Brain API 的 project status 枚举：`active`/`queued`/`planning`/`inactive`/`completed`，不是 `in_progress`
- [ ] 前端 `classifyProject` 类函数应覆盖所有可能状态，不能只写一个
- [ ] Objective 层的 progress 必须从子 KR 聚合计算，不能直接读 DB 字段（area_okr 无此字段）
- [ ] 所有 OKR 树过滤必须加 `status === 'active'`，避免 archived 数据污染演示
