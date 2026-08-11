# Universal Map Knife 3 DoD

- [ ] migration 406 建立显式 scope→repo adapter，未配置 scope fail-closed，无同名猜测。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-406-map-scope-repositories.test.js src/lib/__tests__/map-repo-adapter.test.js"

- [ ] Anchor Resolver 仅用 capability_code/UUID/稳定事实标识精确命中，歧义和名称模糊归属均不进 active map。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-anchor-resolver.test.js"

- [ ] 重建投影确定性生成 feature/artifact/assertion 节点与 implements/proves/affects 边，同输入 digest 一致。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-projector.test.js src/__tests__/integration/map-projection-store.integration.test.js"

- [ ] State Resolver 现算五态，15 分钟 freshness 与 current revision receipt 绑定 fail-closed，忽略旧 cell_status。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-state-resolver.test.js src/__tests__/integration/map-state-resolver.integration.test.js"

- [ ] 影响半径按 repo 隔离、确定排序，返回受影响业务节点和必跑断言，Cross-cut radius 非空。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-impact-radius.test.js src/__tests__/integration/map-impact-radius.integration.test.js"

- [ ] scratch 真验火证明 PASS→green、删除测试重扫→gray、当前 revision FAIL→red、快照陈旧→unknown，且 fixture 全清零。
  Test: manual:bash -c "DATABASE_URL=postgresql://localhost/cecelia_scratch bash packages/brain/scripts/smoke/map-anchor-state-smoke.sh"

- [ ] 三项 DevGate、版本同步、smoke allowlist、全量 Brain 测试和真实 PostgreSQL integration 全绿。
  Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs sprints/08111325-universal-map-knife3/contract-dod.md && grep -Fx map-anchor-state-smoke.sh packages/quality/smoke-allowlist.txt"

