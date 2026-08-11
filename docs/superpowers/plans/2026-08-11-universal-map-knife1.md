# Universal Map Projection Engine — Knife 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付通用、不可变、可审计的 Map Manifest 版本合同，以及纯校验、幂等提交和 fail-closed 激活 API，并把冻结的 Cecelia v1 manifest 作为 draft 写入真实数据库。

**Architecture:** `map-manifest-schema.js` 是结构与跨引用校验入口，输出全部错误并对完整 manifest 生成 canonical SHA-256。`map-manifest-store.js` 在 scope advisory lock 下分配版本、按 digest 幂等提交，并把 projector 作为同事务依赖注入；Knife 2 接入 projector 前，默认激活明确返回 unavailable 且不切 active。Express 路由只负责 HTTP 映射，业务合同可在真实 PostgreSQL 中独立验收。

**Tech Stack:** Node.js ESM、Zod、PostgreSQL、Express、Vitest、Supertest、Bash smoke。

---

### Task 1: Manifest Schema、引用约束与 canonical digest

**Files:**
- Create: `packages/brain/src/lib/map-manifest-schema.js`
- Create: `packages/brain/src/lib/__tests__/map-manifest-schema.test.js`
- Create: `packages/brain/config/map-manifests/cecelia.v1.json`

- [ ] **Step 1: 写 failing test**

测试加载冻结 Cecelia JSON，断言 `validateMapManifest()` 返回全部错误而不是首错；覆盖重复 key、Capability 指向未知 Value Stream、Boundary 指向未知 Capability、Cross-cut `serves/owner` 引用错误、`applicable=false` 却有 items 或缺 reason。另断言对象 key 顺序改变后 `digestMapManifest()` 仍为同一 64 位小写 SHA-256。

- [ ] **Step 2: 运行 RED**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-schema.test.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 提交 RED**

```bash
git add packages/brain/src/lib/__tests__/map-manifest-schema.test.js packages/brain/config/map-manifests/cecelia.v1.json
git commit -m "test(brain): define versioned map manifest contract"
```

- [ ] **Step 4: 实现 schema 与 digest**

导出合同：

```js
export function validateMapManifest(input) {
  return { valid: issues.length === 0, errors: issues, manifest: parsedManifest };
}

export function digestMapManifest(manifest) {
  return createHash('sha256').update(canonicalJson(manifest), 'utf8').digest('hex');
}
```

canonical JSON 递归排序 object keys、保持 array 顺序；schema 只接受 `schema_version=1` 和稳定 key 引用，不读取领域名称，也不包含 Cecelia/ZenithJoy allowlist。

- [ ] **Step 5: 运行 GREEN 并提交**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-schema.test.js`

Expected: PASS。

```bash
git add packages/brain/src/lib/map-manifest-schema.js
git commit -m "feat(brain): validate canonical map manifests"
```

### Task 2: 不可变版本表与事务 Store

**Files:**
- Create: `packages/brain/migrations/402_map_manifest_versions.sql`
- Create: `packages/brain/migrations/rollback/402_map_manifest_versions.down.sql`
- Create: `packages/brain/src/lib/map-manifest-store.js`
- Create: `packages/brain/src/lib/__tests__/map-manifest-store.test.js`
- Create: `packages/brain/src/__tests__/integration/map-manifest-store.integration.test.js`
- Create: `packages/brain/src/__tests__/migration-402-map-manifest.test.js`

- [ ] **Step 1: 写 migration/store failing tests**

单元测试断言提交顺序是 `BEGIN → pg_advisory_xact_lock → decision lookup → digest lookup → next version → INSERT → COMMIT`；相同 `(scope,digest)` 返回原行。真实 DB 测试并发提交同一 manifest 只产生一个版本，第二份不同 digest 得到 version+1；非法 manifest 不写库。激活测试注入 projector，断言 projector、旧 active supersede、新 draft activate 在同事务内完成；projector 抛错后 rollback，旧 active 不变。

- [ ] **Step 2: 运行 RED 并提交**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-store.test.js src/__tests__/integration/map-manifest-store.integration.test.js src/__tests__/migration-402-map-manifest.test.js`

Expected: FAIL，migration/store 不存在。

```bash
git add packages/brain/src/lib/__tests__/map-manifest-store.test.js packages/brain/src/__tests__/integration/map-manifest-store.integration.test.js packages/brain/src/__tests__/migration-402-map-manifest.test.js
git commit -m "test(brain): define immutable map manifest versions"
```

- [ ] **Step 3: 实现 migration 402**

表约束固定为：`UNIQUE(scope_key,version)`、`UNIQUE(scope_key,digest)`、status check、64 hex digest check、`source_decision_id REFERENCES decisions(id)`；partial unique index 保证每 scope 最多一个 active。`BEFORE UPDATE` trigger 禁止修改 scope/version/decision/manifest/digest，只允许状态与激活时间变化。

- [ ] **Step 4: 实现 store**

```js
export async function submitMapManifest(pool, input) { /* validate + locked version insert */ }
export async function activateMapManifest(pool, id, { projector }) { /* one transaction */ }
```

