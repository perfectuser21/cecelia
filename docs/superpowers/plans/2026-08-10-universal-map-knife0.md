# Universal Map Projection Engine — Knife 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复四类 Repo 事实快照的自动刷新，并让每一行事实可追溯到 repo revision、scanner version；任何超过 15 分钟或来源异常的快照在 API 中 fail-closed 为 unknown。

**Architecture:** host cron 只负责触发，`run-all-scans.sh` 自己解析显式 Node 可执行文件并聚合四 scanner 退出码。Scanner 先完整收集事实和 Git SHA，再通过共享的事务同步器按 repo 原子 upsert 当前事实并删除消失事实；失败发生在事务切换前，旧快照保持可读。Registry/graph 查询按 repo 读取最新快照元数据，并由单一 freshness resolver 输出兼容字段与 `fresh/unknown` 状态。

**Tech Stack:** Bash、Node.js ESM/CommonJS、PostgreSQL、Vitest、Supertest、真实 `cecelia_test/cecelia_scratch`。

---

### Task 1: Cron-safe 扫描入口

**Files:**
- Create: `scripts/__tests__/run-all-scans.test.sh`
- Modify: `scripts/scan/run-all-scans.sh`

- [ ] **Step 1: 写 sanitized cron PATH 的 failing test**

测试创建临时 `NODE_BIN` stub，并以 `env -i PATH=/usr/bin:/bin` 执行 runner；断言四个 scanner 全被调用、单个失败不会阻止其余 scanner、最终退出码聚合为非零。当前 runner 忽略 `NODE_BIN`，应以 `node: command not found` 失败。

- [ ] **Step 2: 运行 RED**

Run: `bash scripts/__tests__/run-all-scans.test.sh`

Expected: FAIL，原因是 sanitized PATH 找不到 `node` 或未调用注入的 stub。

- [ ] **Step 3: 提交 RED**

```bash
git add scripts/__tests__/run-all-scans.test.sh
git commit -m "test(scan): reproduce cron PATH scanner outage"
```

- [ ] **Step 4: 最小实现**

`run-all-scans.sh` 使用以下合同：

```bash
resolve_node() {
  if [[ -n "${NODE_BIN:-}" && -x "${NODE_BIN}" ]]; then printf '%s\n' "$NODE_BIN"; return; fi
  command -v node 2>/dev/null && return
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    [[ -x "$candidate" ]] && { printf '%s\n' "$candidate"; return; }
  done
  return 1
}
NODE_EXECUTABLE=$(resolve_node) || { echo "FAIL: Node executable not found" >&2; exit 127; }
```

循环通过 `"$NODE_EXECUTABLE" "scripts/scan/${s}"` 调用默认四 scanner；允许测试用 `SCAN_SCRIPTS` 覆盖清单。

- [ ] **Step 5: 运行 GREEN 与既有事件扳机测试**

Run: `bash scripts/__tests__/run-all-scans.test.sh && bash scripts/__tests__/rescan-if-changed.test.sh && bash -n scripts/scan/run-all-scans.sh scripts/scan/rescan-if-changed.sh`

Expected: PASS。

- [ ] **Step 6: 提交实现**

```bash
git add scripts/scan/run-all-scans.sh
git commit -m "fix(scan): make photo scans independent of cron PATH"
```

### Task 2: Versioned Fact Snapshot 合同与原子同步

**Files:**
- Create: `packages/brain/migrations/397_fact_snapshot_metadata.sql`
- Create: `packages/brain/migrations/rollback/397_fact_snapshot_metadata.down.sql`
- Create: `packages/brain/src/lib/fact-snapshot-store.js`
- Create: `packages/brain/src/lib/__tests__/fact-snapshot-store.test.js`
- Create: `packages/brain/src/__tests__/integration/fact-snapshot-store.integration.test.js`
- Create: `packages/brain/src/__tests__/migration-397-fact-snapshot.test.js`
- Modify: `packages/brain/src/lib/graph-store.js`
- Modify: `packages/brain/src/lib/__tests__/graph-store.test.js`
- Modify: `scripts/scan/scan-api-registry.js`
- Modify: `scripts/scan/scan-db-schema.js`
- Modify: `scripts/scan/scan-test-registry.js`
- Modify: `scripts/scan/scan-graph.mjs`
- Modify: `packages/brain/src/selfcheck.js`
- Modify: `packages/brain/src/__tests__/selfcheck.test.js`
- Modify: `packages/brain/src/__tests__/learnings-vectorize.test.js`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`

- [ ] **Step 1: 写 metadata + replacement failing tests**

测试合同：

```js
await replaceFactSnapshot(pool, 'test', {
  repo: 'itest-repo', sourceRevision: 'a'.repeat(40), scannerVersion: 'test-registry-v2',
  rows: [{ file_path: 'new.test.js', test_count: 1, covered_behaviors: ['works'], area: 'cecelia', test_type: 'unit' }],
});
```

断言旧 `old.test.js` 消失、新行携带 revision/version；第二次同步失败时事务 rollback，上一快照仍完整；同路径已有 `feature_id/status` 在刷新后保留。Graph store 测试断言 INSERT 含 `source_revision/scanner_version`。

- [ ] **Step 2: 运行 RED**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/fact-snapshot-store.test.js src/__tests__/integration/fact-snapshot-store.integration.test.js src/__tests__/migration-397-fact-snapshot.test.js src/lib/__tests__/graph-store.test.js`

