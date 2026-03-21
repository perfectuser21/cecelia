# Learning: L4 Runtime Gate 迁移到 ubuntu-latest

**Branch**: cp-03211206-l4-ubuntu-migration
**Date**: 2026-03-21

## 背景

L4 Runtime Gate 的 brain-integration job 使用 self-hosted macOS runner (xian-mac-m1)，
西安只有 5 个 runner 且全部 busy，导致所有 PR 的 L4 无限排队阻塞。

## 变更

将 brain-integration job 从 self-hosted macOS 迁移到 ubuntu-latest：
- runs-on 改为 ubuntu-latest
- Homebrew 安装替换为 apt-get + pgvector 编译安装
- Node.js 改用 actions/setup-node@v4
- PostgreSQL 路径适配 linux

### 根本原因

self-hosted runner 资源有限（5 个 xian-mac-m1），且已全部被其他任务占满，
无法弹性扩容。ubuntu-latest 使用 GitHub 托管资源池，秒级启动，无排队问题。

### 下次预防

- [ ] 新增 CI job 时优先使用 ubuntu-latest，除非有明确的平台依赖（如 macOS/iOS 构建）
- [ ] self-hosted runner 应该只用于必须在特定环境运行的场景
- [ ] CI 配置变更 PR 标题必须包含 [CONFIG] 或 [INFRA] 标签
