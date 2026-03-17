---
version: 1.0.0
created: 2026-03-17
---

# Learning: CI Arch-Review 4 项安全修复

## 背景

全量 arch-review 在上轮 CTO 修复（6 项，PR #1000）基础上继续发现 4 个漏洞，形成第二轮修复。

## 根本原因

### P0-1：对称性缺失
L3 brain-unit 添加了 MAX_BASELINE=5，但 L4 brain-integration 遗漏了同等保护。修复时必须检查所有相同模式的地方是否都做了同等处理。

### P0-2：软/硬判断不一致
L3 gate 大多数检查用 `!= "success"`（正确），但 test-coverage-required 和 coverage-delta 用的是 `= "failure"`（漏掉 skipped 状态）。这是复制粘贴引入的细微不一致，单看代码很难发现，只有横向比较才能发现。

### P0-3：continue-on-error 是安全反模式
`continue-on-error: true` 原本是为了处理"测试脚本版本不同步"的暂时性问题，但留了很久变成了永久性豁免。实际上 rci-execution-gate.sh 内置了 DEFERRED 机制（test_file 不存在 → exit 0），根本不需要外层的 continue-on-error 保护。

### P1：豁免范围过宽
DevGate 4 项检查被一个 `if` 条件整体豁免，但其中 script existence 和 DoD mapping 是元检查（验证 CI 基础设施完整性），不应随业务豁免规则一起跳过。

## 下次预防

- [ ] 每次添加 MAX_BASELINE 保护时，检查同一仓库中是否有其他相同模式的 baseline 文件
- [ ] Gate job 代码审查时，对比所有 `result` 判断是否统一使用 `!= "success"`，不允许 `= "failure"`
- [ ] `continue-on-error: true` 必须有 JIRA/issue 追踪，超过 2 周无修复则触发 CTO 告警
- [ ] DevGate 步骤的 `if` 条件变更时，明确区分：哪些检查是"基础设施完整性"（不能豁免）vs "业务合规性"（可以有豁免规则）
