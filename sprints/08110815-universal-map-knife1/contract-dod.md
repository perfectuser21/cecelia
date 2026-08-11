# Universal Map Projection Engine — Knife 1 Definition of Done

### [BEHAVIOR] D1：完整 Manifest 返回全部结构与引用错误

- [x] validate 对非法完整输入一次返回全部结构、重复 key 与悬空引用错误，且不查询数据库。
Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-schema.test.js src/routes/__tests__/map-manifests.test.js"

Evidence: schema/route 定向测试通过；validate route 断言 pool connect/query 均为 0。

### [BEHAVIOR] D2：Canonical digest 与 JSON key 顺序无关

- [x] 同一完整 manifest 仅改变 object key 顺序时生成相同 64 位小写 SHA-256。
Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-schema.test.js"

Evidence: object key 逆序 digest 相同、array 顺序变化 digest 不同。

### [BEHAVIOR] D3：Draft 版本不可变且 digest 幂等

- [x] 相同 scope/digest 并发或重复提交只保留一行同版本；不同 digest 单调增加 version，完整内容不可 PATCH。
Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-store.test.js src/__tests__/integration/map-manifest-store.integration.test.js src/__tests__/migration-402-map-manifest.test.js"

Evidence: 真实 PostgreSQL 并发提交只产生 version=1 一行；第二 digest 为 version=2；trigger 与 HTTP 均拒绝内容修改。

### [BEHAVIOR] D4：激活与 Projector 同事务 fail-closed

- [x] projector 成功才切 active；projector unavailable/失败时事务回滚且旧 active 保持不变。
Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-store.test.js src/routes/__tests__/map-manifests.test.js src/__tests__/integration/map-manifest-store.integration.test.js"

Evidence: 真实 DB 中失败后 version1=active/version2=draft，成功后 version1=superseded/version2=active。

### [BEHAVIOR] D5：统一 Manifest 写 API

- [x] validate/submit/activate 三端点按合同返回，且不存在 Value Stream、Capability、Boundary、Cross-cut 的独立创建端点。
Test: manual:bash -c "cd packages/brain && npx vitest run src/routes/__tests__/map-manifests.test.js"

Evidence: 6 项 Supertest 合同通过；首次 201、重复 200、unavailable 503、四类局部写入口 404。

### [ARTIFACT] D6：冻结 Cecelia v1 Manifest

- [x] 冻结输入精确包含 2 个 Value Stream、11 个 Capability、2 条 Boundary、7 个 Cross-cut，Shared Prerequisite applicable=false，source decision 为 4bc109e9。
Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-schema.test.js"

Evidence: 冻结 JSON 逐项断言通过；F5/F6/F7/F8 未生成 Capability，仅保留 alias。

### [ARTIFACT] D7：Migration 与 Brain 版本同步

- [x] migration 402、schema floor、Brain package、root lock、`.brain-versions` 与 `DEFINITION.md` 同步。
Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh"

Evidence: Brain=1.271.5、schema floor=402；facts-check 与 version-sync 均 exit 0。

### [BEHAVIOR] D8：Scratch Manifest 真验火

- [x] scratch 真实提交冻结 manifest 两次只产生一个 draft；默认激活 fail-closed 且不产生 active；fixture 全部清理。
Test: manual:bash -c "DATABASE_URL=postgresql://localhost/cecelia_scratch bash packages/brain/scripts/smoke/map-manifest-smoke.sh"

Evidence: smoke 连续两次 `ALL PASS`；结束后 manifest/decision residue=`0|0`。
