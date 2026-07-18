# 设计:刀A2 索引服务五查询端点——/api/brain/graph

> 2026-07-18 | 任务 972402fb | 信息逻辑重建刀A 第二片(价值兑现层)
> 前提:刀A1 已上线(graph_edges 生产 4048 边:import 2972/http 864/spawn 212,每日 cron 重拍,PR #4085)

## 目标

把总关系图变成 AI 可查询的导航+执法服务:开工问路(locate/related)、PR 波及点名(radius)、认领制机械判据(island-check/claim-status)。零 LLM,纯机械,每响应带账龄与锚点覆盖率。

## 非目标

- 不做锚点回填(刀C:先两个 seed 域)、不扫 zenithjoy-workspace 二仓
- 不接进 proposer/dev/引用重跑闸(刀B 的事,本刀只立端点)
- 不做 Dashboard 可视化;不做缓存(4048 边每请求内存 BFS 毫秒级)
- 不新增表、无 migration

## 关键现实(设计必须诚实容纳)

- journey_features 174 行,锚点雏形字段:unit_test_path=5 / workflow_ref=27 / guard_ref=0
- **锚点值大多是 zenithjoy-workspace 路径**(publishers/... services/agent/... apps/api/...),本仓图罩不住 → 锚点三态:`covered`(图中有匹配节点)/`uncovered`(有锚但图未覆盖,待二仓)/`unanchored`
- journey_step_links 仅 22 行带 feature_id → 兄弟/promise 关联稀疏,照实返回
- **铁律:测试禁止写 journey_features**(该表被 notion-push-sync 每 5 分钟自动推送,插测试行会污染 Notion)

## 设计

### 1. 纯函数层 packages/brain/src/lib/graph-query.js(零 IO,DI)

```
buildAdjacency(edges) → { fwd: Map<src, Array<{dst, edge_type}>>, rev: Map<dst, Array<{src, edge_type}>> }
reachable(adj, startPaths, { dir: 'fwd'|'rev', maxDepth = 10 }) → Set<path>   // BFS,含起点,环安全
matchAnchor(anchorPath, nodePathsSet) → string|null
  // 归一化(去开头 ./ 与多余斜杠)后:精确命中,否则后缀双向匹配
  // (node.endsWith('/'+anchor) || anchor.endsWith('/'+node)),取最长命中;歧义(多命中同长)取字典序第一并标 ambiguous
classifyFeatureAnchors(featureRows, nodePathsSet) →
  [{ feature_id, name, anchors: [{field, path, matched_node|null}], status: 'covered'|'uncovered'|'unanchored' }]
  // anchors 取 unit_test_path/workflow_ref/guard_ref 非空值;任一 matched → covered;有锚全不匹 → uncovered;无锚 → unanchored
isTestPath(path) → bool   // 含 __tests__/ 或 .test. 或 .spec. 或 tests/ 段
```

### 2. 路由层 packages/brain/src/routes/graph.js,server.js 挂 `app.use('/api/brain/graph', graphRoutes)`

公共装配(每请求):`loadGraphContext(pool)` →
- edges:`SELECT src_path, dst_path, edge_type FROM graph_edges WHERE repo='cecelia'`
- freshness:`SELECT max(scanned_at) AS latest FROM graph_edges WHERE repo='cecelia'` → computeFreshness(复用刀0 lib)
- features:`SELECT id, name, unit_test_path, workflow_ref, guard_ref FROM journey_features`
- anchor_coverage:{ total_features, anchored, covered_by_graph }(由 classifyFeatureAnchors 聚合)

五端点:

| 端点 | 输入 | 逻辑 | 输出核心 |
|---|---|---|---|
| GET /locate | q(必填), limit=20 | features.name ILIKE %q%(SQL 侧)+ 图节点 path 含 q(JS 侧过滤) | { features:[classifyFeatureAnchors 子集+journey/step 上下文], files:[path], freshness, anchor_coverage } |
| GET /related | path(必填), depth=1 | 归一化 path;fwd/rev 邻边(depth 层);直接锚定该 path 的 features(matchAnchor 反查);这些 features 经 journey_step_links 找同 step 兄弟 | { path, dependencies:[{path,edge_type}], dependents:[...], claimed_by:[features], step_siblings:[features], freshness } |
| POST /radius | { files:[], max_depth=10 } | rev BFS 从 files → reached;affected_tests = reached ∩ isTestPath;anchors matched_node ∈ reached(或 ∈ files)→ affected_features → LEFT JOIN journey_step_links→journey_steps(promise)→journeys | { input_files, reached_count, affected_tests, affected_features:[{id,name,anchors,promises:[{step_name,promise,journey_name}]}], uncovered_anchor_features(计数,诚实项), freshness } |
| POST /island-check | { files:[] } | 每文件:in_graph(是任一边端点)?claimed(∈ 任一 covered 锚点的 fwd∪rev 可达集,或自身即 matched_node)? | { results:[{file, verdict:'claimed'\|'connected_unclaimed'\|'isolated', claimed_by:[feature names]}], freshness, anchor_coverage } |
| GET /claim-status | path(必填) | 同 island-check 单文件 | { path, claimed, claimed_by:[...], verdict, freshness } |

- locate 的 journey/step 上下文:`journey_step_links l JOIN journey_steps s ON s.id=l.step_id JOIN journeys j ON j.id=s.journey_id WHERE l.feature_id = ANY($1)`,LEFT 语义(没有格子就空数组)
- radius 语义注意:reverse BFS 的方向 = "谁(直接/传递)依赖这些文件"——rev 邻接表从 dst 找 src
- 输入校验:q/path 缺失 400;files 非数组或空 400;max_depth clamp [1,20]
- 错误:500 带 error message(照 registry.js 惯例)

### 3. smoke packages/brain/scripts/smoke/graph-query-api-smoke.sh

- [1] 离线:node --input-type=module 调 graph-query 的 buildAdjacency+reachable 对 fixture 边出正确可达集(纯逻辑)
- [2] 活端点 shape(空库安全):curl BRAIN_URL /api/brain/graph/claim-status?path=nonexistent.js → JSON 含 claimed:false 与 freshness 字段
- 框架照 graph-photo-layer-smoke.sh(静态/离线优先);进 packages/quality/smoke-allowlist.txt

### 4. 版本

packages/brain 改动 → 1.267.6(无 migration,schema 锚不动)

## 测试策略(unit + route mock + integration)

- unit(lib/__tests__/graph-query.test.js):邻接表构建;BFS 正/反向、深度上限、环(a→b→a)安全终止;matchAnchor 精确/后缀双向/歧义/不匹配;classify 三态;isTestPath
- route(routes/__tests__/graph.test.js,mock db.js pool + supertest):五端点 shape、400 校验、radius 对 fixture 边(a→b→c,test 文件 t 依赖 b)返回 affected_tests=[t];claim-status 对 mock 锚点 covered 场景 claimed:true
- integration(src/__tests__/integration/graph-query.integration.test.js,DB_DEFAULTS):插 itest-graph-repo… **注意 loadGraphContext 只查 repo='cecelia'** → integration 直接插 repo='cecelia' 的 itest 前缀边(src/dst 带 itest-gq/ 前缀,afterAll 按前缀删,不碰真实边)+ 调 lib 函数与真实 SQL;**不写 journey_features**
- 真机验收(Task 内,对生产):radius {files:[packages/brain/src/executor.js]} reached_count>0 且 affected_tests 非空;claim-status?path=packages/brain/src/__tests__/integration/blast-radius.integration.test.js → claimed:true(CRM 表底座锚点,唯一本仓 covered 种子)

## 实现注意

- lint-test-pairing:graph-query.js 与 graph.js 各配同目录 __tests__ 同名 test
- 挂载行插在 server.js 现有 app.use('/api/brain/...') 区块(250 行附近),import 区加一行
- 真机验收在本地起…**不起新 Brain 实例**(死规矩)——验收走生产 5221(Gate3 部署后)或 route 单测/integration 覆盖,merge 前真机项凭 integration+单测,merge 后对生产 curl 终验
- graph_edges 空(未扫)时所有端点返回空结果+freshness.stale=true,不抛错(CI smoke 依赖此行为)
