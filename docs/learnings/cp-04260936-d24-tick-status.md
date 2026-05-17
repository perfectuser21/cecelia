## D2.4 — 抽 tick-status.js (getTickStatus + isStale + getStartupErrors)（2026-04-26）

### 根本原因

tick.js 单文件 703 行长期承载多个职责：循环入口（runTickSafe / startTickLoop），状态查询（getTickStatus / isStale / getStartupErrors），recovery（initTickLoop / tryRecoverTickLoop），immune 检查 等。Phase D2 拆分目标是按职责切到独立模块。本 PR 是 D2.4，专门处理"状态查询"职能：

- `getTickStatus` (~83 行) 是 GET /api/brain/tick/status 端点的实现，做大量 working_memory 读取 + 状态聚合（drain/watchdog/quarantine/slot budget/circuit breaker/alertness）。任何想用此函数的 caller（如 status route、health check）都要 import tick.js，连带拉入完整 tick loop / recovery 实现 — 编译开销大、跑测试时副作用多。
- `isStale` (~8 行) 静态判断函数，无任何 state 依赖，常被 dispatcher / status 模块直接调用，留在 tick.js 强迫调用方背 tick.js 全量依赖图。
- `getStartupErrors` (~15 行) 同理，仅 working_memory pool 读取。

把 3 函数抽出后，tick-status.js 成为"只读状态门面"，可以被 routes / health check 单独 import 不带 loop 实现。

### 下次预防

- [ ] tick.js 只读 getter（getTickStatus / isStale / getStartupErrors）和 loop 控制（runTickSafe / startTickLoop）必须分文件 — 前者频繁被外部 route 调用，后者只在 server 启动时一次。
- [ ] 抽函数时若有内部 caller (initTickLoop / tryRecoverTickLoop 都调 getTickStatus)，tick.js 同时 `import` 又 `re-export`，保持 backwards-compat 直到调用方也搬走。
- [ ] 静态代码扫描类测试（如 self-drive-state-reader.test.ts 的 `?? true` 检查）跟随源码搬迁同步更新，避免拆模块后的源码扫描永久 false negative。
- [ ] D2 阶段 3 PR 并行改 tick.js 时，commit 顺序与 rebase 策略事先约定：最后合者承担 rebase 责任，且单 PR 的"tick.js < 400 行" DoD 在最后合者 PR 上才会真正通过。
