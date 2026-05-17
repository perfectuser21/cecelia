# Learning: Brain 容器 codex CLI 缺失导致 cecelia-run breaker OPEN

## 现象

生产 Brain 容器（cecelia-brain:1.228.x）健康检查显示：

```
"circuit_breaker": {
  "status": "has_open",
  "open": ["cecelia-run"],
  "states": {
    "cecelia-run": {"state": "OPEN", "failures": 351, ...}
  }
}
```

cecelia-run breaker OPEN 后，dispatcher line 248 直接跳出，**所有 dispatch 阻断**：spec_review、code_review_gate、prd_review、arch_review、initiative_review、dev、codex_dev 全部不再派发。

### 根本原因

`packages/brain/src/executor.js` 的 `triggerCodexReview` 直接 `spawn('/opt/homebrew/bin/codex', ...)`，但：

1. **Dockerfile 没装 codex CLI** — 只 apk add curl/bash/git/gh，没 npm install -g @openai/codex
2. **没 mount codex auth** — 容器里没有 `~/.codex-team1/auth.json`
3. **CODEX_BIN 默认值是 host 路径** — `/opt/homebrew/bin/codex` 是 macOS Homebrew 路径，容器（linux/arm64）里不存在

每次 review 任务进入 `triggerCodexReview`：
- spawn ENOENT 异步触发 `child.on('error')` → 发 `status='AI Failed'` callback
- callback-processor 已隔离 `coding_type='codex-review'` 不 trip cecelia-run（PR 早期已修，line 367-374）
- **但 `preparePrompt(task)` 在容器内可能因 fs/路径错误同步抛异常** → 进 `triggerCodexReview` catch 路径返回 `{ success: false, error }` → dispatcher line 486 无差别 `recordFailure('cecelia-run')` → 累积 351 次 trip OPEN

这是"配置漂移污染熔断器"的典型反模式：**系统配置错误（缺 binary）累积进运行时执行错误的失败计数器**，让 breaker 误判服务不健康。

## 修复

三层修复（从根本到防御）：

### 层 1：装 codex CLI 到容器
`packages/brain/Dockerfile` Stage 2 加 `RUN npm install -g @openai/codex@0.116.0`，binary 落 `/usr/local/bin/codex`。

### 层 2：mount auth + 配 env
`docker-compose.yml` node-brain 服务：
- volumes 加 `/Users/administrator/.codex-team1:/Users/administrator/.codex-team1:ro`
- environment 加 `CODEX_BIN=/usr/local/bin/codex`（覆盖 executor.js 默认 host 路径）
- environment 加 `CODEX_HOME=/Users/administrator/.codex-team1`（codex CLI 找 auth.json）

### 层 3：spawn 前预检 + configError 隔离
`packages/brain/src/executor.js` `triggerCodexReview`：spawn 前 `await access(codexBin)`。缺失即返回：

```js
{
  success: false,
  configError: true,
  reason: 'codex_binary_missing',
  error: '...',
  executor: 'codex-review',
}
```

`packages/brain/src/dispatcher.js` line 483-495：检测 `execResult.configError === true` 时跳过 `recordFailure('cecelia-run')`，单独打日志 + recordDispatchResult reason='config_error'。

## 下次预防

- [ ] **Dockerfile 行为类改动必须有 smoke**：每次 Brain Dockerfile 改动后，跑 `docker exec cecelia-node-brain <bin> --version` 验证关键 binary 存在
- [ ] **executor.js 调外部 binary 必须 spawn 前 fs.access 预检**：codex / claude / playwright / ssh 等所有外部 CLI，spawn 前预检失败应返回 `configError:true`
- [ ] **dispatcher 不能无差别 recordFailure(cecelia-run)**：必须区分 configError（系统配置）vs runtime error（任务执行）vs transient（rate_limit / network / billing）
- [ ] **Brain 启动 selfcheck 加 codex binary 检查**：若 task_router 含 review 类型且 codex 不可用 → degraded health（不 fatal，但显式可见）
- [ ] **callback-processor 隔离逻辑要扩展到所有 system pool**：codex-review / hk-minimax / xian-codex 失败都不应污染 cecelia-run 计数

## 相关代码

- `packages/brain/src/executor.js:2292-2402` — `triggerCodexReview`
- `packages/brain/src/dispatcher.js:480-495` — execResult 失败处理
- `packages/brain/src/callback-processor.js:367-378` — codex-review callback 隔离（已存在）
- `packages/brain/src/__tests__/callback-codex-review-circuit.test.js` — 早期已有 callback 隔离测试（仅覆盖 callback 路径，不覆盖 dispatch 入口）
- `packages/brain/src/__tests__/executor-codex-review-preflight.test.js` — 本 PR 新增，覆盖 dispatch 入口预检
- `packages/brain/src/__tests__/dispatcher-config-error-no-breaker.test.js` — 本 PR 新增，覆盖 dispatcher configError 跳过 breaker
