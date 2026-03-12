---
id: learning-l4-parallel-shard
version: 1.1.0
created: 2026-03-12
updated: 2026-03-12
changelog:
  - 1.1.0: 补充根本原因/下次预防格式
  - 1.0.0: 初始版本
---

# Learning: L4 CI 并行 matrix shard + 删除 Phase 2（2026-03-12）

### 根本原因

L4 CI 使用 `for SHARD in 1/3 2/3 3/3` 串行循环，Mac mini 已有 4 个 runner 实例却全部闲置，无法并行。Phase 2 重复跑一遍全量 coverage，导致总耗时 60-90min。同机多 runner 并行时 PostgreSQL 端口冲突（都用 5432），必须为每个 shard 分配独立端口。

### 根本原因详情

**1. 同机多 runner 端口冲突**：Mac mini 上 4 个 runner 实例共享同一 OS，`/tmp/` 和网络端口共享。3 个并行 shard 若都用 5432 会端口冲突。解法：matrix `include` 为每个 shard 分配独立端口（5432/5433/5434）和数据目录。

**2. concurrency group 必须全局互斥**：原来 `l4-runtime-${{ github.ref }}` 只对同一 branch 互斥，不同 PR 并发 L4 仍会端口冲突。改为 `l4-runtime-mac` 全局互斥，任意时刻只有 1 组 L4 在 Mac 上运行。

**3. per-shard baseline = ceil(total_baseline / 3)**：并行后每个 shard 只跑 1/3 的文件，baseline 需按比例缩减。用 ceiling 除法：`BASELINE=$(( (TOTAL_BASELINE + 2) / 3 ))`。

**4. GoldenPath E2E 仅 shard 1/3 运行**：`if: matrix.shard == '1/3'`，避免同一 E2E 跑 3 遍。

### 效果

| 指标 | 改前 | 改后 |
|------|------|------|
| L4 运行时间 | 60-90min | ~20min |
| 测试运行次数 | 2 次 | 1 次 |
| 并行度 | 串行 3 片 | 并行 3 片 |

### 下次预防

- [ ] 新增在同机多 runner 上运行的 CI job 时，检查是否有端口/文件系统冲突，必须为每个并行 job 分配独立资源
- [ ] concurrency group 命名规则：同机 Mac runner 的 job 统一用 `l4-runtime-mac`，不要用 branch-specific group
- [ ] matrix 并行后 baseline 需按 shard 数量比例缩减，不能直接使用总 baseline

### 下一步（长期优化）

Test Impact Analysis：只跑受 PR 影响的测试文件，L4 从 ~20min → 2-3min。
