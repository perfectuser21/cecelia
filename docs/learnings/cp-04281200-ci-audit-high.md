# Learning: CI npm audit 阻断级别升级 critical → high

- **分支**: cp-0428214046-cp-04281200-ci-audit-high
- **日期**: 2026-04-28
- **类型**: CI 安全加固

## 背景

CI 的 `dep-audit` job 原先只拦截 `critical` 级别漏洞（`npm audit --audit-level=critical`），导致本地扫出的 6 个 `high` 级别漏洞不被 CI 拦截，存在安全盲区。

### 根本原因

`--audit-level=critical` 只会在 `critical` 级别时返回非零退出码。`high` 级别漏洞仍可通过 CI，不符合安全最佳实践。

### 修复方案

将 `.github/workflows/ci.yml` 中 `dep-audit` job 的阻断级别从 `critical` 升级为 `high`：
- step name: `npm audit (critical only)` → `npm audit (high+)`
- 命令: `npm audit --audit-level=critical` → `npm audit --audit-level=high`
- 注释同步更新，清楚说明 high+ 的含义（涵盖 high 和 critical）

### 下次预防

- [ ] CI 安全扫描阻断级别应从项目初期就设置为 `high`，而非 `critical`
- [ ] 新增漏洞扫描 job 时，在注释中明确说明当前门槛和下一步收紧计划
- [ ] 定期（每季度）审查 `npm audit` 输出，评估是否需要进一步收紧到 `moderate`
