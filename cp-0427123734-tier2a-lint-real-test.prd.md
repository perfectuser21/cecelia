# PRD: Tier 2 PR-A — lint-test-quality 机器拦"假测试 stub"

## 背景

承接 Tier 0/1（PR #2664 + #2665 已合）。4 agent 审计找出 Brain 单测可信度 28/100 的核心症状：

- 最近 5 个 feat PR 测试质量平均 **1.8/5**（纯 grep / file-exists / typeof 假断言）
- "假绿"案例：commit 2cd1f71b / a8d9db993 / e35a78cee 都是"加常量 grep 测试 → src 没改 → 测试通过 → prod bug 仍在"
- 现有 `lint-test-pairing` / `lint-feature-has-smoke` / `lint-tdd-commit-order` 只验"文件存在"或"格式正确"，**不验内容真做事**
- 我自己刚在 PR #2660 期间就建了 `dispatcher.test.js` stub 满足 lint-test-pairing —— 是这个反模式的活教材

用户原话："是否能够真正的加这个 1 to 1 的 test，这是关键"。机器必须拦掉假测试，否则 1-to-1 还是 0-to-0。

## 目标

新增 `lint-test-quality` lint 在 PR diff 中扫新增 test 文件（不动老的 grandfather），机器化拦掉 3 类假测试：

1. **stub 签名**：用 readFileSync(src/...) grep 验 + 完全无 await 业务调用 — 这是"加 stub 文件骗 lint-test-pairing"的死锁签名
2. **空架子**：完全没 expect 调用
3. **全 skip**：所有 it/test 都被 .skip 包

## 范围

### 一、新增 `.github/workflows/scripts/lint-test-quality.sh`
- 3 条硬规则（HARD FAIL）
- 仅作用于 `git diff --diff-filter=A` 新增 test 文件，老测试 grandfather
- 跨 macOS/Linux 兼容（不依赖 awk/sed 高级语法）

### 二、自跑 smoke `.github/workflows/scripts/__tests__/lint-test-quality-cases.sh`
- 4 case：stub/empty/all-skip 应 fail，真 await+expect 应 pass
- 每个 case 独立 fake-git tmpdir 隔离

### 三、`ci.yml` 加 job + ci-passed needs
- pull_request only，3 min timeout
- ci-passed needs 列加 lint-test-quality

### 四、Engine 18.9.0 → 18.10.0 + feature-registry changelog

## 验收

- 本 PR 自身 CI lint-test-quality job ✅（无新增 test 跳过）
- 自跑 smoke 4/4 pass
- 下个 PR 试图加 stub test → CI 真拦
