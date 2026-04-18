# EPICS

> 基于 Plan Agent 2026-01-15 给出的 19 PR 路线图，归类为 6 个 Epic（A-F）。
> 每 Epic 表格：目标 / PR 列表 / 完成率 / 下一步

---

## Epic A — PRD / DoD 工程化（Autonomous 可审计层）

| 字段 | 内容 |
|------|------|
| 目标 | PRD 从"对话蒸发"变"工程资产"：Dashboard 可查、PR body 自动回链、DoD 可机械化验证 |
| PR 列表 | #2373 (A1 PRD Viewer) / #2376 (A2 PR body 回链) / A3 待启 / A4 待启 |
| 完成率 | 2/4 = 50% |
| 下一步 | A3 PR 合并时自动回写 Brain task status；A4 Dashboard /tasks/:id 勾选状态展示 |

---

## Epic B — Superpowers 结构对齐（顶层骨架）

| 字段 | 内容 |
|------|------|
| 目标 | Cecelia /dev 4-Stage Pipeline 与官方 Superpowers skill 结构一一对应 |
| PR 列表 | 早期对齐已完成（历史 PR 未列）；新纳入 F3/F4 做缺口补齐 |
| 完成率 | 100%（骨架层），交互点细节移交 Epic F |
| 下一步 | 无，维护态 |

---

## Epic C — Schema / 数据对齐

| 字段 | 内容 |
|------|------|
| 目标 | Brain tasks / decisions / dev-records 表结构规范化；apps 层读取统一 |
| PR 列表 | #2377 (C2 tasks schema normalize) 已合 |
| 完成率 | 100% |
| 下一步 | 监控，如 Dashboard 显示字段不符时跟进 |

---

## Epic D — Brain 决策层现代化

| 字段 | 内容 |
|------|------|
| 目标 | 手写 harness 状态机 → LangGraph；tick 引入 back-pressure；调度死穴清零 |
| PR 列表 | #2385 (LangGraph Phase 0) / #2393 (claimed_by 过滤) / #2396 (back-pressure) / D1 待启 / D2 待启 |
| 完成率 | 3/5 = 60% |
| 下一步 | D1 decomp 决策引擎接 LangGraph；D2 tick 心跳 back-pressure 细化 |

---

## Epic E — 运行时观测 + 成本

| 字段 | 内容 |
|------|------|
| 目标 | LLM token 成本可观测；Skill 版本升级可回退；Dashboard 呈现活体系统健康 |
| PR 列表 | E1 待启（LLM usage 接入 Brain DB）/ E2 (已并入观察能力)/ E3 待启（Skill migration） |
| 完成率 | 0/3 = 0% |
| 下一步 | E1 先做 LLM 成本观测，再做 E3 |

---

## Epic F — Superpowers 交互点 1:1 复刻（底层细节）

| 字段 | 内容 |
|------|------|
| 目标 | Cecelia skill 内的每个交互点对齐官方 Superpowers 5.0.7 的行为 |
| PR 列表 | #2382 (F3 三缺口补齐) / #2386 (F4 四 skill 引入 + 四 gap 修) / F4.1 待启 |
| 完成率 | 2/3 = 67%（skill 79% / 交互点 95%） |
| 下一步 | F4.1 补齐剩余 5% 交互点（非关键路径） |

---

## Epic 聚合统计

| Epic | 完成率 | 剩余 PR |
|------|--------|---------|
| A | 50% | 2 |
| B | 100% | 0 |
| C | 100% | 0 |
| D | 60% | 2 |
| E | 0% | 3 |
| F | 67% | 1 |
| **总计** | **8/14 PR = 57%** | **8** |

---

## 维护规则

- 每次 PR 合并时：找到对应 Epic，把 PR 号加到 PR 列表，更新完成率
- 每个 Epic 完成率达到 100%：下一步字段改成"维护态"
- 新 Epic 通过 /plan 或 strategy-session 识别后，在表格末尾追加
