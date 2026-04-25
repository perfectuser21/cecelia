# Harness v6 Phase B Callback Triplet Fix Implementation Plan

**Goal:** 三联修让 Phase B 容器完成 → callback_queue 写入（含 pr_url）→ harness_ci_watch 创建。

**Architecture:** `docker-executor.js::writeDockerCallback` 解析 stdout 注入 _meta；`harness-task-dispatch.js` 成功返回后调 writeDockerCallback + INSERT harness_ci_watch。

**Tech Stack:** Node.js 20 / vitest / pg pool

## Tasks

### Task 1-2: writeDockerCallback 提取 pr_url/verdict
- 扩展 `__tests__/docker-executor.test.js` 加 2 条 RED 测试
- `docker-executor.js` import parseDockerOutput+extractField
- 改 `_meta` 结构加 `pr_url` / `verdict`（null fallback）

### Task 3-4: harness-task-dispatch 调 writeDockerCallback
- 扩展 `__tests__/harness-task-dispatch.test.js` 加 2 条 RED
- `harness-task-dispatch.js` import crypto / pool / writeDockerCallback（DI 支持）
- exit_code=0 成功分支 try/catch 调 writeDockerCallback

### Task 5-6: INSERT harness_ci_watch
- 扩展测试 3 条 RED
- `harness-task-dispatch.js` import parseDockerOutput/extractField，解析 pr_url 非空 → INSERT

### Task 7: Learning + PRD + push
