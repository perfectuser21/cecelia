---
version: 1.0.0
created: 2026-03-17
---

# Learning: CI Arch-Review 4 项安全修复

## 背景

全量 arch-review 在上轮 CTO 修复（6 项，PR #1000）基础上继续发现 4 个漏洞，形成第二轮修复（PR #1002）。
修复过程中还额外暴露了 3 个预存 P0 合约缺陷（被 continue-on-error 长期掩盖）。

## 根本原因

### P0-1：对称性缺失
L3 brain-unit 添加了 MAX_BASELINE=5，但 L4 brain-integration 遗漏了同等保护。修复时必须检查所有相同模式的地方是否都做了同等处理。

### P0-2：软/硬判断不一致
L3 gate 大多数检查用 `!= "success"`（正确），但 test-coverage-required 和 coverage-delta 用的是 `= "failure"`（漏掉 skipped 状态）。这是复制粘贴引入的细微不一致，单看代码很难发现，只有横向比较才能发现。

### P0-3：continue-on-error 是安全反模式
`continue-on-error: true` 原本是为了处理"测试脚本版本不同步"的暂时性问题，但留了很久变成了永久性豁免。实际上 rci-execution-gate.sh 内置了 DEFERRED 机制（test_file 不存在 → exit 0），根本不需要外层的 continue-on-error 保护。

### P1：豁免范围过宽
DevGate 4 项检查被一个 `if` 条件整体豁免，但其中 script existence 和 DoD mapping 是元检查（验证 CI 基础设施完整性），不应随业务豁免规则一起跳过。

## 移除 continue-on-error 后暴露的预存缺陷

移除 continue-on-error 后，3 个 P0 合约立刻真实失败（不再被掩盖）：

### C-DB-INIT-001（schema creation 失败）
HK VPS self-hosted runner 未预装 sqlite3，且 runner 用户无 passwordless sudo，无法在 CI 中安装。
**修复**：在合约 YAML 中标记 `ci_runnable: false`，说明需在有 sqlite3 的环境手动验证。

### C-WORKER-EXECUTION-001（外部 Claude API 依赖）
test-worker-execution.sh 调用 worker.sh，worker.sh 调用外部 Claude API 服务，CI 环境无法访问。
**修复**：标记 `ci_runnable: false`，rci-execution-gate.sh 解析该标记后自动 DEFERRED。

### C-GATEWAY-CLI-001（wc -l 前导空格）
`gateway.sh status` 输出 "Total tasks:        2"，但测试 grep "Total tasks: 2"（无前导空格），macOS 上 `wc -l` 带前导空格导致匹配失败。
**修复**：改为 `grep -qE "Total tasks:[[:space:]]*2"`，兼容有/无前导空格。

## ci_runnable 机制设计

新增 `ci_runnable: false` 字段允许合约声明"此测试在 CI 中无法运行"，配合 `ci_skip_reason` 说明原因。
rci-execution-gate.sh 在 test_file 存在性检查之前先检查 ci_runnable，false 则直接 DEFERRED，不计入失败。
这比简单删除合约或标记 `priority: P1` 更准确——合约仍然有效，只是执行环境受限。

## branch-protect hook 的 packages/ 子目录保护

修改 `packages/quality/` 下文件时，hook 会就近找到 `packages/quality/.prd.md`（旧任务残留）而非根目录的 `.prd-{branch}.md`。
**触发点**：`find_prd_dod_dir` 函数在 packages/ 内找到任何 `.prd.md` 即停止向上搜索。
**修复方案**：在 `packages/quality/` 也放一份 per-branch task card（`.task-{branch}.md`），优先级最高，hook 直接使用。

## Engine 版本 bump + Impact Check 联动

修改 `packages/engine/scripts/devgate/` 下文件时，L2 CI 同时触发：
1. **版本检查**：`packages/engine/package.json` 版本必须与 main 分支不同（5 个文件同步）
2. **Impact Check**：`packages/engine/features/feature-registry.yml` 必须有新 changelog 条目
3. **Contract Drift Check**：feature-registry.yml 更新后必须重新运行 `generate-path-views.sh`
三个检查缺一不可，顺序是：bump version → 更新 registry → 生成 paths。

## 下次预防

- [ ] 每次添加 MAX_BASELINE 保护时，检查同一仓库中是否有其他相同模式的 baseline 文件
- [ ] Gate job 代码审查时，对比所有 `result` 判断是否统一使用 `!= "success"`，不允许 `= "failure"`
- [ ] `continue-on-error: true` 必须有 JIRA/issue 追踪，超过 2 周无修复则触发 CTO 告警
- [ ] DevGate 步骤的 `if` 条件变更时，明确区分：哪些检查是"基础设施完整性"（不能豁免）vs "业务合规性"（可以有豁免规则）
- [ ] 修改 `packages/quality/` 下文件时，同目录要有 `.task-{branch}.md`（branch-protect hook 就近检测）
- [ ] 新增 P0 合约时，显式评估 `ci_runnable`：该测试在 HK VPS runner 上能跑吗？如不能，立即标记
- [ ] 修改 `packages/engine/scripts/devgate/` 时，checklist：版本 5 文件 + feature-registry + generate-path-views
