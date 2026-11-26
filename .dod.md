# 清退旧 PR Preview 生产者与无消费磁盘采样

Task: ef0b3c59-9db5-42a0-95a3-c6a4ee6e3653
GP-Anchor: none(infra)

- [x] 真实 HTTP start 先鉴权，start/allocate 在既有 JSON 解析边界内返回410，准入与spawn零副作用。
  Test: manual:npx --no-install vitest run --root packages/brain src/routes/__tests__/preview-source-identity.test.js
- [x] 历史身份/status/stop/DELETE与原销毁保护保留，native staging端口分配继续验证。
  Test: manual:npx --no-install vitest run --root packages/brain src/routes/__tests__/preview.test.js src/routes/__tests__/preview-source-identity.test.js src/__tests__/preview-manager.test.js src/__tests__/staging-e2e-runner-review-env-ssh.test.js
- [x] 代理真实入口保令牌拒绝、loopback与cache挂载，零采样exec与零timer。
  Test: manual:bash scripts/ops/__tests__/credentials/preview-agent-startup.test.sh
- [x] Cache自有磁盘前后证据与强鉴权、intent/receipt保留，workers原始字节/权限恢复与失败闭锁保留。
  Test: manual:node --test scripts/preview-cache.test.mjs scripts/preview-cache-http.test.mjs
- [x] 本批完整Ops/Scripts通过；默认单测收集1804；运行态Mac代理及cron清理由独立运维交接核验。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
