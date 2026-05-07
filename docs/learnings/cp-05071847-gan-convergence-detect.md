# Learning: GAN 收敛检测取代 MAX_ROUNDS 硬 cap

## 背景

`packages/brain/src/workflows/harness-gan.graph.js` 之前用 `MAX_ROUNDS=5` 在 reviewer 第 5 轮 force APPROVED。
真实跑 Round 10 仍在抠正则缝隙的 meta-loop（commit `2303a935`），所以 4-23 加了硬 cap。

但用户原始设计是 GAN 无轮次上限（memory `harness-gan-design.md`），硬 cap 违背意图：复杂 spec 提前截断对抗。

## 根本原因

用轮数判收敛是粗暴的代理：真正想检测的是「质量是否还在变好」。
- 5 轮可能仍在收敛（converging），不该被砍
- 反过来 3 轮就开始震荡（oscillating）应该早点退场

## 解决方案

`detectConvergenceTrend(rubricHistory)` 看最近 3 轮 5 维度走势：

| 趋势 | 判据 | 行动 |
|---|---|---|
| insufficient_data | < 3 轮 | 继续 GAN |
| converging | 5 维度全部持平或上升 | 继续 GAN |
| diverging | 任一维度连续 2 轮严格走低 | force APPROVED + P1 alert |
| oscillating | 任一维度最近 3 轮高低高 / 低高低 | force APPROVED + P1 alert |

预算保护仍由 `budgetCapUsd` 兜底；轮数硬 cap 永远不再加。

## 下次预防

- [ ] 看到「我希望无上限地走，但要收敛」式诉求 → 不要用次数硬 cap，用趋势检测
- [ ] 任何 LangGraph 状态机加轮次保险丝时，先想：「能不能用质量信号（rubric / cost / 收敛度）取代次数？」
- [ ] memory `harness-gan-design.md` 已更新——若再次有人提议加 MAX_GAN_ROUNDS，直接驳回并指向此文件
- [ ] 修改 SKILL.md 时同步检查代码侧描述（这次 reviewer SKILL.md 还写着「MAX_ROUNDS=5」，已更新）
