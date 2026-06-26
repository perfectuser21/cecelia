# llm-caller 把 429 限流误判为 auth 失败、熔断有效账号

2026-06-26。harness 端到端真 run 验证时，planner 容器反复 "Not logged in"，逐层挖到账号熔断层。

### 根本原因
- `cecelia-bridge.cjs` 用 `--output-format text`，且 `code!=0` 时 `error = stderr || "exit code ${code}"`，
  **只取 stderr 丢弃 stdout**。claude CLI 的真实错误（429 / "Not logged in"）走 stdout，被丢 →
  bridge 返回的 errText 永远是无信息的 `"exit code 1"`。
- `llm-caller.js` 把任何连续 3 次 bridge `exit code 1` 一刀切当 auth 失败 `markAuthFailure(1h, 'api_error')`。
  429 限流（token 仍有效）因此被误判为认证失败，有效账号被熔断（count 38→50，24h backoff）。
- 账号熔断有**两层**：内存 `_authFailureMap`（`isAuthFailed` 优先读）+ DB `account_usage_cache`。
  清 DB 不清内存；重启后 `loadAuthFailuresFromDB` 又从 DB 恢复。`api_error` 类熔断只等 resetTime 自然过期，
  token 恢复有效也不主动清。

### 下次预防
- [ ] markAuthFailure 前必须用 usage API 实时探测 token 是否真失效（200=valid 不熔断 / 401=auth_failed 才熔断），
      不能凭 bridge exit code 一刀切（已实现 `verifyAccountTokenLive` gate）
- [ ] 限流（429）与认证失败（401）必须区分对待：限流是临时退避，不是账号失效
- [ ] 调试账号问题：先实测 token（usage API 200/401）再信任熔断状态，别被 stale 熔断误导
- [ ] 账号熔断清理要同时清内存 Map + DB，单清一层无效（清 DB 后内存仍 quarantine，重启又从 DB 恢复）
- [ ] bridge 层 `code!=0` 丢弃 stdout 导致错误信息全丢——可观测性缺口（本 PR 用 token 探测绕开，未改 bridge）

### 关联
- 设计：`docs/superpowers/specs/2026-06-26-llm-caller-429-not-authfail-design.md`
- 同期发现：Brain 跑镜像层 /app 非 mount，代码更新必须 `brain-deploy.sh` 重建镜像（见 memory）