Expected: FAIL，因为 migration、模块和新列尚不存在。

- [ ] **Step 3: 提交 RED**

```bash
git add packages/brain/src/lib/__tests__/fact-snapshot-store.test.js packages/brain/src/__tests__/integration/fact-snapshot-store.integration.test.js packages/brain/src/__tests__/migration-397-fact-snapshot.test.js packages/brain/src/lib/__tests__/graph-store.test.js
git commit -m "test(brain): define versioned fact snapshot contract"
```

- [ ] **Step 4: 添加 additive migration 397**

四表统一增加：

```sql
repo TEXT NOT NULL DEFAULT 'cecelia',
source_revision TEXT NOT NULL DEFAULT 'legacy-unknown',
scanner_version TEXT NOT NULL DEFAULT 'legacy'
```

`api_registry/db_schema_registry/test_registry` 的唯一键分别收敛为 `(repo, method, path)`、`(repo, table_name)`、`(repo, file_path)`；添加 `(repo, scanned_at DESC)` 索引。Graph 保留既有 repo，仅补 revision/version。rollback 只撤新增索引/约束/列，并恢复旧唯一键。

- [ ] **Step 5: 实现共享事务同步器**

`replaceFactSnapshot(pool, kind, snapshot)` 仅接受白名单 `api/db_schema/test`。事务顺序为 `BEGIN → upsert 当前事实（保留非 scanner annotation）→ DELETE 当前 repo 中不在本轮 key set 的旧事实 → COMMIT`；任一步失败执行 `ROLLBACK`。空 rows 表示成功扫描出空事实，删除该 repo 旧事实。

- [ ] **Step 6: Scanner 写入真实 revision/version**

每个 scanner 在任何 DB 写入前运行 `git -C <repo-root> rev-parse HEAD`；失败即退出且不切换快照。版本固定为 `api-registry-v2/db-schema-v2/test-registry-v2/graph-v3`。Graph 的 `replaceRepoEdges` 增加 metadata 参数；dependency-cruiser 失败升级为该 repo 扫描失败，不写 partial snapshot。

- [ ] **Step 7: 版本同步**

Brain 版本从 `1.271.3` 升到 `1.271.4`；schema floor 从 `395` 升到 `397`，同步 package lock、`.brain-versions`、`DEFINITION.md` 和两处断言。

- [ ] **Step 8: 运行 migration + GREEN**

Run: `psql -d cecelia_test -v ON_ERROR_STOP=1 -f packages/brain/migrations/397_fact_snapshot_metadata.sql`

Run: `cd packages/brain && npx vitest run src/lib/__tests__/fact-snapshot-store.test.js src/__tests__/integration/fact-snapshot-store.integration.test.js src/__tests__/migration-397-fact-snapshot.test.js src/lib/__tests__/graph-store.test.js ../../tests/regression/relay-85806b9a/scan-graph-multi-repo.test.mjs`

Expected: PASS。

- [ ] **Step 9: 提交实现**

```bash
git add packages/brain/migrations packages/brain/src scripts/scan packages/brain/package.json packages/brain/package-lock.json .brain-versions DEFINITION.md
git commit -m "feat(brain): version and atomically replace fact snapshots"
```

### Task 3: 15 分钟 freshness fail-closed API

**Files:**
- Modify: `packages/brain/src/lib/registry-freshness.js`
- Modify: `packages/brain/src/lib/__tests__/registry-freshness.test.js`
- Modify: `packages/brain/src/lib/registry-photo-layer.js`
- Modify: `packages/brain/src/lib/__tests__/registry-photo-layer.test.js`
- Modify: `packages/brain/src/routes/registry.js`
- Modify: `packages/brain/src/routes/__tests__/registry-photo-layer.test.js`
- Modify: `packages/brain/src/routes/graph.js`
- Modify: `packages/brain/src/routes/__tests__/graph.test.js`
- Modify: `packages/brain/src/__tests__/integration/registry-photo-layer.integration.test.js`

- [ ] **Step 1: 写 15 分钟与 metadata API failing tests**

