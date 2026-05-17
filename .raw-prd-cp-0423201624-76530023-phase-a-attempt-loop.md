# Phase A — attempt-loop 真循环

## Goal
把 spawn() 改成真正的 for (account × model) in cascade × rotation 循环。失败时自动下一候选，permanent 失败不重试，超过 MAX_ATTEMPTS=3 返回最后结果。

## 背景
P2 已建 9 个 middleware（cascade/account-rotation/cap-marking/retry-circuit 等），但 spawn() 当前是"一次 spawn 一次 attempt"。retry-circuit.js 的 classifyFailure/shouldRetry 已建未调用。Phase A 收尾：把它们编织成真·内循环。

## Tasks（采用选项 A1：attempt-loop 在 spawn.js 外层）
1. 改 packages/brain/src/spawn/spawn.js：在 executeInDocker 外层加 for(let attempt=0; attempt<MAX_ATTEMPTS; attempt++) 循环，调用 classifyFailure + shouldRetry，transient 时 delete opts.env.CECELIA_CREDENTIALS 让 account-rotation 下次重选。
2. 扩 packages/brain/src/spawn/__tests__/spawn.test.js 从 3 cases 到 7 cases：success first try / transient→retry→success / transient × 3 给 up / permanent 不重试 / cap-marking 触发后下次 attempt 自动换号 / shouldRetry 返回 false 停止 / maxAttempts 边界。
3. 验证 harness-initiative-runner.js 对 spawn 的单次调用语义未退化。

## 成功标准
- attempt-loop 在 spawn.js 内真实执行（for 循环可被静态检查到）
- 7 种 failure/success 场景全部有对应单测且 pass
- classifyFailure/shouldRetry 的使用路径在 spawn 流程内被激活（retry-circuit 不再死代码）
- 现有 middleware 测试（cascade/account-rotation/docker-run/cap-marking 等）不退化
- MAX_ATTEMPTS=3 常量可导出或有 JSDoc 注释说明与上层 retry 关系

## DoD
- [BEHAVIOR] spawn.js 导出 spawn 且含 for 循环；Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/spawn.js','utf8'); if(!c.includes('for (let attempt')) process.exit(1)"
- [BEHAVIOR] spawn.test.js ≥ 7 cases 全 pass；Test: tests/packages/brain/src/spawn/__tests__/spawn.test.js
- [ARTIFACT] spawn.js 行数 ≤ 150 行（保持简洁）
- [BEHAVIOR] 现有其它测试不退化；Test: manual:npm test --workspace=packages/brain --prefix . -- packages/brain/src/spawn/__tests__/

## 不做
- 不动 executeInDocker 内部逻辑（外层 Koa middleware 已接，内层 attempt-loop 纯加在 spawn.js 包一层）
- 不改 classifyFailure / shouldRetry 现有实现（PR #2550 已建，本次只调用）
- 不引入新的 env 变量或 feature flag（Phase B/C 的事）
- 不改 harness-initiative-runner / content-pipeline 等 caller（verify 不退化即可）
- 不做 observability（metrics / 日志格式变化留给 Phase E Observer）

## 风险
- MAX_ATTEMPTS=3 可能与上层 dispatch-level retry 叠加变 9 次 → 注释说明 + 全仓 grep failure_count
- classifyFailure 启发式可能漏判新 permanent pattern → 监控 24h 生产日志
- delete opts.env.CECELIA_CREDENTIALS 副作用 → 注释说明

## 参考
- Roadmap: docs/design/brain-v2-roadmap-next.md §Phase A
- Spec: docs/design/brain-orchestrator-v2.md §5.2

