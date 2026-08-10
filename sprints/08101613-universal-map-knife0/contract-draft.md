# Test Contract: Universal Map Projection Engine — Knife 0

**Task ID**: 2fb600e9-d733-4469-8804-ce20da17943c  
**Sprint**: `sprints/08101613-universal-map-knife0`  
**Target environment**: `local_db`（仅允许 `cecelia_test` / `*_scratch`）

## 范围

Knife 0 只交付通用 Map Projection Engine 的事实底座：cron-safe 扫描调度、版本化 repo 快照、原子替换、15 分钟 fail-closed freshness，以及按 repo 隔离的一致读取。Cecelia 是首个验收 repo；本 Knife 不交付 Manifest 解析、投影器或统一 Map API。生产库不属于迁移目标，Migration 400 的真实数据库验收只在 `cecelia_test` 与 `cecelia_scratch` 执行。

## Test Contract

| Workstream | Test File / Command | Behavior |
|---|---|---|
| D1 | `scripts/__tests__/run-all-scans.test.sh` | sanitized PATH 下聚合四 scanner；单项失败仍执行其余项并最终非零；无效 repo root fail-fast |
| D2 | `scripts/__tests__/rescan-if-changed.test.sh` | 仅在 HEAD 变化时扫描；成功后记 SHA；失败保留旧 SHA |
| D3 | `packages/brain/src/__tests__/integration/fact-snapshot-store.integration.test.js` | `重复 API composite natural key 只保留一条事实且 header row_count=1` |
| D3 | `packages/brain/src/__tests__/integration/graph-store.integration.test.js` | `空边快照仍写入 fresh header，graph context 返回 row_count=0` |
| D3 | `packages/brain/src/__tests__/migration-400-fact-snapshot.test.js` | `fact_snapshot_headers 具有通用 kind/repo 主键与 metadata/row_count 列` |
| D3 | `packages/brain/src/__tests__/migration-400-fact-snapshot.test.js` | `四个 scanner 共用的 revision helper 统一执行 git -C root rev-parse HEAD` |
| D4 | `packages/brain/src/lib/__tests__/fact-snapshot-store.test.js` | `API 快照在同一事务中 upsert 当前事实并删除同 repo 消失的旧事实` |
| D4 | `packages/brain/src/lib/__tests__/fact-snapshot-store.test.js` | `任一步失败都会 ROLLBACK 并 rethrow，不提交半张快照` |
| D4 | `packages/brain/src/lib/__tests__/fact-snapshot-store.test.js` | `header row_count 来自 delete 后真实表 count，而不是输入 rows.length` |
| D4 | `packages/brain/src/lib/__tests__/graph-store.test.js` | `不同 repo 使用不同且参数化的 graph 锁键` |
| D4 | `packages/brain/src/lib/__tests__/consistent-read.test.js` | `在同一只读 REPEATABLE READ 事务执行全部读取并提交释放` |
| D5 | `packages/brain/src/lib/__tests__/registry-freshness.test.js` | `默认 freshness budget 为 15 分钟` |
| D5 | `packages/brain/src/lib/__tests__/registry-freshness.test.js` | `快照超过未来 60s → unknown/snapshot_from_future` |
| D5-D6 | `packages/brain/src/lib/__tests__/registry-photo-layer.test.js` | `带 search/repo:占位符顺延，items 与 latest metadata 查询都严格过滤 repo` |
| D5-D6 | `packages/brain/src/routes/__tests__/graph.test.js` | `locate/related/claim/radius/island/anchor 均返回完整 metadata freshness` |
| D6 | `tests/regression/relay-85806b9a/scan-graph-freshness.test.mjs` | `repo-X stale（无数据）时，repo-Y 活跃不影响 repo-X 的 stale 判定` |
| D6 | `tests/regression/relay-85806b9a/graph-route-repo-param.test.mjs` | `DB 层 WHERE repo=$1 过滤：不同 repo 返回空（无数据泄露）` |
| D8 | `packages/brain/scripts/smoke/map-fact-snapshot-smoke.sh` | scratch 四 scanner 真扫、事实消失、stale→unknown→重扫恢复、并发无残留 |

## Golden Path

1. `run-all-scans.sh` 解析显式 repo 选择，并在禁止 pull 的模式下调用四类 scanner。
2. scanner 从 repo 的 Git HEAD 读取 `source_revision`，生成带稳定 `scanner_version` 的事实集合。
3. store 以 `(kind, repo)` advisory lock 串行化替换，在同一事务中删除旧事实、写入新事实并更新 header。
4. Registry / Graph 查询在 REPEATABLE READ 中按 repo 读取 facts 与对应 header。
5. freshness 仅在时间不超过 15 分钟且 revision/scanner provenance 合法时返回 `fresh`；其余状态返回稳定 `reason_code` 并标记 stale。

## 真实验收

```bash
set -euo pipefail
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs \
  sprints/08101613-universal-map-knife0/contract-dod.md
bash scripts/__tests__/run-all-scans.test.sh
bash scripts/__tests__/rescan-if-changed.test.sh
DATABASE_URL=postgresql://localhost/cecelia_scratch \
REPO_ROOT_CECELIA="$PWD" \
bash packages/brain/scripts/smoke/map-fact-snapshot-smoke.sh
```

## 未覆盖真实链路清单

生产库 migration/scanner 切换、ZenithJoy workspace 通用性验证，以及 Manifest、确定性 projection、统一 Map API 均属于后续 Knife；本合同不以占位实现替代。
