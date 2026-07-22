# Harness Contract SHA Freeze — DoD

### [BEHAVIOR] immutable-contract-freeze

- [ ] reviewer verdict 锚定服务端 TaskBundle 的 commit SHA；branch 移动后仍从批准 SHA 读取三份合同文件，SHA 缺失或路径不安全时 fail closed。
Test: manual:bash -c "cd packages/brain && npx vitest run src/orchestrator/__tests__/ground-truth.test.js src/orchestrator/__tests__/dispatcher.test.js src/routes/__tests__/harness-attempt-callback.test.js src/routes/__tests__/harness-attempt-verdict-pg.integration.test.js src/orchestrator/__tests__/loop.test.js src/orchestrator/__tests__/git-artifact-reader.test.js"
