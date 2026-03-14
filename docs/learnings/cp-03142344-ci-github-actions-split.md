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
磁盘也曾因 journal/Docker 积累打满 100%，导致 CI 2 秒失败。

## 关键决策

### 为什么把轻量 job 放 ubuntu-latest 而不是 self-hosted

- 轻量 job（分支检查、PRD/DoD 格式检查等）不需要 npm install，10-25 秒跑完
- GitHub Pro 3000 分钟/月，按 25 PR/天估算约 1500 分钟/月，在配额内
- ubuntu-latest 是 Linux，grep -P 等命令完全兼容

### 分界线：有无 npm install

- 有 npm install → 留 hk-vps（dod-check / quality-meta-tests / engine-l1）
- 无 npm install → 迁 ubuntu-latest（其余 9 个 job）

## 经验教训

1. **磁盘监控要提前设置**：50GB 磁盘被 journal(3.7GB) + Docker volumes(3GB) + npm cache(11GB) 打满，需要定期清理
2. **runner 数 ≠ CPU 核数**：8 runner 在 4 核上会 CPU thrashing，减到 6 个更稳
3. **CI 分流策略**：公开仓库/Pro 用户可以把快速检查放 GitHub，重任务留自建
