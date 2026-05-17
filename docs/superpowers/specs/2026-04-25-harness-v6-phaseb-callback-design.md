# Harness v6 Phase B 容器回调链路三联修

- Brain Task: `4ab9a9e8-8cc3-4427-8e78-2145082de5b8`
- Date: 2026-04-25
- Branch: `cp-0425095613-harness-v6-phaseb-callback-4ab9a9e8`

## 背景

Harness v6 Phase B 回调链路断裂：Generator 容器跑完开 PR 后，Brain 没有任何感知，task 永远卡在 `queued`，下游 DAG 死锁。

审计定位三处缺陷叠加：

1. `harness-task-dispatch.js` 在 `executeInDocker` 返回后没有调用 `writeDockerCallback()` → `callback_queue` 不写入
2. `docker-executor.js::writeDockerCallback` 不解析 stdout 的 `{verdict, pr_url}` → `_meta.pr_url` 永远为空
3. 全仓没有 INSERT `harness_ci_watch` 的代码 → `harness-watcher` 永远查不到待监控 PR

## 目标

三联修复闭环：容器完成 → callback_queue 写入（含 pr_url）→ 创建 `harness_ci_watch` task → `harness-watcher` 轮询 CI → `shepherd` 合并。

## 设计

### A. `docker-executor.js::writeDockerCallback` 增强

构造 `resultJson._meta` 时从 stdout 提取 `pr_url` / `verdict`（用 `harness-graph.js` 的 `parseDockerOutput` + `extractField`），写入 `_meta.pr_url` / `_meta.verdict`，无值时为 `null`。

### B. `harness-task-dispatch.js` 调用 `writeDockerCallback`

容器执行完毕且 exit_code === 0 时，生成 `crypto.randomUUID()` 作为 runId 并调 `writeDockerCallback({...task, task_type:'harness_task'}, runId, null, result)`。DI 注入：`deps.writeDockerCallback` / `deps.pool`。

### C. `harness-task-dispatch.js` 创建 `harness_ci_watch` task

在写 callback 后，若解析到 pr_url 则 INSERT 一条 `harness_ci_watch` task：

```sql
INSERT INTO tasks (title, description, task_type, priority, status, payload, trigger_source)
VALUES ($1, $2, 'harness_ci_watch', 'P0', 'queued', $3::jsonb, 'harness_task_dispatch')
```

payload 包含 `pr_url` / `parent_task_id` / `initiative_id` / `harness_mode: true`。

## 测试计划

### `docker-executor.test.js` 扩展（2 条）
- stdout 含 `{"verdict":"DONE","pr_url":"https://.../pull/42"}` → `_meta.pr_url` / `_meta.verdict` 正确
- stdout 无 JSON → `_meta.pr_url` / `_meta.verdict` 为 `null`

### `harness-task-dispatch.test.js` 扩展（5 条）
- exit_code=0 + stdout 有 pr_url → writeDockerCallback 调一次 + INSERT harness_ci_watch 一条
- exit_code=0 + stdout 无 pr_url → writeDockerCallback 调一次 + 不 INSERT
- exit_code!=0 → 不调 writeDockerCallback + 不 INSERT

## 范围外

- 不改 `callback-worker.js` / `callback-processor.js`（已支持 `_meta.pr_url`）
- 不改 `harness-watcher.js`
- 不改 `harness-graph.js` 工具函数

## 成功标准

见 PRD `## 成功标准`（ARTIFACT + BEHAVIOR 全 8 条）。
