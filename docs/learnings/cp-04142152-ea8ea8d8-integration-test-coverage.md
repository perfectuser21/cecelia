# Learning: Brain 集成测试覆盖 — callback-processor + harness-watcher

**分支**: cp-0414065145-ea8ea8d8-30f2-4ca9-ba3e-8eade1  
**日期**: 2026-04-14

---

### 根本原因

callback-processor（每个任务完成/失败必经的核心路径）和 harness-watcher（Harness v4.0 CI 监控）没有任何集成测试覆盖。仅依靠 mock 单元测试，无法发现跨模块逻辑中的状态机 bug（如 completed_no_pr 判断、terminal_failure_guard、CI timeout 处理）。

### 发现的覆盖盲区

1. **callback-processor.js** — 状态映射（AI Done/Failed/Quota Exhausted）、completed_no_pr 条件、terminal failure guard、auth 错误跳过熔断计数
2. **harness-watcher.js** — pr_url 缺失处理、poll 超时创建 harness_fix、节流逻辑、CI 通过/失败的任务创建

### 写 mock pool 支持事务（pool.connect + client）

callback-processor 使用 `pool.connect()` 做事务，需要两层 mock：

```js
const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
};
const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  connect: vi.fn().mockResolvedValue(mockClient),
};
vi.mock('../../db.js', () => ({ default: mockPool }));
```

### worktree 中运行 vitest 需要 node_modules symlink

```bash
ln -sf /Users/administrator/perfect21/cecelia/packages/brain/node_modules ./node_modules
```

### 下次预防

- [ ] 新增 Brain 核心模块时，同步在 `src/__tests__/integration/` 新增对应集成测试
- [ ] callback-processor 这类"每条任务必经"的模块优先级最高，上线前必须有集成测试
- [ ] harness-watcher 类的状态机模块（ci_pending→ci_passed→harness_report）必须测试状态转换路径