断言 14 分钟为 `status=fresh`，16 分钟为 `status=unknown/reason_code=snapshot_stale`；missing/invalid revision 也为 unknown。Registry `?repo=` 必须进入 SQL filter，items/freshness 返回 `repo/source_revision/scanner_version/last_success_at`。Graph freshness 查询同样按 repo 返回 revision。

- [ ] **Step 2: 运行 RED 并提交**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/registry-freshness.test.js src/lib/__tests__/registry-photo-layer.test.js src/routes/__tests__/registry-photo-layer.test.js src/routes/__tests__/graph.test.js src/__tests__/integration/registry-photo-layer.integration.test.js`

Expected: FAIL，旧默认阈值为 24 小时且缺少 metadata/status。

```bash
git add packages/brain/src/lib/__tests__/registry-freshness.test.js packages/brain/src/lib/__tests__/registry-photo-layer.test.js packages/brain/src/routes/__tests__/registry-photo-layer.test.js packages/brain/src/routes/__tests__/graph.test.js packages/brain/src/__tests__/integration/registry-photo-layer.integration.test.js
git commit -m "test(brain): enforce fail-closed fact freshness"
```

- [ ] **Step 3: 最小实现**

`computeFreshness` 接受 `{ scanned_at, source_revision, scanner_version }` 或旧 timestamp；保留 `stale/latest_scan/age_hours/warning` 兼容字段，并新增：

```json
{
  "status": "fresh|unknown",
  "reason_code": null,
  "last_success_at": "ISO timestamp",
  "source_revision": "git sha",
  "scanner_version": "scanner id"
}
```

默认 budget 为 `15 / 60` 小时。Registry/graph 查询按 `repo` 过滤并取同 repo 最新 metadata，禁止另一仓的新快照掩盖陈旧仓。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/registry-freshness.test.js src/lib/__tests__/registry-photo-layer.test.js src/routes/__tests__/registry-photo-layer.test.js src/routes/__tests__/graph.test.js src/__tests__/integration/registry-photo-layer.integration.test.js ../../tests/regression/relay-85806b9a/scan-graph-freshness.test.mjs`

Expected: PASS。

```bash
git add packages/brain/src/lib/registry-freshness.js packages/brain/src/lib/registry-photo-layer.js packages/brain/src/routes/registry.js packages/brain/src/routes/graph.js
git commit -m "feat(brain): fail closed stale fact snapshots after 15 minutes"
```

### Task 4: Smoke、真实扫描与运行态 cron 验火

**Files:**
- Create: `packages/brain/scripts/smoke/map-fact-snapshot-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`

- [ ] **Step 1: 写 smoke 并先验证它在未迁移 scratch DB 上失败**

Smoke 检查四表 metadata 列、sanitized PATH runner、API freshness shape；禁止修改生产表。

- [ ] **Step 2: scratch migration + 四 scanner 真跑**

Run: `createdb cecelia_scratch`（仅数据库不存在时）并按仓库 migration runner 初始化；再执行：

```bash
DATABASE_URL=postgresql://localhost/cecelia_scratch \
REPO_ROOT_CECELIA="$PWD" \
bash scripts/scan/run-all-scans.sh
```

断言四表最新行 revision 等于 `git rev-parse HEAD`，scanner version 非 legacy，删除 fixture 后重扫旧事实消失。

- [ ] **Step 3: proven-to-fire freshness**

仅在 `cecelia_scratch` 把一类 snapshot 推到 16 分钟前，通过 route/integration harness 断言 `status=unknown/reason_code=snapshot_stale`；重扫后恢复 fresh。

- [ ] **Step 4: 修复 host crontab PATH 并验证事件扳机**

保留完整 crontab，仅将 PATH 行改为：

```text
PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

运行 main 工作区的 `rescan-if-changed.sh`，验证 `/tmp/registry-scan-last-sha` 只在四 scanner 全成功后等于 `origin/main`，真实 production registry `scanned_at` 更新。此步骤不改数据库 schema。

- [ ] **Step 5: 全套验证**

Run: `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs`

Run: `bash packages/brain/scripts/smoke/map-fact-snapshot-smoke.sh`

Run: `node packages/engine/scripts/devgate/light-evaluator.cjs --sprint-dir sprints/08101613-universal-map-knife0`

Run: `npm test`

Expected: 全部 PASS；若全量 Vitest 受资源退出，必须保留退出码与日志并单独证明所有 Knife 0 相关测试通过，不能把无 summary 当 PASS。

- [ ] **Step 6: 提交 smoke**

```bash
git add packages/brain/scripts/smoke/map-fact-snapshot-smoke.sh packages/quality/smoke-allowlist.txt sprints/08101613-universal-map-knife0
git commit -m "test(brain): prove fact snapshots refresh and fail closed"
```
