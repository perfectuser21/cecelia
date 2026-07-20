# Contract DoD: graph_edges 多仓库扫描扩展

TASK_ID: 85806b9a-ad3b-409e-8aba-74d232df7589
日期: 2026-07-20

---

## [BEHAVIOR] B-1：scan-graph.mjs REPOS 清单替代硬编码（覆盖 I-1 全量替换 + I-5 路径跳过）

**描述**：`scripts/scan/scan-graph.mjs` 不再含 `const REPO = 'cecelia'` 或单一 `const ROOT = path.resolve(...)` 硬编码；改为 REPOS 数组，含至少三个条目（cecelia / zenithjoy-workspace / zenithjoy-skills），每项支持环境变量覆盖。

**验收**：
```bash
# manual:bash
grep "const REPO = 'cecelia'" /workspace/scripts/scan/scan-graph.mjs
# 期望：无输出（grep 返回非 0）

grep "REPO_ROOT_CECELIA" /workspace/scripts/scan/scan-graph.mjs
# 期望：有输出（环境变量读取存在）

grep "zenithjoy-workspace" /workspace/scripts/scan/scan-graph.mjs
# 期望：有输出（三仓清单包含此项）

# DB 断言：执行扫描后三仓实际入库（防止代码存在但未执行入库）
node /workspace/scripts/scan/scan-graph.mjs
psql $DATABASE_URL -c "SELECT DISTINCT repo FROM graph_edges ORDER BY repo;"
# 期望：结果包含 cecelia、zenithjoy-workspace、zenithjoy-skills 三行
```

**测试文件**：`sprints/07200852-relay-85806b9a/tests/scan-graph-multi-repo.test.mjs`

---

## [BEHAVIOR] B-2：单仓路径不存在时 WARN 跳过，整轮不崩溃（I-2 + I-5）

**描述**：某仓 root 路径不存在时，打印 `WARN: repo=<name> 路径不存在，跳过` 后 continue，不 throw，其他仓正常扫描入库。整轮有跳过仓库时 exit 非 0。

**验收**：
```bash
# manual:bash
REPO_ROOT_ZJ_SKILLS=/nonexistent_path_xxx \
  REPO_ROOT_ZJ_WORKSPACE=/nonexistent_path_yyy \
  node /workspace/scripts/scan/scan-graph.mjs 2>&1 | grep "WARN:"
# 期望：至少两行 WARN 含路径不存在提示

# DB 不被误清空：cecelia 仍有边
psql $DATABASE_URL -c "SELECT count(*) FROM graph_edges WHERE repo='cecelia';"
# 期望：count > 0
```

**测试文件**：`sprints/07200852-relay-85806b9a/tests/scan-graph-multi-repo.test.mjs`（测试 path-not-exist 隔离逻辑）

---

## [BEHAVIOR] B-3：账龄哨兵按 repo 分别判龄，禁跨仓合并（I-3）

**描述**：每仓扫描完成后各自调 `computeFreshness`，查询 `SELECT max(scanned_at) FROM graph_edges WHERE repo = $name`，freshness 结果独立，不得跨仓取最大值。

**验收**：
```bash
# manual:bash：扫描完成后检查每仓 freshness 摘要
node /workspace/scripts/scan/scan-graph.mjs 2>&1 | grep -E "repo=.*stale="
# 期望：各 repo 各自一行，stale=false（扫描刚完成）
```

**测试文件**：`sprints/07200852-relay-85806b9a/tests/scan-graph-freshness.test.mjs`

---

## [BEHAVIOR] B-4：routes/graph.js 端点接受 repo query 参数，默认 cecelia（FR-4）

**描述**：`packages/brain/src/routes/graph.js` 删除 `const REPO = 'cecelia'` 常量，各路由从 `req.query.repo`（GET）或 `req.body.repo`（POST）读取 repo，`loadGraphContext(repo)` 接受 repo 参数并传入所有查询。不传 repo 时默认 cecelia，行为不变。

**验收**：
```bash
# manual:bash
grep "const REPO = 'cecelia'" /workspace/packages/brain/src/routes/graph.js
# 期望：无输出

curl -s "localhost:5221/api/brain/graph/locate?q=brain&repo=cecelia" | jq '.freshness | .stale'
# 期望：false

curl -s "localhost:5221/api/brain/graph/locate?q=brain" | jq '.freshness | .stale'
# 期望：false（向后兼容默认值）
```

