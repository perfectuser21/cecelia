# Learning: Tier 2 PR-B — dispatcher 真路径 smoke（2026-04-27）

- 影响：Brain 核心 dispatcher 调度引擎可信度
- 触发：4 agent 审计找出 dispatcher.js 0 真路径覆盖（11602 行核心 brain 代码全 mock 单测）

---

### 根本原因

dispatcher.js 是 brain 最高频被调用的模块（每秒 tick），但所有现存单测全 vi.mock 掉 db / executor / langgraph：

- `dispatcher.test.js`：1:1 stub，只 grep 文件常量（被 PR-A 的 lint-test-quality 列为反例）
- `dispatcher-default-graph.test.js` / `dispatcher-initiative-lock.test.js`：vi.mock 全部依赖
- `dispatcher-quota-cooling.test.js`：同上

PR #2660 的 Phase 2.5 retired drain bug 就是直接证据：单测全过 → CI 绿 → merge → deploy → **当场 drain 24 个本来卡死的任务**。bug 在 mock 层下完全看不到。

---

### 修复

新增 `packages/brain/scripts/smoke/dispatcher-real-paths.sh` —— real-env-smoke job 真起 brain docker container + 真 postgres，验 3 条核心真路径：

- **Case A**：pre-flight 短 title reject 流程完整跑通（POST → 进队 → tick → metadata 标记）
- **Case B**：empty queue 不抛（防 dispatcher 在无 task 时 5xx）
- **Case C**：initiative-lock 真生效（同 project_id 并发只 1 个 in_progress）

3 case 本地真跑全过。

### 设计要点

- **dedup constraint**：tasks 表的 `idx_tasks_dedup_active` 是 `(title, goal_id, project_id)` for queued/in_progress。每次 smoke run 用唯一 SMOKE_RUN_ID 后缀避冲突
- **pre-flight 阈值**：title <5 字符 reject。Case A 用 `ab` + 2 hex = 4 字符（保短同时唯一）
- **status 转换守卫**：API queued → failed 直接 PATCH 被拒，必须 queued → in_progress → failed 两步。cleanup 用这个序列
- **timeout 防卡**：所有 curl `-m 10`。/tick 偶发慢（dispatcher 多 task iter）会卡死整个 smoke

---

### 下次预防

- [ ] 任何 brain core 模块（dispatcher / executor / cortex / thalamus）新增重大功能必须配套 real-env-smoke，单测 mock 全过 ≠ prod 真行（PR #2660 教训）
- [ ] smoke 必须用 SMOKE_RUN_ID 唯一后缀防 dedup，否则 CI 重复跑会冲突
- [ ] smoke 所有 curl 必须有 timeout，CI 偶发慢导致整个 job 超时（学 dispatcher /tick 卡 8 分钟教训）
- [ ] "1:1 stub test" 是反模式（PR-A lint-test-quality 已拦），不是替代真测试
