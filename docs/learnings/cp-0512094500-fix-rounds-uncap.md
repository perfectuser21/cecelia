# Learning — MAX_FIX_ROUNDS 3→20 (P1 B11: 质量优先无硬 cap)

**Branch**: `cp-0512094500-fix-rounds-uncap`
**Date**: 2026-05-12

## 背景

Walking Skeleton P1 W33 终验 trivial spec (`GET /hello?name=X`) 跑 4 round fix loop
全 FAIL 后被 MAX_FIX_ROUNDS=3 硬 cap 切 terminal_fail → 整 task status='failed'。
但 root cause 不是 spec 真不收敛，而是 generator 多 round 没改对 spec drift /
contract 严格度问题。**3 太死，过早放弃**。

## 根本原因（设计不对称）

PR #2901 给 GAN reviewer (`harness-contract-reviewer`) 用 `detectConvergenceTrend`
**无硬 cap**（趋势收敛）— 因为对抗目的是"找潜在问题"，硬 cap 让 reviewer 错过
深度问题。

但 **fix loop（routeAfterFix）** 还是硬 cap=3 — 不对称。Fix 的核心是"彻底修复"，
3 轮没修好就放弃违反"质量优先"原则。

## 修补

1. `MAX_FIX_ROUNDS` 3 → 20（实际 ≈ 无 cap，sanity 兜底防极端 spec 真死循环占 slot）
2. env `HARNESS_MAX_FIX_ROUNDS` 可覆盖（CI / 调试时可设小测早期终止）

## 下次预防

- [ ] **fix loop 应该用 `detectConvergenceTrend`（同 reviewer）**：连续 N 轮同
  fail_type / CI failed_checks 完全相同 → 真不收敛标 `unconvergent_fail`；否则继续
  fix。这是真正的"质量优先 + 趋势收敛"，比固定 cap 严谨
- [ ] **加 `state.fix_history[]` 字段**：每轮 fix 记 fail_type + 主要 changed_files，
  让趋势 detector 有数据
- [ ] **CI 内 cap 跟 prod cap 解耦**：CI 跑 spec 简单测试时 5 轮够，prod 真业务该
  无 cap；用 env 区分

## 关联

- Walking Skeleton P1 design B1-B10 全合 main 部署
- W32 failed: spec drift `/hello` → `/ping`；W33 failed: 4 round fix 没修好
- Reviewer 趋势收敛 PR #2901 引入 `detectConvergenceTrend`
- 用户判断：质量 > token cost；无硬 cap 是正确方向