锁键为 `map-manifest:<scope_key>`；projector 缺失时抛 `MAP_PROJECTOR_UNAVAILABLE`，事务 rollback，不产生 active manifest。激活已 active 的同一行幂等返回。

- [ ] **Step 5: 仅迁移测试库并运行 GREEN**

Run: `DB_NAME=cecelia_test node packages/brain/src/migrate.js`

Run: `cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-store.test.js src/__tests__/integration/map-manifest-store.integration.test.js src/__tests__/migration-402-map-manifest.test.js`

Expected: PASS，测试 fixture 清理后无残留。

- [ ] **Step 6: 提交实现**

```bash
git add packages/brain/migrations packages/brain/src/lib/map-manifest-store.js
git commit -m "feat(brain): persist immutable map manifest versions"
```

### Task 3: Validate、Submit、Activate HTTP API

**Files:**
- Create: `packages/brain/src/routes/map-manifests.js`
- Create: `packages/brain/src/routes/__tests__/map-manifests.test.js`
- Modify: `packages/brain/server.js`

- [ ] **Step 1: 写 route failing tests**

覆盖 `POST /validate` 纯校验且 pool query 次数为 0；非法输入 422 返回全部 errors；首次 draft 201、重复 digest 200 且同 id/version；`PATCH` 不存在；激活 projector unavailable 返回 503；注入 projector 的成功激活返回 active。

- [ ] **Step 2: 运行 RED 并提交**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/map-manifests.test.js`

Expected: FAIL，router 不存在。

```bash
git add packages/brain/src/routes/__tests__/map-manifests.test.js
git commit -m "test(brain): define map manifest write API"
```

- [ ] **Step 3: 实现并挂载 router**

```js
app.use('/api/brain/map/manifests', createMapManifestRouter({ pool }));
```

Body 是完整 manifest 本体；没有 Value Stream/Capability/Boundary/Cross-cut 独立写端点。错误映射固定为 422 validation、404 not found、409 state conflict、503 projector unavailable、500 unexpected。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/map-manifests.test.js src/lib/__tests__/map-manifest-schema.test.js src/lib/__tests__/map-manifest-store.test.js`

Expected: PASS。

```bash
git add packages/brain/src/routes/map-manifests.js packages/brain/server.js
git commit -m "feat(brain): expose versioned map manifest API"
```

### Task 4: 版本、DoD 与 scratch 真验火

**Files:**
- Create: `packages/brain/scripts/smoke/map-manifest-smoke.sh`
- Modify: `packages/brain/src/selfcheck.js`
- Modify: `packages/brain/src/__tests__/selfcheck.test.js`
- Modify: `packages/brain/package.json`
- Modify: `package-lock.json`
- Modify: `.brain-versions`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `sprints/08110815-universal-map-knife1/contract-dod.md`

- [ ] **Step 1: 写 failing smoke**

Smoke 强制数据库名匹配 `_test|_scratch`，验证 schema 402、冻结 manifest 校验、首次/重复提交幂等、数据库中只有一行 draft、激活 unavailable 后仍无 active，并在 EXIT 精确清理 fixture scope。

- [ ] **Step 2: 运行 RED 并提交**

Run: `DATABASE_URL=postgresql://localhost/cecelia_scratch bash packages/brain/scripts/smoke/map-manifest-smoke.sh`

Expected: FAIL，scratch 尚无 migration 402 或 API/store 尚未完成。

```bash
git add packages/brain/scripts/smoke/map-manifest-smoke.sh sprints/08110815-universal-map-knife1/contract-dod.md
git commit -m "test(brain): define map manifest scratch smoke"
```

- [ ] **Step 3: 版本同步**

Brain 版本升到 `1.271.5`，schema floor 升到 `402`，同步 package lock、`.brain-versions` 与 `DEFINITION.md`。

- [ ] **Step 4: scratch migration 与 GREEN**

Run: `DB_NAME=cecelia_scratch node packages/brain/src/migrate.js`

Run: `DATABASE_URL=postgresql://localhost/cecelia_scratch bash packages/brain/scripts/smoke/map-manifest-smoke.sh`

Expected: `ALL PASS`，fixture facts 为 0。

- [ ] **Step 5: 回归与门禁**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/map-manifest-schema.test.js src/lib/__tests__/map-manifest-store.test.js src/routes/__tests__/map-manifests.test.js src/__tests__/integration/map-manifest-store.integration.test.js src/__tests__/migration-402-map-manifest.test.js src/__tests__/selfcheck.test.js`

Run: `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs sprints/08110815-universal-map-knife1/contract-dod.md`

Run: `node packages/engine/scripts/devgate/light-evaluator.cjs --sprint-dir sprints/08110815-universal-map-knife1`

Expected: 全部 PASS。

- [ ] **Step 6: 提交、push、PR、CI、merge**

```bash
git add packages/brain package-lock.json .brain-versions sprints/08110815-universal-map-knife1
git commit -m "feat(brain): complete map manifest versioning"
git push -u origin cp-0811-universal-map-knife1
```

创建 PR 后等待全部 required checks 通过再合并；部署完成后通过真实生产 API 提交 `cecelia.v1.json` draft，并查询数据库确认一行且 status=draft。
