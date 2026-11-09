# DoD：清退 CI 内部伪测试与重复检查

- [x] [BEHAVIOR] API 保留共享前端与真实 hook；删除旧模型页伪测试，加载、动作失败与 WebSocket 更新通过真实 hook 验证。
  Test: manual:npm exec --workspace @cecelia/core -- vitest run features/inbox/__tests__/useProposals.test.ts
- [x] [ARTIFACT] 退休 playground 算术回归、旧任务端口探活与空 Quality 包测试清退；有效任务领取、SQL、来源身份和总门拒绝保持。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [x] [BEHAVIOR] 旧 tick 字符串断言与重复退休 no-op 合并，现役调度接线和退役入口零副作用仍有覆盖。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/initiative-lifecycle-2b1.test.js src/__tests__/okr-closer.test.js ../../tests/regression/drift-sentinel-init/tick-runner-drift-sentinel-wiring.test.js ../../tests/regression/codex-grok-launcher-supervisor/harness-skill-relay-routing.test.js ../../tests/regression/relay-a598772e/harness-skill-relay-grok.test.js
- [x] [BEHAVIOR] API 类型编译由完整 build 执行；只认精确完整新旧 CI 来源，未知混配、缺失或篡改继续拒绝。
  Test: manual:npm run build --workspace @cecelia/core
  Test: manual:node --test scripts/ci/__tests__/basic-auto-version-retirement.test.mjs
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/claude-channel-retired.guard.test.js src/__tests__/claude-channel-retired.reader-tuples.test.js
- [x] [BEHAVIOR] 部署 host、drain 取消、失败日志与 npm cache 通过真实隔离脚本验证，清退被替代的 grep 自证。
  Test: manual:bash scripts/__tests__/bluegreen-stable-health.test.sh
  Test: manual:bash scripts/__tests__/brain-deploy-sha-readonly.test.sh
  Test: manual:node --test scripts/bluegreen-sidecar-completion.test.mjs
  Test: manual:bash scripts/smoke/deploy-local-npm-cache-smoke.sh
