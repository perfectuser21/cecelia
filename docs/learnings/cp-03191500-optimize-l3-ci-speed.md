# Learning: L3 Brain Unit Tests 提速优化

## 日期
2026-03-19

## 变更摘要
将 L3 CI Brain Unit Tests 的 NODE_OPTIONS 从 1536MB 提升到 2048MB，vitest maxForks 从 1 提升到 2。

### 根本原因

L3 CI 运行慢的根因是资源配置过于保守：
1. NODE_OPTIONS max-old-space-size=1536 对于 421 个测试文件偏小，频繁触发 GC
2. maxForks=1 导致单进程串行跑所有测试，完全没有利用 ubuntu-latest 的 4 核 CPU
3. 当时设为 1 是因为担心 OOM，但 ubuntu-latest 有 7GB 内存，2 forks x 2GB = 4GB 完全安全

### 下次预防

- [ ] 配置 CI 资源时，先查明目标 runner 的实际资源（ubuntu-latest: 4 核 / 7GB RAM）
- [ ] 不要因为 OOM 就一刀切降到最低配置，应该计算实际用量后设定合理值
- [ ] vitest isolate:true 已保证测试隔离，多 fork 不会导致 mock 污染
- [ ] 注意 coverage job 的 NODE_OPTIONS 已经是 3072MB，说明 runner 内存够用
