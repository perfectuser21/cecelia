# B50 — GAN 合同膨胀发散（收敛代码侧）

## 根本原因

detectConvergenceTrend 只在 rubric 评分下降/震荡时判 diverging 强制收敛。
但 GAN 发散的典型形态是"合同越写越大"——Proposer 每轮加内容，评分上升或持平，
trend 判 "converging" → 永不停。实证合同 257→339→413→571 行，`6be730f3` 跑 15 轮不收敛。
收敛检测完全不看合同体积，"越来越大"对它隐形。

## 下次预防

- [ ] 收敛判定必须包含"产物体积"维度，不能只看质量评分
- [ ] "持平 + 体积增长"也是发散（评分没降但合同在膨胀）
- [ ] 收敛 = 越来越小或持平，不是评分越来越高（评分高可能靠堆量）

## 修复

`packages/brain/src/workflows/harness-gan.graph.js`：
- rubricHistory 条目新增 `contractLines`（该轮合同行数）
- detectConvergenceTrend 加检测：合同行数连续 2 轮净增长（a<b<c）→ diverging → force-approve
- 向后兼容：旧 history 无 contractLines 字段时跳过该检测

注：本 PR 只修代码侧兜底。Reviewer/Proposer SKILL 侧的"PRD 覆盖度评分 + 精简纪律"
改动在 zenithjoy-skills repo 的配套 PR（治本，让合同根本不膨胀）。
