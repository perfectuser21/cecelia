---
id: learning-cp-03142344-ci-github-actions-split
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
changelog:
  - 1.0.0: 初始版本
---

# Learning: L1 轻量 job 迁移到 GitHub Actions

## 背景

香港 VPS（4核）运行 6 个 cecelia runner，CPU load 长期 11-12（满载 3 倍）。
需要把 L1 中不需要 npm install 的轻量 job 迁移到 ubuntu-latest，减少 HK 压力。

## 根本原因

L1 workflow 所有 job 都写死了 `hk-vps`，但其中 9 个轻量 job（分支检查、PRD/DoD 格式检查等）
完全不依赖本地环境，没有必要占用 HK VPS 资源。GitHub Pro 的 ubuntu-latest runner 是更合适的选择。

## 解决方案

将 9 个无 npm install 的轻量 job 改为 `ubuntu-latest`，保留 3 个 npm 重 job 在 `hk-vps`：
- ubuntu-latest：changes / verify-dev-workflow / cleanup-check / check-prd / check-learning / required-paths-check / ci-config-audit / dev-health-check / l1-passed
- hk-vps：dod-check / quality-meta-tests / engine-l1

## 下次预防

- [ ] 新增 CI job 时先判断是否需要本地环境，无需则用 ubuntu-latest
- [ ] 定期清理 HK VPS 磁盘（journal/Docker/npm cache），设置 journal 大小上限
- [ ] runner 数量不超过 CPU 核数的 1.5 倍，避免 CPU thrashing

## 经验教训

1. **runner 数 ≠ CPU 核数**：8 runner 在 4 核上会 CPU thrashing，已减到 6 个
2. **CI 分流原则**：有无 npm install 是分界线，轻量检查放 GitHub，重任务留自建
3. **磁盘满是 CI 挂的根因**：50GB 被 journal + Docker + npm cache 打满，已清 22GB
