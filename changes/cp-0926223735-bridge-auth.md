## Brain {VERSION} — codex-bridge 回调 Brain 补内部鉴权 Bearer 头（任务 446aa294，决策 6ac4563e，链 bf5088a3 棒1 补棒）

- `packages/brain/scripts/codex-bridge/codex-bridge.cjs` `callbackBrain()` 打 `POST /api/brain/execution-callback` 的 fetch headers 合入 `scripts/lib/brain-auth-headers.cjs` 的 `brainAuthHeaders()`（token 只从 env `CECELIA_INTERNAL_TOKEN` 或 `~/.credentials/cecelia-internal.env` 读）；#5592 上产后 xian-m4 / xian-m1 桥回调不再 401
- `callbackBrain` 加入 module.exports，供回归测试 `src/__tests__/codex-bridge-callback-auth.test.js`（配 token 必带 `Authorization: Bearer`；未配不带）
- `kernel-attempt-handler.cjs` 走 kernel 签发的 callback_token，未动
- 桥机器生效需同步更新 `packages/brain/scripts/codex-bridge/codex-bridge.cjs` + `scripts/lib/brain-auth-headers.cjs`（LaunchAgent 跑的是完整仓库 clone，`git pull` 即可）并在桥机 `~/.credentials/cecelia-internal.env` 放 `CECELIA_INTERNAL_TOKEN=`
