## v2 P2 PR10 清最后硬编码 account1 fallback（2026-04-23）

### 根本原因

v2 P2 第 10 PR。把 `content-pipeline-graph-runner.js:102` 的 `|| 'account1'` fallback 删掉——这个 fallback 是 robot final bug 的根因（选 account1 5h=13% 但 7d=100% → 429）的最后残留。现在当 dynamicCredential 为空时不设 CECELIA_CREDENTIALS，让 executeInDocker 里的 resolveAccount middleware（PR3）实时按 §5.3 遍历顺序选账号。

同时更新 executor.js:2852 的过时注释（引用 resolveAccountForOpts 旧名 + 错误行号），指向新的 spawn/middleware/account-rotation.js。

注意：executor.js:3039-3049 的 Sprint 硬绑 account1 **保留不动** —— 这是业务逻辑（Sprint 任务偏好 account1 便于归账），已经带条件 fallback，不属于 "硬编码 bug"。

### 下次预防

- [ ] **`|| 'account1'` 模式要全仓扫**：fallback 到硬编码账号在 JS 代码里通常是早期快速解决办法，P2 清掉了 content-pipeline，未来有新 caller 要加账号选择时，必须用"不传 env 让 middleware 选"模式，不要引入新硬编码
- [ ] **注释里的函数名/行号 rename 要跟改**：executor.js:2852 的 `resolveAccountForOpts (docker-executor.js:359)` 在 PR3 rename 后成了过时注释。code review 时要扫注释里的函数名，不只是代码调用点
- [ ] **硬编码清理不求 100% 激进**：executor.js:3043 Sprint 硬绑保留是有意的（业务需求）。PR10 不越界改它。以后"清硬编码"类 PR 要区分 "代码缺陷" 和 "业务选择"
