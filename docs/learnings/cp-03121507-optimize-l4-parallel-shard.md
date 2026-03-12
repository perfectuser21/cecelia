---
id: learning-l4-parallel-shard
version: 1.0.0
created: 2026-03-12
updated: 2026-03-12
changelog:
  - 1.0.0: 初始版本
---

# Learning: L4 CI 并行 matrix shard + 删除 Phase 2

## 背景

L4 CI 原本使用 `for SHARD in 1/3 2/3 3/3` 串行跑 3 个分片 + Phase 2 再跑一次 coverage，总耗时 60-90min。

## 关键决策

### 1. 同机多 runner 的端口冲突问题

Mac mini 上 4 个 runner 实例共享同一 OS，`/tmp/` 和网络端口都是共享的。
3 个并行 shard 如果都用 5432，会端口冲突。

**解法**：matrix `include` 为每个 shard 分配独立端口（5432/5433/5434）和数据目录（/tmp/pgdata, pgdata2, pgdata3）。

### 2. concurrency group 从 `l4-runtime-${{ github.ref }}` 改为 `l4-runtime-mac`

原来的 concurrency 只对同一 branch 互斥，不同 PR 可以同时跑 L4。
但同机并发 L4 会产生端口冲突（即使每个 L4 内部用不同端口，两组 L4 的端口也会重叠）。

**解法**：全局互斥 `l4-runtime-mac`，任意时刻只有 1 组 L4 在 Mac 上运行。
**代价**：多 PR 并发时，L4 排队（但每次只需 ~20min，可接受）。

### 3. per-shard baseline = ceil(total_baseline / 3)

原来 baseline 是总失败数。并行后每个 shard 只跑 1/3 的文件，需要按比例缩减 baseline。
用 ceiling 除法：`BASELINE=$(( (TOTAL_BASELINE + 2) / 3 ))`。

**风险**：如果失败分布不均匀（某个 shard 集中了大部分 pre-existing failures），该 shard 可能误报。
**缓解**：初次运行后可观察各 shard 实际失败数，按需调整基线文件。

### 4. GoldenPath E2E 只在 shard 1/3 运行

`if: matrix.shard == '1/3'`，避免同一 E2E 跑 3 遍。

## 效果

| 指标 | 改前 | 改后 |
|------|------|------|
| L4 运行时间 | 60-90min | ~20min |
| 测试运行次数 | 2 次 | 1 次 |
| 并行度 | 串行 3 片 | 并行 3 片 |

## 下一步（长期优化）

Test Impact Analysis：只跑受 PR 影响的测试文件，L4 从 ~20min → 2-3min。
