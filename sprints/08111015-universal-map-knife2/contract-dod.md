# Universal Map Projection Engine — Knife 2 Definition of Done

### [ARTIFACT] D1：可重建 Projection 三表

- [x] migration 405 建立 runs/nodes/edges，约束稳定类型、digest、run-scoped FK 与每 scope 单 active。
Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/migration-405-map-projection.test.js src/__tests__/integration/migration-405-map-projection.integration.test.js"

Evidence: 真实 PostgreSQL schema 与 SQL 合同 10/10 通过；run 的 manifest identity composite FK、边两端 composite FK 和 partial unique index 均实查存在。

### [BEHAVIOR] D2：完整 Manifest 一次生成 Cecelia 结构

- [x] 纯 Projector 一次输入生成 2 个 Value Stream、11 个 Capability、7 个 Cross-cut 节点，Cross-cut 不计 Capability。
Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-projector.test.js"

Evidence: 冻结完整输入生成 20 个结构节点；类型计数精确为 2/11/7/0。

### [BEHAVIOR] D3：稳定 ID 与 digest 确定性

- [x] 相同输入重复投影、对象 key 重排或展示名改动不改变既有实体 ID；相同结构输入 projection digest 一致。
Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-projector.test.js"

Evidence: stable ID 均为 64 位 SHA-256；对象 key 逆序与 fact revision key 逆序后的节点、边和 digest 完全相同。

### [BEHAVIOR] D4：Manifest 激活与 Projection 原子切换

- [x] 成功激活产生唯一 active run；任一步失败全部回滚、旧 manifest/run 保持 active、读者看不到半张图。
Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-projection-store.test.js src/__tests__/integration/map-projection-store.integration.test.js src/lib/__tests__/map-manifest-store.test.js src/routes/__tests__/map-manifests.test.js"

Evidence: 真库故意制造 edge FK 失败后 version1/旧 run 仍 active、version2 仍 draft，旧图仍为 20 节点/31 边；缓存旧 manifest 重建被稳定拒绝，无法抢回 active。

### [BEHAVIOR] D5：Boundary 是边、Cross-cut 是独立横切节点

- [x] 精确生成 2 条 `hands_off_to`、14 条 `serves` 和 manifest 声明对应的 `owned_by`；Boundary 节点数为零。
Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-projector.test.js src/__tests__/integration/map-projection-store.integration.test.js"

Evidence: 真实 DB 与纯函数均验证 2/14/4；Boundary statement 位于 edge attributes，Boundary key 未出现在节点表。

### [BEHAVIOR] D6：不适用共享前置不造伪结构

- [x] `shared_prerequisites.applicable=false` 时 prerequisite 节点与 `requires` 边均为零，reason 保留在 run 输入来源而非伪节点。
Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/map-projector.test.js"

Evidence: Cecelia 投影 prerequisite/requires 均为 0；另有 applicable=true 回归证明 1 个前置生成 2 条 requires。

### [BEHAVIOR] D7：Scratch 清空重建 digest 不变

- [x] scratch 中通过完整 Manifest 激活生成结构；清空派生节点/边后以同输入重建，前后 projection digest 完全一致，fixture 清零。
Test: manual:bash -c "DATABASE_URL=postgresql://localhost/cecelia_scratch bash packages/brain/scripts/smoke/map-projection-smoke.sh"

Evidence: smoke 连续两次 `ALL PASS`；每次在单事务清空后重建，stable IDs/digest 相同，最终 residue=`0|0`。

### [ARTIFACT] D8：Brain 版本、schema floor 与 smoke 基线同步

- [x] Brain=1.271.7、schema floor=405，版本文件同步，projection smoke 登记为 allowlist 必过项。
Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && grep -Fx map-projection-smoke.sh packages/quality/smoke-allowlist.txt"

Evidence: facts-check、version-sync 与精确 DoD mapping 均 exit 0；审查修复后定向 11 files/63 tests 通过。
