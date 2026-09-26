# Learning: codex-bridge 回调 Brain 缺 Bearer 头——#5592 挂闸时漏枚举的调用方

任务 446aa294 · 决策 6ac4563e · 链 bf5088a3 棒1 补棒

### 根本原因

- #5592 给 `POST /api/brain/execution-callback` 挂 `internalAuthOrLoopback`，枚举内部调用方时 grep 的是 `execution-callback` 字面量，覆盖了 `cecelia-run.sh` / `flush` / `executor.js` / `cecelia-bridge.js`，但 `packages/brain/scripts/codex-bridge/codex-bridge.cjs` 的 `callbackBrain()` 用模板串 `${BRAIN_URL}/api/brain/execution-callback` 拼 URL，fetch 只带 `Content-Type`——xian-m4 / xian-m1 各跑一个该桥（LaunchAgent），上产即回调全 401。
- `callbackBrain` 未导出，此前没有任何测试能钉住它的请求头。

### 下次预防

- 给 Brain 路由挂鉴权闸前，枚举调用方必须同时 grep 路由字面量**和** `BRAIN_URL` / `brainUrl` 模板拼接点（`grep -rn '\${BRAIN_URL}\|execution-callback'`），远端桥机器（LaunchAgent / launchd）上的脚本尤其容易漏。
- 桥类脚本打 Brain 一律 `{ 'Content-Type': 'application/json', ...brainAuthHeaders() }`，helper 是 `scripts/lib/brain-auth-headers.cjs`（token 只从 env / `~/.credentials/cecelia-internal.env` 读）。
- 桥机器生效清单：`git pull` 拉到 `codex-bridge.cjs` + `scripts/lib/brain-auth-headers.cjs`，桥机 `~/.credentials/cecelia-internal.env` 放 `CECELIA_INTERNAL_TOKEN=`，`launchctl kickstart -k` 重启 LaunchAgent。

- [ ] 桥机器（xian-m4 / xian-m1）拉新 + 放 token + 重启 LaunchAgent（本 PR 合并后运维动作）
