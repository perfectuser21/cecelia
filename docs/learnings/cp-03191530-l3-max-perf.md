# L3 CI 性能优化：拉满 ubuntu-latest 规格

## 背景
L3 CI 在 ubuntu-latest（16GB RAM）上运行 vitest，但只用了 2 fork x 2GB = 4GB，浪费 75% 内存。

### 根本原因
初始配置是为 HK VPS runner（8GB RAM）设计的，迁移到 ubuntu-latest 后未同步调整资源配额。

### 下次预防
- [ ] 迁移 CI runner 时，同步审查所有资源配额参数（fork 数、堆大小、并发数）
- [ ] 在 CI 配置文件中注明目标 runner 规格，便于后续审查
