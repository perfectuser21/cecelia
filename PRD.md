# PRD: CI 硬化第一批 — PR size 硬门禁 + npm audit critical gate

## 背景

Repo-audit 发现 CI "太虚"（静态检查很多、真正的门禁很少）：

- **PR size check** 目前在 `ci.yml:111` 只 `echo ::warning`，不 exit 1。历史上 6247/1449/1107/1022 行的 PR 都合并了。
- **无 `npm audit`**：根目录 12 个漏洞（6 moderate + 6 high），CI 完全没有依赖安全门禁。

## 成功标准

1. PR size > 1500 行时 CI 硬失败（harness label PR 继续绕过 —— harness 合同 PR 本来就大）
2. 500–1500 行保留现有 warning
3. < 500 行正常通过
4. 新增 `dep-audit` job，`npm audit --audit-level=critical`，有 critical 漏洞就 fail（moderate/high 暂放行）
5. `dep-audit` 纳入 `ci-passed` needs 列表
6. 本 PR 自身过 CI（<1500 行、0 critical）

## 非目标（YAGNI）

- 不修复现有 6 个 high / 6 个 moderate 漏洞（后续独立 PR，按包分批）
- 不收紧到 `--audit-level=high`（第一次收紧会红一堆，先起步）
- 不改 `--max-warnings` / ESLint 严格度（下一批）
- 不改 BEHAVIOR 跳过逻辑（下一批，涉及到 Brain 服务 spin-up，另起 PR）

## 渐进收紧路径

本 PR 为"起步门槛"。后续每月审一次，按以下路径收紧：

- Step 1（本 PR）: `critical`
- Step 2（1 个月后）: `high`（需先修现有 6 个 high）
- Step 3（2 个月后）: `moderate`
- Step 4（长期）: `low`

PR size 同理：
- Step 1（本 PR）: `> 1500 行` 硬失败
- Step 2（后续）: `> 1000 行` 硬失败
- Step 3（长期）: `> 500 行` 硬失败
