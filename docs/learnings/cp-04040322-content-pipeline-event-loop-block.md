# Learning: Content Pipeline 本地执行导致 Brain 事件循环永久阻塞

**任务**: [SelfDrive] 内容生成+发布链路完整诊断与修复
**分支**: cp-04040322-faab0eb6-8bfd-4900-bfe1-17550d
**日期**: 2026-04-04

---

### 根本原因

`tick.js` 的 `0.5.6 executeQueuedContentTasks()` 在 Brain 的 Node.js 事件循环内，
通过 `execSync`（同步进程）直接调用 notebooklm / 图片生成 CLI 命令。

单次调用链：
1. `tick.js` → `executeQueuedContentTasks()`
2. → `_executeStageTask()` → `executeResearch(task)`
3. → `run('notebooklm research wait --timeout 300 ...')` ← **execSync，阻塞长达 5 分钟**

结果：
- Brain HTTP 服务器完全无响应（TCP 接受连接但不返回任何数据）
- tick 循环停止
- content-* 任务在 queued 状态堆积（28+）
- Brain 内存压力触发 OOM kill → 重启 → 立即再次阻塞 → 崩溃循环

并发影响：
- KR "内容生成" 和 "自动发布" 进度归零（任务全部卡死）
- 多个自诊断任务以 exit code 137 失败

---

### 下次预防

- [ ] **规则**：Brain 进程内绝对禁止使用 `execSync` / `spawnSync` 执行外部命令（除 `git` 等轻量快速命令）
- [ ] **规则**：任何耗时超过 500ms 的操作必须通过任务派发（xian/us bridge）异步执行，不得在 tick 回调内 await
- [ ] **规则**：`tick.js` 新增子模块前，必须证明该模块无阻塞调用（review checklist 中加此项）
- [ ] **检测**：facts-check.mjs 可增加 `sync_in_tick` 检查（扫描 tick 内 execSync 用法）
- [ ] **架构**：content-* 子任务通过 `task-router` → `triggerCodexBridge` 在 xian 异步执行，完成后 `execution-callback` 路由调用 `advanceContentPipeline` 推进流水线

---

### 修复清单

- [x] `tick.js`: 禁用 `0.5.6 executeQueuedContentTasks` 块（添加注释说明禁用原因）
- [x] `executor.js` skillMap: 补全 `content-copywriting` / `content-copy-review` / `content-image-review` → `/content-creator`，防止 fallback 到 `/dev`
