# Handoff：decomp/initiative_plan 线改造 · 下个 session 入口

**日期**：2026-07-20 深夜
**来源 session**：2291155c（工厂域 GP 地图 + 四十孤岛收官会话）
**状态**：主理人已拍板要改造，需求未说——**下个 session 第一件事就是听主理人讲改造方向**

## 主理人原话（拍板依据）

> "Initiative Plan 加上 Decomp 这条，这条线是我们要改造的。它可以不删，但是我们下一步就要动这个。我现在马上就要去动这个。"（后改为"这个我在下一个 session 说"）

## 这条线的现状（本 session 已查实，接手者不用重查）

- **接线**：task-router 里 `initiative_plan/scope_plan/project_plan/okr_*_plan → /decomp`、`decomp_review → /decomp-check` 全部 wired
- **活性**：自动触发链 4 月起彻底冷——`initiative_plan` 最后一条 2026-04-21（共3条），`scope_plan` 最后 2026-04-04（共1条），`project_plan/okr_*/decomp_review` 历史 0 条
- **skill 本体**：/decomp（秋米）、/decomp-check（Vivian）没死，仍接在交互式入口
- **相关半死件**：strategy_session（史上仅1条且cancelled）、direction-proposer（scheduler 每周一自 gate，gapsTotal=0 空转）、strategy-trigger（active_goals=0 应急网）、strategy-session-parser（测试僵尸，**特意从退役批次3中排除**留给本次改造一并处置）
- **主理人现行立项方式**：golden_paths 刀提案流（mapper→proposer→reviewer→拍板→controller 点火），对应工厂域地图 F0 路

## 改造时的锚点

- 工厂域地图：https://docs.zenjoymedia.media/cecelia-factory-gp-map/ —— 这条改造应归 F0 提案拍板闭环（或主理人重新定义）
- 地图待拍板#1（8条路切法整体落库）尚未拍——decomp 改造方案可能影响 F0 定义，建议一起拍
- 决策记录：decisions 表 07-20 「孤岛处置拍板③：decomp/initiative_plan线保留待改造」

## 并行在跑的事（别撞车）

- 退役批次1 `c3adb5e6`（queued，Brain 自动跑）：n8n archive + engine harness + 重复桩
- 批次2/3/4（blocked，07-21/22/23 错峰释放，各批前置=上批 merge+nightly 绿）
- 批次3 明确不含 strategy-session-parser（归本改造管）

## 下一步

1. 听主理人讲改造方向（他说下个 session 说）
2. 按 F0 流程走：mapper 归位判定 → proposer 出提案 → reviewer 对抗 → 拍板 → 点火
3. 改造落地时顺手处置：strategy-session-parser、strategy_session 路由、direction-proposer/strategy-trigger 的去留
