# Sprint PRD: graph_edges 多仓库扫描扩展（接刀A1）

TASK_ID: 85806b9a-ad3b-409e-8aba-74d232df7589
SPRINT_DIR: sprints/07200852-relay-85806b9a
日期: 2026-07-20

---

## Invariant 约束

**I-1 禁 upsert，必须按 repo 全量替换**
`graph-store.js:replaceRepoEdges` 的 `BEGIN; DELETE WHERE repo=$1; 批量 INSERT; COMMIT` 模式不可改为 upsert——边无自然键，upsert 会积死边（scan-api-registry 已知缺陷，不在此复制）。本次多仓扩展严格继承此约束。

**I-2 单仓失败不得污染其他仓库的边**
多仓扫描循环中，某一仓库扫描抛错时必须 catch 隔离：该仓库 rollback/跳过，不执行 DELETE，不影响其余仓库已入库的 edges。其余仓库正常全量替换。

**I-3 账龄哨兵按 repo 分别判龄**
`computeFreshness` 调用必须按 repo 各自取 `max(scanned_at) WHERE repo=$repo`，不得跨仓合并取最大值——合并会让一个仓库掩盖另一个仓库的 stale。`loadGraphContext` 扩展后须携带 per-repo freshness 或接受 repo 参数。

**I-4 本地验 migration 一律使用 DB_NAME=cecelia_scratch（照相层死规矩）**
spec `2026-07-18-graph-photo-layer-design.md §实现注意` 明确：本地验 migration 只对 cecelia_scratch，生产 cecelia 在 merge 后手动 migrate。CI 的 brain-integration 自动对 cecelia_test。此规矩在本刀保持不变。

**I-5 仓库路径不存在时跳过并告警，不炸整轮**
repo 配置中某仓库本地 checkout 路径不存在时，输出 `WARN: repo=<name> 路径不存在，跳过` 并 continue，不 throw，不退出非零（该仓库不写 DB，其余仓库照常扫描入库）。

**I-6 run-all-scans.sh 每日调用链不变，新增 repo 自动进入每日刷新**
`run-all-scans.sh` 已含 `scan-graph.mjs`，本次改动后无需修改 run-all-scans.sh 的调用方式；新增 repo 只需加入扫描器内部的 repo 清单，cron 不变，下次自动扫到。

**I-7 schema 版本锚五处必须同 commit 全改（照相层历史规矩）**
任何 migration 变动需同步更新：selfcheck.js、selfcheck.test.js、learnings-vectorize.test.js、DEFINITION.md 两处。本 sprint 无新 migration（graph_edges 表已在刀A1 migration 351 建好），此约束仍须在验收时确认未漏改。

---

## 累积 FR

**FR-1 scan-graph.mjs 去掉 REPO/ROOT 硬编码，改为可配置多仓 repo 清单**
- 删除 `const REPO = 'cecelia'` 和 `const ROOT = path.resolve(...)` 硬编码
- 改为 repo 清单结构（至少含 cecelia / zenithjoy-workspace / zenithjoy-skills 三仓）：
  ```js
  // 优先读环境变量，否则用默认路径
  const REPOS = [
    { name: 'cecelia', root: process.env.REPO_ROOT_CECELIA || '<默认路径>' },
    { name: 'zenithjoy-workspace', root: process.env.REPO_ROOT_ZJ_WORKSPACE || '<默认路径>' },
    { name: 'zenithjoy-skills', root: process.env.REPO_ROOT_ZJ_SKILLS || '<默认路径>' },
  ];
  ```
- 仓库 root 路径支持从环境变量 `REPO_ROOT_<NAME>` 读取（`<NAME>` 大写+下划线转换）
- 路径不存在时：打印 WARN 告警，跳过该仓库，不退出

**FR-2 每仓独立扫描、独立写库、失败隔离**
- 外层 for-of 循环遍历 REPOS
- 每仓：
  1. 检查 root 路径存在性（`fs.existsSync`），不存在则 WARN + continue
  2. 运行 dependency-cruiser（`process.chdir(repoRoot)`）
  3. walk + extractSpawnEdges + extractHttpEdges
  4. 去重
  5. `replaceRepoEdges(pool, repo.name, deduped)`（全量替换）
  6. 打印 `repo=<name> import=N spawn=N http=N 入库=N`
- try/catch 包裹每仓的步骤 2-6：catch 时打印 `ERROR: repo=<name> 扫描失败: <err.message>`，continue（不 re-throw）
- 扫描结束后若有任何仓库失败，整体 exit 1；全成功 exit 0

**FR-3 账龄哨兵按 repo 分别报告新鲜度**
- `scan-graph.mjs` 扫描完成后，对每个成功入库的 repo 单独调 `computeFreshness`（查 `max(scanned_at) WHERE repo=$name`），打印 per-repo freshness 摘要
- `routes/graph.js` 的 `loadGraphContext()` 接受可选 `repo` 参数（默认 `'cecelia'`），`WHERE repo = $1` 已有，确认端点现有 repo 参数过滤正确（FR-4 单独验收）

**FR-4 GET /api/brain/graph/* 端点确认 repo 参数生效**
- `routes/graph.js` 中 `const REPO = 'cecelia'` 硬编码改为从 `req.query.repo || 'cecelia'` 读取
- `loadGraphContext(repo)` 接受 repo 参数，所有 pool.query 的 `WHERE repo = $1` 传入对应值
- 不传 repo 时默认 cecelia，行为不变（向后兼容）
- 受影响端点：`/locate`、`/related`、`/claim-status`、`/radius`、`/island-check`、`/anchor-coverage`

**FR-5 Final E2E 验收（真实执行）**
1. 真实执行一轮 `node scripts/scan/scan-graph.mjs`
2. psql 查：`SELECT repo, count(*) FROM graph_edges GROUP BY repo`，返回结果中 repo 行数 ≥ 3，且各 repo 的 count > 0
3. 账龄哨兵对每个 repo 各自报告 `stale: false`（扫描刚完成）
4. 故意配错一仓路径（如 `REPO_ROOT_ZJ_SKILLS=/nonexistent`），重跑扫描：
   - zenithjoy-skills 仓打印 WARN 并跳过
   - cecelia 和 zenithjoy-workspace 正常入库，DB 中这两个 repo 的 edges 存在
   - 进程退出码非零（有仓库失败/跳过告警）或按实现选择（至少打印 WARN）

---

## NFR

**NFR-1 性能**：多仓串行扫描，单仓扫描时间参考刀A1 cecelia 真跑基线（<60s）；多仓总时间 ≤ 3 倍单仓（允许串行叠加）。

**NFR-2 幂等性**：同一仓库连续执行两次扫描，第二次结束后 DB 中该 repo 的 edges 数量与第一次一致（全量替换语义保证）。

**NFR-3 无副作用**：仓库路径只读（fs.readFileSync / dependency-cruiser），不写入任何被扫描仓库的文件系统。

---

journey_type: feature
target_environment: local_api
