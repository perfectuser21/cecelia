# 小改动 PrepPRD:刀A2 索引服务五查询端点

## 改什么
1. packages/brain/src/lib/graph-query.js:纯函数——buildAdjacency(边→正反邻接表)/reachable(BFS,深度上限)/matchAnchor(锚点路径↔图节点后缀匹配)/classifyFeatureAnchors(三态:covered/uncovered/unanchored)
2. packages/brain/src/routes/graph.js 五端点,挂 /api/brain/graph:
   - GET /locate?q= → journey_features 名称匹配 + 图节点路径匹配,带锚点三态与 journey/step(promise) 上下文
   - GET /related?path= → 图上正反邻边 + 直接锚定该路径的 features + 同 step 兄弟 features
   - POST /radius {files} → 反向 BFS 可达集 → 受影响测试(路径含 __tests__/.test.)+ 受影响 features→steps.promise→journeys
   - POST /island-check {files} → 每文件裁决:claimed(锚点可达)/connected_unclaimed(有边无主)/isolated(零边)
   - GET /claim-status?path= → 单文件 claimed/claimed_by
3. 每响应带 computeFreshness(graph_edges max scanned_at)+ anchor_coverage {total_features, anchored, covered_by_graph}
4. server.js 挂载 + smoke(离线 BFS + 活端点 shape 断言,空库安全)+ allowlist;brain 1.267.6

## 为什么改
索引服务价值兑现层:AI 开工问路(locate/related)、PR 波及点名(radius)、认领制机械判据(island-check/claim-status)。数据全齐:graph_edges 4048 边+照相层三表+journey_features 锚点雏形(utp=5/wf=27/gr=0)。

## 关键事实(今日实测)
- 锚点值大多是 zenithjoy-workspace 路径(publishers/services/agent 族),本仓图罩不住→端点必须诚实三态,covered_by_graph 会很小,这是刀C(锚点回填)+二仓扫描的动机而非缺陷
- journey_step_links 仅 22 行有 feature_id(8 个 feature)→兄弟查询数据稀疏,照实返回
- 零 LLM 零新表零 migration;边 4048 行,每请求全量载入内存 BFS(毫秒级),v1 不做缓存

## 影响范围
- 纯新增(1 lib + 1 router + server.js 一行挂载),现有行为零变化
- **禁止 integration 测试往 journey_features 插行**(该表有 Notion 自动 push 副作用!)——锚点逻辑用 fixture 行走单测,DB 集成只用 itest repo 的 graph_edges

## 验收标准
- [ ] 单测:BFS 正反向/深度上限/环安全;matchAnchor 后缀双向匹配;三态分类
- [ ] 路由单测(mock pool):五端点 shape+行为;radius 对 fixture 边返回正确受影响集
- [ ] integration(真库):itest repo 边插入→radius/claim-status 真查;不碰 journey_features
- [ ] 真机验收:对生产图查 radius {files:[packages/brain/src/executor.js]} 返回非空可达集与受影响测试;claim-status 对 CRM 表底座锚点文件(blast-radius.integration.test.js)返回 claimed
- [ ] smoke 进 allowlist;CI 全绿
