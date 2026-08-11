# Universal Map Projection Engine — Knife 1 Definition of Done

### [BEHAVIOR] D1：完整 Manifest 返回全部结构与引用错误

- [ ] validate 对非法完整输入一次返回全部结构、重复 key 与悬空引用错误，且不查询数据库。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-schema.test.js src/routes/__tests__/map-manifests.test.js"

### [BEHAVIOR] D2：Canonical digest 与 JSON key 顺序无关

- [ ] 同一完整 manifest 仅改变 object key 顺序时生成相同 64 位小写 SHA-256。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-schema.test.js"

### [BEHAVIOR] D3：Draft 版本不可变且 digest 幂等

- [ ] 相同 scope/digest 并发或重复提交只保留一行同版本；不同 digest 单调增加 version，完整内容不可 PATCH。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-store.test.js src/__tests__/integration/map-manifest-store.integration.test.js src/__tests__/migration-402-map-manifest.test.js"

### [BEHAVIOR] D4：激活与 Projector 同事务 fail-closed

- [ ] projector 成功才切 active；projector unavailable/失败时事务回滚且旧 active 保持不变。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-store.test.js src/routes/__tests__/map-manifests.test.js src/__tests__/integration/map-manifest-store.integration.test.js"

### [BEHAVIOR] D5：统一 Manifest 写 API

- [ ] validate/submit/activate 三端点按合同返回，且不存在 Value Stream、Capability、Boundary、Cross-cut 的独立创建端点。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/routes/__tests__/map-manifests.test.js"

### [ARTIFACT] D6：冻结 Cecelia v1 Manifest

- [ ] 冻结输入精确包含 2 个 Value Stream、11 个 Capability、2 条 Boundary、7 个 Cross-cut，Shared Prerequisite applicable=false，source decision 为 4bc109e9。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-schema.test.js"

### [ARTIFACT] D7：Migration 与 Brain 版本同步

- [ ] migration 402、schema floor、Brain package、root lock、`.brain-versions` 与 `DEFINITION.md` 同步。
  Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh"

### [BEHAVIOR] D8：Scratch Manifest 真验火

- [ ] scratch 真实提交冻结 manifest 两次只产生一个 draft；默认激活 fail-closed 且不产生 active；fixture 全部清理。
  Test: manual:bash -c "DATABASE_URL=postgresql://localhost/cecelia_scratch bash packages/brain/scripts/smoke/map-manifest-smoke.sh"
