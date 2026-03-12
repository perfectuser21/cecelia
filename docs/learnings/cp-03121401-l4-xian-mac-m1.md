---
id: learning-l4-xian-mac-m1
version: 1.0.0
created: 2026-03-12
updated: 2026-03-12
changelog:
  - 1.0.0: 初始版本
---

# Learning: CI L4 runner 切换至西安 Mac Mini M1（2026-03-12）

## 根本原因

L4 brain-integration job 原配置为 `us-mac-m4`（Mac Mini US）runner，但 runner 使用策略是只用 HK VPS（Linux）+ 西安 Mac Mini M1（macOS），不使用 Mac Mini US。runner 标签配置与实际使用策略不一致。

## 修复内容

将 `ci-l4-runtime.yml` 中 `brain-integration` job 的 `runs-on` 从 `[self-hosted, macOS, ARM64, us-mac-m4]` 改为 `[self-hosted, macOS, ARM64, xian-mac-m1]`。

## 下次预防

- [ ] runner 标签策略：macOS job 统一路由到 `xian-mac-m1`，Linux job 路由到 `hk-vps`，不使用 `us-mac-m4`
- [ ] 新增 CI job 时检查 runner 标签是否符合此策略
