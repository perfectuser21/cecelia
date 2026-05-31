# Spec: GAN PRD 覆盖度收敛模型（B50）

**Date**: 2026-05-31
**Branch**: cp-05312222-b50-gan-convergence

## 问题

GAN（Proposer ↔ Reviewer）对简单任务发散：合同逐轮膨胀（实证 257→571 行，`6be730f3` 跑到 15 轮不收敛），正是用户警告的"越来越大"。

根因是结构性目标错配：
- **Reviewer** 按绝对质量理想打分（≥2 risk、≥4 behavior 不论任务大小），简单任务永远凑不齐"全 7 维 ≥ 7" → 无限 REVISION
- **Proposer** 只有"必须加"规则、零"精简"规则，line 709 明文禁止简单任务缩水 → 合同只增不减
- **detectConvergenceTrend** 只在评分下降时强制收敛；加内容让评分上升 → 判 "converging" → 永不停；且完全不看合同体积

## 核心理念

把 GAN 目标从"无限逼近质量理想"换成"覆盖完 PRD 就停"。

> **"全" 有边界（PRD 覆盖清单），"复杂" 无边界（无限加严谨度）。**

合同**完成**定义（DONE）：PRD 的每个 Golden Path 步骤 + 每个响应字段 + happy/error/edge 路径，**各有且仅有一条**验证。多一条 = 冗余（扣分），少一条 = 漏覆盖（扣分）。

这样：
- 复杂功能 → PRD 大 → 覆盖清单长 → 走 15-20 轮也在朝 100% 收敛 ✅
- 简单功能 → PRD 小 → 覆盖清单短 → 2-3 轮覆盖完即停，不膨胀 ✅
- 轮数不限，但有界目标保证收敛

## 改动清单（三处协同，必须一起改）

### Fix 1: Reviewer SKILL（zenithjoy-skills/harness-contract-reviewer/SKILL.md）

1. **`scope_match_prd` 双向惩罚**：现在只罚"漏覆盖 PRD"。新增"超覆盖"惩罚——合同含 PRD 未要求的内容（额外 risk/behavior/场景）→ 该维度扣分。直接把"加冗余"变成负分。
2. **阈值相对 PRD**：删除"≥4 BEHAVIOR / ≥2 risk 不论任务大小"的绝对底线。改为"覆盖 PRD 每个字段/路径，无 padding"。PRD 只有 1 端点 1 成功 1 报错 → 2-3 条 behavior 就是"全"。
3. **收敛追踪段**（新增）：每轮 Reviewer 必须先报 `## 收敛状态`——上轮 N 个阻塞问题解决了几个；新问题只能是"PRD 某项未覆盖"（真阻塞），不能是"可以更严谨"。issues 必须逐轮减少。

### Fix 2: Proposer SKILL（zenithjoy-skills/harness-contract-proposer/SKILL.md）

1. **删 line 709 硬底**："本任务行为简单，1 条够了" 不再禁止——改为"覆盖 PRD 每个字段/路径，PRD 有几条就几条，禁止 padding 凑数"。
2. **加精简纪律**：处理 Reviewer 反馈时先删冗余再加必要，净变化趋近 0（对齐"加厚先减肥"纪律）。
3. **scope 不蔓延**：PRD 未描述的场景/字段不准加进合同。

### Fix 3: 收敛代码（packages/brain/src/workflows/harness-gan.graph.js）

1. **合同体积纳入发散检测**：`detectConvergenceTrend` 或新增检测——合同行数连续 N 轮（建议 2）净增长且评分未全过 → 判 diverging → force-approve + P1 alert。
2. **追踪阻塞问题数**：Reviewer 输出的阻塞问题数连续 N 轮不下降 → 判卡死 → force-approve。
3. 维持现有"评分下降/震荡 → force-approve"逻辑不变（互补）。

## 测试策略

- **Fix 3（代码）**：unit test —— 喂 mock rubricHistory + 合同行数序列（递增），断言 detectConvergenceTrend 返回 diverging；喂递减/持平合同行数，断言正常 converging。
- **Fix 1/2（SKILL）**：文档改动，无单测；靠下一次真实 sprint 验证收敛（合同行数逐轮持平/下降）。

## 验收

- detectConvergenceTrend 对"合同连续 2 轮净增长"返回 diverging（新 unit test 绿）
- 重跑 harness-runs API sprint：GAN 在 ≤5 轮内 APPROVED，合同行数不超过 ~150 行（不再膨胀到 571）

## 范围

3 处协同改动，分 2 个 PR：
- PR-A（本 worktree，cecelia repo）：Fix 3 收敛代码 + unit test
- PR-B（zenithjoy-skills repo）：Fix 1 + Fix 2 两个 SKILL
