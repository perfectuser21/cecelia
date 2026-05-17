# Learning: brain-unit CI 分 4 shards 并行

**Branch**: `cp-04172321-brain-unit-shards`
**Date**: 2026-04-17
**Task ID**: `4ffda0b7-bd2e-4fec-a7ea-181d1f6c7beb`

## 问题现象

今天合了 8 个 PR，每个都在 brain-unit job 等了 7-10 min。放在单 job 里跑 500+ 测试文件、1500+ 测试用例，是 CI 最长的瓶颈。累计 8×8=64 min 人在 CI 等。

## 根本原因

CI 是单 GitHub Actions job + vitest 默认 forks pool 串行跑所有测试文件。vitest 本身虽然并行，但单 job 就一个 runner 跑完所有文件。

## 方案

vitest 原生支持 `--shard=i/N`（按测试文件 hash 均匀分布），配合 GitHub Actions `strategy.matrix` 把 job 复制 4 份：

```yaml
brain-unit:
  strategy:
    fail-fast: false
    matrix:
      shard: [1, 2, 3, 4]
  steps:
    - run: npx vitest run --shard=${{ matrix.shard }}/4 ...
```

**关键要点**：
1. `fail-fast: false` — 一个 shard 失败不取消其他 shards，便于一次看到所有失败
2. GitHub Actions `needs.brain-unit.result` 对 matrix job 会聚合：全成功=success，任一失败=failure
3. 增加 `brain-unit-all` aggregation job 给 required-check 一个稳定名字
4. `ci-passed.needs` 保留 `brain-unit` + 新增 `brain-unit-all`，让 CI gate 对两者都校验
5. 分支保护只要求 `ci-passed`，本改动无需动 branch protection

## 本地验证

| shard | 测试文件数 |
|-------|-----------|
| 1/4   | 116       |
| 4/4   | 115       |

分布均匀（总 ~460 测试文件，每 shard 平均 115）。

## 下次预防

- [ ] 观察首次 PR 运行时各 shard 实际耗时，验证确实 <3min/shard
- [ ] 若未来单 shard 仍过长（>4min），考虑升到 8 shards
- [ ] `brain-diff-coverage` 依然跑全量 coverage（不能 shard），是独立 job — 如果它变慢也要单独优化

## 参考

- vitest sharding: https://vitest.dev/guide/cli.html#shard
- GitHub Actions matrix: https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs
