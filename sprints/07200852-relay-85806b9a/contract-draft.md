# Contract Draft: graph_edges 多仓库扫描扩展

TASK_ID: 85806b9a-ad3b-409e-8aba-74d232df7589
SPRINT_DIR: sprints/07200852-relay-85806b9a
版本: v1.0
日期: 2026-07-20

---

## 一、合同范围（Golden Path）

### GP-1 scan-graph.mjs 多仓配置化

**当前状态**：`scripts/scan/scan-graph.mjs` 第 13-14 行硬编码 `ROOT` 和 `REPO='cecelia'`，仅能扫描单一仓库。

**变更后行为**：
- 删除 `const REPO = 'cecelia'` 和 `const ROOT = path.resolve(...)` 硬编码
- 改为 REPOS 清单，至少含三仓：
  ```js
  const REPOS = [
    { name: 'cecelia',               root: process.env.REPO_ROOT_CECELIA       || '/Users/administrator/perfect21/cecelia' },
    { name: 'zenithjoy-workspace',   root: process.env.REPO_ROOT_ZJ_WORKSPACE  || '/Users/administrator/perfect21/zenithjoy-workspace' },
    { name: 'zenithjoy-skills',      root: process.env.REPO_ROOT_ZJ_SKILLS     || '/Users/administrator/perfect21/zenithjoy-skills' },
  ];
  ```
- 每个 repo 优先读对应环境变量，变量名规则：`REPO_ROOT_<UPPER_NAME>`（`-` 替换为 `_`）

### GP-2 每仓独立扫描循环（I-1 全量替换 + I-2 失败隔离）

**循环结构**：
```
for repo of REPOS:
  1. fs.existsSync(repo.root) → false → WARN + continue（I-5）
  2. process.chdir(repo.root)
  3. dependency-cruiser → import 边
  4. walk + extractSpawnEdges + extractHttpEdges
  5. 去重
  6. replaceRepoEdges(pool, repo.name, deduped)  ← BEGIN;DELETE;INSERT;COMMIT（I-1）
  7. computeFreshness 取 max(scanned_at) WHERE repo=repo.name（I-3）
  8. 打印 per-repo 摘要
```

**失败隔离（I-2）**：步骤 2-7 被 try/catch 包裹：
- catch → 打印 `ERROR: repo=<name> 扫描失败: <msg>`，continue（不 re-throw）
- 该仓库不执行 DELETE，其他仓库不受影响
- 有任何仓库失败（含路径不存在告警）→ 整体 exit 1；全成功 exit 0

### GP-3 账龄哨兵按 repo 分别判龄（I-3）

- 每仓扫描成功后单独调 `computeFreshness(latestScanAt)`
- `latestScanAt` 来源：`SELECT max(scanned_at) FROM graph_edges WHERE repo = $name`
- 禁止跨仓合并取 max——合并会让活跃仓掩盖 stale 仓
- 打印每仓 freshness 摘要：`repo=<name> stale=false age_hours=0.0`

### GP-4 routes/graph.js 端点接受 repo 参数（FR-4）

**变更**：
- 删除 `const REPO = 'cecelia'` 常量
- `loadGraphContext()` 改为 `loadGraphContext(repo = 'cecelia')`
- 所有 `WHERE repo = $1` 查询使用传入的 `repo` 参数
- 各路由从 `req.query.repo || 'cecelia'`（GET）或 `req.body.repo || 'cecelia'`（POST）读取 repo
- 不传 repo 时默认 cecelia，行为向后兼容

**受影响端点**：`/locate`、`/related`、`/claim-status`、`/radius`、`/island-check`、`/anchor-coverage`

### GP-5 run-all-scans.sh 调用链不变（I-6）

- `run-all-scans.sh` 调用方式 `node scripts/scan/scan-graph.mjs` 保持不变
- 新增 repo 只需修改 scan-graph.mjs 内部 REPOS 清单，cron 不需改

---

## 二、铁律（Invariants）覆盖验证

| 铁律 | 覆盖方式 |
|------|---------|
| I-1 禁 upsert，全量替换 | `replaceRepoEdges` 已实现 BEGIN;DELETE;INSERT;COMMIT，多仓扩展不改此函数 |
| I-2 单仓失败不污染其他仓 | try/catch 包裹每仓 2-7 步，catch 时 continue，不执行 DELETE |
| I-3 账龄哨兵按 repo 分别判龄 | 每仓独立 `SELECT max(scanned_at) WHERE repo=$name` → computeFreshness |
| I-4 本地验 migration 用 cecelia_scratch | 本 sprint 无新 migration（351 已存在），确认无需改 |
| I-5 路径不存在跳过告警不炸 | `fs.existsSync` 检测 → WARN + continue |
| I-6 run-all-scans.sh 调用链不变 | 脚本内部参数化，外部调用不变 |
| I-7 schema 版本锚五处同 commit 全改 | 本 sprint 无新 migration，确认无需改版本锚 |

