# R1 — Roadmap 视觉系统 + Superpowers 升级追踪

## 背景

今天（2026-04-18）完成 15 PR 后发现：没有地方能持久看到"当前聚焦什么 / 接下来做什么 / 已放弃什么 / Superpowers 最近升级到什么版本"。所有 Plan Agent 产出只活在对话里，session 结束就蒸发。

## 根本原因

Roadmap/战略方向/升级历史没有持久化视图是**认知机制缺失**：

1. **feature-registry.yml** 只记 engine skill 已做的 changelog，不是方向
2. **docs/current/** 是现状快照，不是 roadmap
3. **Brain tasks 表** 是操作队列，不是聚合视图
4. **Superpowers 版本**没有跟踪机制 — 官方升级时我们无感
5. **共同盲点**（两边都没解决的问题）分散在对话里，不落地就会一再重复踩

结果：每次对话都要重建上下文；agent 拿不到"当前方向"，容易发散。

## 修复方案

1. 新建 `docs/roadmap/` 四份 markdown：
   - README.md 入口总表（Current Quarter Focus / Now / Next / Later / Completed / Abandoned）
   - EPICS.md 6 Epic 状态表
   - superpowers-sync.md 对齐历史
   - blind-spots.md 5 个共同盲点
2. `scripts/check-superpowers-upgrade.sh` 月度 cron 检测官方版本变化
3. Engine 14.17.0 → 14.17.1 patch bump 只为记录本次变更

## 下次预防

- [ ] 每次 /plan 或 strategy-session 产生新方向时，追加到 `docs/roadmap/README.md` 的 Next/Later 列
- [ ] 每次 PR 合并后追加到 Completed 列（后续 A3 PR 会自动化）
- [ ] 每次 /decomp 裁决"不做"时归档到 Abandoned 列
- [ ] 每季度或 Superpowers 发版时手工补一条 superpowers-sync.md
- [ ] 新发现"两边都没解决"的盲点时追加到 blind-spots.md
- [ ] cron 告警 Superpowers 新版本时启动新 F 系列 PR 评估

## 踩坑

- dev-lock 初版不小心把 `tty` 字段写成 `not a tty\nnot-a-tty` 两行，立即改回 `not-a-tty` 单行。session_id / owner_session / task_id 四字段必全。
- `packages/engine/scripts/generate-path-views.sh` 在本仓库不存在，只有文档里提过。本 PR 未触及 engine/skills/，不需要跑。
