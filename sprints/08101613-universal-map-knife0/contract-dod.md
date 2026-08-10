# Universal Map Knife 0 — Definition of Done

### [BEHAVIOR] D1：sanitized PATH runner 聚合四 scanner

- [x] sanitized cron PATH 下四 scanner 全部执行，单个失败仍继续并最终退出非零。
Test: manual:bash -c "bash scripts/__tests__/run-all-scans.test.sh"

Evidence: `PASS=9 FAIL=0`，含默认四 scanner 全调用、失败后继续聚合、禁止 pull 与无效 repo root fail-fast。

### [BEHAVIOR] D2：main SHA 变化触发扫描

- [x] SHA 变化才触发扫描；成功才记 SHA，失败保持旧 SHA。
Test: manual:bash -c "bash scripts/__tests__/rescan-if-changed.test.sh"

Evidence: `PASS=4 FAIL=0`，覆盖未变化、成功记账与失败不记账。

### [BEHAVIOR] D3：四类事实携带版本化 provenance

- [x] api/db/test/graph 每条新快照携带 repo、source_revision、scanner_version、scanned_at。
Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/integration/fact-snapshot-store.integration.test.js src/__tests__/migration-397-fact-snapshot.test.js"

Evidence: Knife 0 相关 12 files `116/116 passed`；scratch 四类 facts provenance 异常数为 0。

### [BEHAVIOR] D4：事实快照原子替换

- [x] 消失事实删除，写入失败保留上一快照，同 repo 并发替换不产生并集。
Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/fact-snapshot-store.test.js src/__tests__/integration/fact-snapshot-store.integration.test.js src/lib/__tests__/graph-store.test.js"

Evidence: 单元/双连接集成全绿；scratch `/gone` 重拍后消失且 header `row_count=1`。

### [BEHAVIOR] D5：freshness 超预算 fail-closed

- [x] snapshot 超过 15 分钟、revision 缺失或时间无效时 API 为 unknown，不返回 fresh。
Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/registry-freshness.test.js src/lib/__tests__/registry-photo-layer.test.js src/routes/__tests__/registry-photo-layer.test.js src/routes/__tests__/graph.test.js"

Evidence: scratch header 推至 16min 后为 `unknown/snapshot_stale/stale=true`，重扫恢复 `fresh`。

### [BEHAVIOR] D6：repo freshness 隔离

- [x] 同仓 repo filter 生效，另一仓新鲜快照不能掩盖目标仓陈旧。
Test: manual:bash -c "npx vitest run tests/regression/relay-85806b9a/scan-graph-freshness.test.mjs && cd packages/brain && npx vitest run src/__tests__/integration/registry-photo-layer.integration.test.js"

Evidence: graph freshness `7/7 passed`；registry 双 repo/一致性真库回归 `5/5 passed`。

### [ARTIFACT] D7：版本与 schema 同步

- [x] Brain 版本、schema floor、DEFINITION 和 migration 397 同步。
Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh"

Evidence: Brain `1.271.4`、schema floor/migration `397`，版本同步检查通过。

### [BEHAVIOR] D8：scratch 四 scanner 与 stale 恢复真验火

- [x] scratch 完成四 scanner 重拍，revision 等于当前 HEAD，freshness stale 演习可红可恢复。
Test: manual:bash -c "DATABASE_URL=postgresql://localhost/cecelia_scratch REPO_ROOT_CECELIA=$PWD bash packages/brain/scripts/smoke/map-fact-snapshot-smoke.sh"

Evidence: 四 header 均匹配 HEAD；row_count=`api 763/db 226/test 1695/graph 4926` 且逐表等于事实数；stale→重扫恢复一键 `ALL PASS`。
