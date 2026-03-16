---
version: 1.0.0
created: 2026-03-16
---

# Learning: CI M1 — L1 加 gitleaks secrets 扫描

## 背景

CTO 诊断发现仓库无 secrets 扫描，硬编码 API key 可能被意外提交。

## 做了什么

在 `ci-l1-process.yml` 新增 `secrets-scan` job（gitleaks/gitleaks-action@v2），并将其结果纳入 `l1-passed` gate 强制检查。

## 关键决策

- 使用 `gitleaks/gitleaks-action@v2`（业界标准，无需额外 license 即可用于 public repo）
- `fetch-depth: 0` 确保扫描完整提交历史
- `GITLEAKS_LICENSE` 作为可选 secret，不强制要求

### 根本原因

CI 历史演进中聚焦于代码质量和流程合规，缺乏安全扫描层，导致潜在的凭据泄露风险无人把守。

### 下次预防

- [ ] 新增 CI job 时同步更新 `l1-passed` needs 数组 + gate 检查脚本
- [ ] 安全扫描属于 L1 Process Gate 范畴（不是代码质量，是提交卫生）
- [ ] gitleaks 默认规则覆盖常见 secrets pattern，不需要维护白名单即可使用
