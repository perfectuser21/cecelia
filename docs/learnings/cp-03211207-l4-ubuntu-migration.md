## L4 Integration 从 macOS 迁移到 ubuntu-latest（2026-03-21）

### 根本原因

L4 Runtime Gate 的 brain-integration job 绑定在 self-hosted macOS runner（xian-mac-m1）上，仅 5 个 runner 在线且全部 busy，导致所有 PR 的 L4 无限排队。测试本身（vitest + PostgreSQL + pgvector）不依赖 macOS 特性，只是历史上用了 Homebrew 安装 PG。

### 下次预防

- [ ] 新增 CI job 时优先用 ubuntu-latest，除非有明确的 macOS 依赖（如 Xcode、Swift）
- [ ] self-hosted runner 作为 CI 资源时，评估 runner 数量是否匹配并发 PR 数量
- [ ] 定期检查 CI queued 时间，超过 10 分钟的 job 应触发告警