---

## E2E 验收（Final E2E，真实执行）

### E2E-1 三仓全量扫描验收

```bash
# 前置：确认 migration 351 已在 cecelia DB 存在
psql $DATABASE_URL -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 3;"

# 执行扫描（使用真实路径环境变量）
node /workspace/scripts/scan/scan-graph.mjs

# 验收断言 A：三仓均有边
psql $DATABASE_URL -c "SELECT repo, count(*) FROM graph_edges GROUP BY repo ORDER BY repo;"
# 期望：返回 ≥3 行，各行 count > 0
```

### E2E-2 账龄哨兵 per-repo

```bash
# 扫描刚完成，每仓 stale 应为 false
# 检查扫描器输出日志中包含各 repo 的 stale=false
node /workspace/scripts/scan/scan-graph.mjs 2>&1 | grep -E 'stale='
# 期望：cecelia stale=false, zenithjoy-workspace stale=false, zenithjoy-skills stale=false

# psql 时间戳断言：确认底层确实做了 per-repo 独立 SQL，cecelia 扫描时间在 5 分钟内
psql $DATABASE_URL -c "SELECT max(scanned_at) FROM graph_edges WHERE repo='cecelia';"
# 期望：返回时间戳距 now() 不超过 5 分钟（即 now() - max(scanned_at) < interval '5 minutes'）
psql $DATABASE_URL -c "SELECT (now() - max(scanned_at)) < interval '5 minutes' AS fresh FROM graph_edges WHERE repo='cecelia';"
# 期望：fresh = t
```

### E2E-3 单仓路径故意配错，其余正常

```bash
# 故意配错 zenithjoy-skills 路径
REPO_ROOT_ZJ_SKILLS=/nonexistent node /workspace/scripts/scan/scan-graph.mjs 2>&1
# 期望输出：包含 "WARN: repo=zenithjoy-skills 路径不存在，跳过"
# 期望输出：cecelia 和 zenithjoy-workspace 正常入库摘要行

# 强制断言退出码为 1（有跳过仓库时必须 exit 1，与 FR-2 一致）
REPO_ROOT_ZJ_SKILLS=/nonexistent node /workspace/scripts/scan/scan-graph.mjs; echo "exit=$?"
# 期望：exit=1

# DB 验证：cecelia 和 zenithjoy-workspace 仍有边
psql $DATABASE_URL -c "SELECT repo, count(*) FROM graph_edges WHERE repo IN ('cecelia','zenithjoy-workspace') GROUP BY repo;"
# 期望：两行均 count > 0
```

### E2E-4 API 端点 repo 参数验收

```bash
# GET 端点：默认行为（不传 repo，默认 cecelia）
curl -s "localhost:5221/api/brain/graph/locate?q=brain" | jq '.freshness.stale'
# 期望：false

# GET 端点：指定 repo 参数（各仓库均应返回正确数据）
curl -s "localhost:5221/api/brain/graph/locate?q=brain&repo=cecelia" | jq '.freshness'
# 期望：含 stale: false
curl -s "localhost:5221/api/brain/graph/locate?q=brain&repo=zenithjoy-workspace" | jq '.freshness'
# 期望：含 stale: false

# POST 端点：/radius 带 repo body 参数
curl -s -X POST "localhost:5221/api/brain/graph/radius" \
  -H "Content-Type: application/json" \
  -d '{"file":"packages/brain/src/server.js","depth":1,"repo":"cecelia"}' | jq '.repo // .freshness.stale'
# 期望：返回正常结果（不报 repo 参数错误，freshness.stale = false 或含 repo 字段）

# POST 端点：/radius 不传 repo，验证默认 cecelia 向后兼容
curl -s -X POST "localhost:5221/api/brain/graph/radius" \
  -H "Content-Type: application/json" \
  -d '{"file":"packages/brain/src/server.js","depth":1}' | jq '.freshness.stale // empty'
# 期望：false 或不报错
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 |
|---|---|---|
| graph.js 端点 repo 参数化 | `tests/regression/relay-85806b9a/graph-route-repo-param.test.mjs` | B-4, FR-4 |
| per-repo freshness 独立 | `tests/regression/relay-85806b9a/scan-graph-freshness.test.mjs` | B-3, I-3 |
| REPOS 多仓库清单导出 | `tests/regression/relay-85806b9a/scan-graph-multi-repo.test.mjs` | B-1, B-2, I-1, I-5 |

## 四、非目标（Out of Scope）

- 并行扫描（串行足够，NFR-1 允许 ≤3x 单仓时间）
- zenithjoy-workspace / zenithjoy-skills 仓库本身的任何代码修改
- graph_edges 表结构变更（351 已满足）
- 任何新 migration（本 sprint 明确无）
