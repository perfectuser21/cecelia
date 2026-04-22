# Cross-Cutting: Observers

**状态**: 占位骨架（P1）— 待 P4 实现
**对应 Spec**: [`docs/design/brain-orchestrator-v2.md`](../brain-orchestrator-v2.md) §7
**目标路径**（P4 实现时 `git mv` 到）: `packages/brain/src/observers/README.md`
**归属**: Brain 三层架构的横切层（不属于 L1/L2/L3 任一层）

---

## 1. 目的

把 watchdog / shepherd / pipeline-patrol / cost-tracker / analytics 从"嵌入 tick 的阻塞点"解放成"独立心跳 + 只读 DB 当前状态"的旁观者。

**核心原则**：observer **只读，不派发，不改 task 路由**。纠偏手段仅限于：
- 写 `quarantine` 标记
- 发 feishu 告警
- 更新 DB metric 列

## 2. 目录结构（P4 完成后）

```
observers/
├── watchdog.js           ← tick 健康检查（独立 interval）
├── shepherd.js           ← 卡死任务 quarantine
├── pipeline-patrol.js    ← 横向巡航所有活跃 pipeline
├── cost-tracker.js       ← 账号预算追踪
├── analytics.js          ← metric 上报
├── pg-pool.js            ← observer 专用 PG 连接池
└── __tests__/
```

## 3. 硬规矩

### 3.1 活跃判定（避免 2303a935 误杀重演）

**禁止**仅凭"历史计数"（`retry_count >= 3`）判断任务卡死。必须叠加**近期活跃信号**：

```sql
-- 活跃信号 A：当前 attempt 的 checkpoint 最近 90s 内写过
EXISTS (
  SELECT 1 FROM checkpoints c
  WHERE c.thread_id = t.id || ':' || t.attempt_n
    AND c.created_at > NOW() - INTERVAL '90 seconds'
)

-- 活跃信号 B：有 cidfile 对应的 docker container 仍在 running
EXISTS (
  SELECT 1 FROM running_containers rc
  WHERE rc.task_id = t.id AND rc.status = 'running'
)
```

任一信号为真 → **不要** quarantine。见 Spec §7.2。

### 3.2 独立 event loop

每个 observer 用独立 `setInterval`，**禁止**挂在 tick 调用链里。tick 必须保持 P99 `duration_ms < 5s`。

### 3.3 独立 PG 连接池

Observer 查询可能很慢（全表扫 / 聚合），必须用 `observers/pg-pool.js`，不能和 dispatch 主池共享——否则慢查询会饿死 dispatch。

## 4. 禁忌

- ❌ observer 不允许调 `executor.dispatchTask` / `spawn()` / `runWorkflow`——不派发任何东西
- ❌ observer 不允许改 `tasks.status`（除了 `quarantine` 这一种标记字段）
- ❌ observer 不允许阻塞超过 5s——慢查询要加 `statement_timeout`
- ❌ observer 不允许相互依赖——每个 observer 独立循环，不共享状态

## 5. P4 不加 flag

Observer 分离是**旁路改造**，不在 dispatch 主链路上。回滚 = `git revert`，不需要 feature flag。

## 6. 历史背景

- 2303a935 被连续 quarantine：shepherd 看 `retry_count >= 3` 就拉黑，无视该任务正在 harness 流水线中运行
- Brain 83 分钟自杀：tick watchdog 在 tick 内 `await` 长任务 → event loop 被挤占 → tick 看起来卡死 → `FORCE-RELEASE` 自毁

这两个故障的根因都是"observer 和派发链路耦合"，P4 从架构层根治。
