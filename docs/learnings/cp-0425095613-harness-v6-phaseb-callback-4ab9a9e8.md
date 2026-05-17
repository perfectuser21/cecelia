# Harness v6 Phase B 回调链路三联修

- Branch: `cp-0425095613-harness-v6-phaseb-callback-4ab9a9e8`
- Brain Task: `4ab9a9e8-8cc3-4427-8e78-2145082de5b8`
- Date: 2026-04-25

## 事实

Harness v6 Phase B：Generator 容器跑完开 PR 后 Brain 毫无感知 → `tasks.status=queued` 永远不推进 → 下游 Evaluator/Shepherd DAG 死锁。审计发现 3 处叠加缺陷：

1. `docker-executor.js::writeDockerCallback` 构造 `_meta` 时没从 stdout 抽 `pr_url` / `verdict`，callback-worker 拿到的永远是 `{executor, tier}` 两字段
2. `harness-task-dispatch.js` 在 `executeInDocker` 返回后直接 `return {success: true, ...}`，**从来没调 `writeDockerCallback()`** → `callback_queue` 空
3. 全仓无 INSERT `harness_ci_watch` 的代码 → `harness-watcher` `SELECT ... FROM tasks WHERE task_type='harness_ci_watch'` 永远 0 行

## 修复

- `docker-executor.js::writeDockerCallback` import `parseDockerOutput` / `extractField`（harness-graph.js 已有），写入 `_meta.pr_url` / `_meta.verdict`
- `harness-task-dispatch.js` 成功分支调 `writeDockerCallback` + 当 `pr_url` 非空时 INSERT `harness_ci_watch`（DI 注入 `deps.writeDockerCallback` / `deps.pool`）

### 根本原因

Phase B 实现时把"容器 return"当"流程完"，没有接回 `callback_queue` 写入，也没创建下游 watch task。两件事都是"异步任务必须显式接续"的基本规范，因为：
- `callback_queue` 是 bridge 路径定义的**通用容器完成协议**，不仅 bridge 需要写，所有"容器异步产出"的分支都要写
- Harness 链路本质是"Generator 产出 PR URL"的异步流水线，下游 ci_watch / shepherd 都等这条消息；不 INSERT `harness_ci_watch` 就等同不拔"发射按钮"

另一个关键疏漏是 `_meta.pr_url` 从未被写入 —— callback-worker 的 `routePrUrlToTasks` 读这个字段回填 `tasks.pr_url`，上游不写下游再聪明也拿不到 URL。

### 下次预防

- [ ] 新增 dispatcher 类模块时同步接 `callback_queue`（`writeDockerCallback` 是通用协议）
- [ ] "异步任务产出 URL/路径/ID" 类流程，在 PRD 阶段就显式写出"下游 follow-up task INSERT 位置"
- [ ] Dispatcher 结果字段（`_meta.pr_url` / `_meta.verdict` / `_meta.commit_sha` 等）统一收敛到 `writeDockerCallback` 单点提取，避免不同 caller 各自解析
- [ ] 端到端 integration test 覆盖 `dispatch → callback_queue → ci_watch 创建 → watcher SELECT 到` 闭环（后续任务跟进，本 PR 范围外）
