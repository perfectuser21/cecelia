# Test Contract: Universal Map Projection Engine — Knife 0

**Task ID**: 2fb600e9-d733-4469-8804-ce20da17943c  
**Sprint**: `sprints/08101613-universal-map-knife0`  
**Target environment**: `local_db`（仅允许 `cecelia_test` / `*_scratch`）

---

## 范围

Knife 0 只交付通用 Map Projection Engine 的事实底座：cron-safe 扫描调度、版本化 repo 快照、原子替换、15 分钟 fail-closed freshness，以及按 repo 隔离的一致读取。Cecelia 是首个验收 repo；本 Knife 不交付 Manifest 解析、投影器或统一 Map API。

生产库不属于本合同的迁移目标。Migration 397 的真实数据库验收只在 `cecelia_test` 与 `cecelia_scratch` 执行。

## Test Contract

| Workstream | Test File / Command | Behavior |
|---|---|---|
| D1 | `scripts/__tests__/run-all-scans.test.sh` | sanitized PATH 下聚合四 scanner；单项失败仍执行其余项并最终非零；无效 repo root fail-fast |
| D2 | `scripts/__tests__/rescan-if-changed.test.sh` | 仅在 HEAD 变化时扫描；成功后记 SHA；失败保留旧 SHA |
| D3 | `packages/brain/src/__tests__/integration/fact-snapshot-store.integration.test.js` | api/db/test 快照持久化 repo、revision、scanner version、scanned_at 与 header |
| D3 | `packages/brain/src/__tests__/integration/graph-store.integration.test.js` | graph 快照与 header 使用同一 provenance |
| D3 | `packages/brain/src/__tests__/migration-397-fact-snapshot.test.js` | migration 397 幂等、遗留 Cecelia ownership 回填、repo 唯一性与 header schema |
| D4 | `packages/brain/src/lib/__tests__/fact-snapshot-store.test.js` | 消失事实删除、失败回滚、持久化事实数写入 header |
| D4 | `packages/brain/src/lib/__tests__/graph-store.test.js` | graph 原子替换、同 repo advisory lock 与空快照 header |
| D4 | `packages/brain/src/lib/__tests__/consistent-read.test.js` | facts 与 header 在只读 REPEATABLE READ 中一致读取 |
| D5 | `packages/brain/src/lib/__tests__/registry-freshness.test.js` | 15 分钟边界；缺失、陈旧、未来时间与非法 provenance 均 fail-closed |
| D5-D6 | `packages/brain/src/lib/__tests__/registry-photo-layer.test.js` | registry facts/header 按 repo 隔离并传播 freshness |
| D5-D6 | `packages/brain/src/routes/__tests__/graph.test.js` | graph 路由按 repo 读取同一 snapshot header 并传播 freshness |
| D6 | `tests/regression/relay-85806b9a/scan-graph-freshness.test.mjs` | 另一 repo 的新快照不能掩盖目标 repo 的陈旧状态 |
| D6 | `tests/regression/relay-85806b9a/graph-route-repo-param.test.mjs` | graph endpoints 统一尊重 repo 参数 |
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

# DevGate 与合同映射
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs \
  sprints/08101613-universal-map-knife0/contract-dod.md

# runner / revision 调度
bash scripts/__tests__/run-all-scans.test.sh
bash scripts/__tests__/rescan-if-changed.test.sh

# scratch 真验火（脚本自身执行四 scanner；拒绝生产库名）
DATABASE_URL=postgresql://localhost/cecelia_scratch \
REPO_ROOT_CECELIA="$PWD" \
bash packages/brain/scripts/smoke/map-fact-snapshot-smoke.sh
```

## 判定点

| ID | 断言 | 失败表现 |
|---|---|---|
| J-01 | 四 scanner 在 sanitized PATH 下均被调用 | runner 测试缺调用或退出码错误 |
| J-02 | 四类 header 的 revision 等于当前 Cecelia HEAD | smoke 报 revision mismatch |
| J-03 | 每类 header `row_count` 等于该 repo 实际事实数 | smoke 报 header/fact count mismatch |
| J-04 | 同 repo 并发替换结果不是输入并集 | 双连接集成测试失败 |
| J-05 | 16 分钟快照为 `unknown/snapshot_stale/stale=true` | freshness 仍返回 fresh |
| J-06 | 重扫后 freshness 恢复为 `fresh` | smoke 重扫恢复失败 |
| J-07 | smoke 的临时 facts/header 均清零 | smoke cleanup 计数非零 |
| J-08 | production schema 未被迁移 | 验收范围违反数据库 guard |

## 未覆盖真实链路清单

- 生产库 migration 与生产 scanner 切换：不在 Knife 0 PR 的授权范围内；合并后的部署 Knife 另行执行并记录生产验收。
- ZenithJoy workspace：属于后续通用性验证 Knife；Knife 0 只保留通用 repo 数据契约与显式 repo 选择能力。
- Manifest、确定性 projection 与统一 Map API：分别属于后续 Knife，本合同不以占位实现替代。
