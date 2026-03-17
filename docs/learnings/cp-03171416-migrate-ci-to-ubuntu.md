# Learning: migrate CI hk-vps to ubuntu-latest

**Branch**: cp-03171416-migrate-ci-to-ubuntu
**Date**: 2026-03-17

## 问题背景

HK VPS（8GB RAM）运行 8 个并发 GitHub Actions self-hosted runner。每个 vitest 进程使用 22GB+ 虚拟内存，
8 个 runner 同时运行 L3 测试时触发 OOM killer，导致 Tailscale 和 SSH daemon 被杀，机器失联约 1 小时。

### 根本原因

- `runs-on: [self-hosted, Linux, hk-vps]` 使所有 L3/L4 jobs 串行竞争同一批 runner
- 8 runner × 22GB 虚拟内存/进程 >> 8GB 物理 RAM + 4GB Swap
- OOM 导致系统关键进程被杀 → 机器假死

### 下次预防

- [ ] CI jobs 优先用 `ubuntu-latest`（GitHub 托管，独立 VM，无 OOM 风险）
- [ ] self-hosted runner 只用于需要特定环境的场景（PostgreSQL、macOS、ARM64）
- [ ] HK VPS runner 保留 3 个（已禁用 4-8），仅作备用，避免过载
- [ ] 监控 HK VPS 内存：`cecelia-hk-runner-monitor.timer` 定期检查

## 变更内容

- `ci-l3-code.yml`：6 处 `hk-vps` → `ubuntu-latest`
- `ci-l4-runtime.yml`：2 处 `hk-vps` → `ubuntu-latest`（detect-changes + gate-passed）
- L4 `brain-integration` 保留 `xian-mac-m1`（需要 PostgreSQL + Homebrew）
