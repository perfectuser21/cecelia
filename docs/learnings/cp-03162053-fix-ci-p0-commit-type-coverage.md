---
id: learning-cp-03162053-fix-ci-p0-commit-type-coverage
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
changelog:
  - 1.0.0: 初始版本
---

# Learning: CI P0 修复 — fix commit 不跳 L3 + coverage-delta 接上基线

## 任务概要

修复两个 P0 级 CI 问题：`fix:`/`refactor:`/`chore:` commit 错误跳过 L3 测试、`coverage-delta` job 缺少基线下载导致无法做 delta 对比。

## 根本原因

### 问题 1：fix: commit 跳过 L3

原 `detect-commit-type` 的 skip 列表包含 `fix|docs|style|refactor|chore|test|perf`，出发点是"这些改动不大，跳过可以加速 CI"。但这个策略有严重漏洞：bug fix 是最容易引入回归的场景，恰恰不应该跳过测试。

### 问题 2：coverage-delta 基线缺失

`coverage-delta` job 调用 `davelosert/vitest-coverage-report-action@v2` 时没有配置 `json-summary-compare-path`，也没有 `actions/download-artifact` 步骤下载 `coverage-baseline` artifact。结果：PR comment 只展示当前 PR 的绝对覆盖率数字，不是 delta 对比。

## 修复方案

### fix: commit skip 策略

```yaml
# 修改前（危险）
fix|docs|style|refactor|chore|test|perf)
  echo "should_run_l3=false"

# 修改后（安全）
docs|style)
  echo "should_run_l3=false"
# 其他所有 commit type 均运行 L3
```

**原则**：只有纯文档（`docs:`）和样式（`style:`）改动才跳过 L3。代码相关的 `fix:`/`refactor:`/`chore:`/`test:`/`perf:` 全部运行 L3。

### coverage-delta 基线对比

```yaml
# 在 Run coverage 步骤之后，Coverage Delta Report 之前添加：
- name: Download Coverage Baseline
  uses: actions/download-artifact@v4
  continue-on-error: true   # 首次运行（无基线）不阻塞
  with:
    name: coverage-baseline
    path: /tmp/coverage-baseline

- name: Coverage Delta Report
  uses: davelosert/vitest-coverage-report-action@v2
  with:
    json-summary-path: packages/brain/coverage/coverage-summary.json
    json-summary-compare-path: /tmp/coverage-baseline/coverage-summary.json  # 新增
```

`continue-on-error: true` 保证首次 PR（main 上还没有 baseline artifact）时不阻塞。

## 技术要点

- `actions/download-artifact@v4` 的 `continue-on-error: true` 是必须的——artifact 不存在时 action 会 exit 1
- `json-summary-compare-path` 指向本地路径，download-artifact 会把文件放到 `path` 下，所以路径是 `/tmp/coverage-baseline/coverage-summary.json`
- `coverage-baseline` artifact 的 upload 在 `coverage-baseline` job 里（push to main），文件名需要完全一致

## 下次预防

- [x] CI skip 策略：只跳 docs/style，代码相关 commit type 一律运行 L3
- [x] coverage delta：先 download artifact，再 report，首次运行用 continue-on-error 保护
- [ ] 后续：设置覆盖率最低阈值，让 coverage-delta 真正有牙齿（阻塞而非仅展示）
