# DoD — 受控再基恢复

- [x] [BEHAVIOR] 显式受鉴权入口追加收据、签发Controller、保留失败事实；旧入口与无显式请求仍拒绝。
  Test: manual:bash -c "npx vitest run tests/gp/f1/step1-controlled-recovery.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] Map/Git/活跃身份改变即拒绝，旧恢复保护保持。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/orchestrator/__tests__/recovery-rebase.test.js src/orchestrator/__tests__/kernel-run-store.test.js src/__tests__/relay-runs-canonical-create.test.js src/orchestrator/preflight/base-sha-reanchor.test.js --maxWorkers=1 --minWorkers=1"

真实隔离PG 6项已通过，详见永久 integration。正式 native、Judge、CI 与部署状态记录于 Brain 任务，不据本 DoD 宣称已完成。

- [x] [BEHAVIOR] 正规恢复冻结目标贯穿ground-truth同run候选与真实dispatcher到attempt/launcher边界，排除旧us投影；冲突profile与非法target无新run或派发。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/orchestrator/__tests__/recovery-target-cross-path.test.js --maxWorkers=1 --minWorkers=1"