**测试文件**：`sprints/07200852-relay-85806b9a/tests/graph-route-repo-param.test.mjs`

---

## [ARTIFACT] A-1：TDD Red 测试文件（合同测试，实现前必须失败）

| 文件 | 覆盖范围 |
|------|---------|
| `sprints/07200852-relay-85806b9a/tests/scan-graph-multi-repo.test.mjs` | REPOS 清单、路径不存在隔离、全量替换语义（真实 PG 连接） |
| `sprints/07200852-relay-85806b9a/tests/scan-graph-freshness.test.mjs` | per-repo freshness 独立性、禁跨仓合并 |
| `sprints/07200852-relay-85806b9a/tests/graph-route-repo-param.test.mjs` | loadGraphContext(repo) 参数传递、默认值向后兼容 |

---

## [ARTIFACT] A-2：改动文件清单

| 文件 | 变更类型 |
|------|---------|
| `scripts/scan/scan-graph.mjs` | 重构：REPOS 多仓循环 + 失败隔离 + per-repo freshness |
| `packages/brain/src/routes/graph.js` | 修改：删 const REPO，loadGraphContext(repo)，各路由读 query param |

---

## [ARTIFACT] A-3：E2E 最终验收命令汇总（手动执行）

```bash
# Step 1：确认 migration 351 存在（schema 版本锚，I-4/I-7）
psql $DATABASE_URL -c "SELECT version FROM schema_migrations WHERE version='351';"

# Step 2：全量扫描
node /workspace/scripts/scan/scan-graph.mjs

# Step 3：三仓断言
psql $DATABASE_URL -c "SELECT repo, count(*) FROM graph_edges GROUP BY repo ORDER BY repo;"
# 期望：≥3 行，各 count>0

# Step 4：单仓路径故意配错
REPO_ROOT_ZJ_SKILLS=/nonexistent node /workspace/scripts/scan/scan-graph.mjs 2>&1 | tee /tmp/scan-test.log
grep "WARN: repo=zenithjoy-skills" /tmp/scan-test.log && echo "PASS: WARN 告警存在"
grep "ERROR" /tmp/scan-test.log || echo "INFO: 无 ERROR（仅 WARN）"
psql $DATABASE_URL -c "SELECT count(*) FROM graph_edges WHERE repo='cecelia';" | grep -v "^$\|^-\|count" | awk '{if($1>0) print "PASS: cecelia 仍有边"; else print "FAIL"}'

# Step 5：API 端点验收
curl -sf "localhost:5221/api/brain/graph/locate?q=src&repo=cecelia" | jq '.freshness.stale'
```

---

## [BEHAVIOR] B-5：run-all-scans.sh 调用链不变（I-6 铁律对应）

**描述**：`scripts/run-all-scans.sh` 中调用 `scan-graph.mjs` 的方式保持不变（`node scripts/scan/scan-graph.mjs`），本次多仓扩展只修改 scan-graph.mjs 内部实现，不修改 run-all-scans.sh。

**验收**：
```bash
# manual:bash
grep "scan-graph.mjs" /workspace/scripts/run-all-scans.sh
# 期望：有输出（调用链仍存在）
```

**测试文件**：无需专属测试文件，A-3 Step 3 确认 run-all-scans.sh 可正常触发扫描。

---

## 满足条件汇总（全通过才算 DoD 完成）

- [ ] B-1：REPOS 清单存在，三仓覆盖，环境变量支持；psql 确认三仓实际入库
- [ ] B-2：路径不存在时 WARN 跳过，其余仓正常入库，exit 非 0
- [ ] B-3：per-repo freshness 独立，日志含各仓 stale 状态
- [ ] B-4：graph 路由接受 repo 参数，默认 cecelia 向后兼容
- [ ] B-5：run-all-scans.sh 调用链不变，grep 确认 scan-graph.mjs 仍被调用
- [ ] A-1：三个测试文件存在且在实现前 RED（失败）
- [ ] A-2：只改上述两个文件，不改 run-all-scans.sh
- [ ] A-3：E2E 手动验收全通过（含真实 psql 查询结果）
