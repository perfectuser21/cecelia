# 小改动 PrepPRD:刀A1 总关系图进照相层

## 改什么
1. migration 351:graph_edges 表(repo/src_path/dst_path/edge_type[import|spawn|http]/detail jsonb/scanned_at)+ 三索引;selfcheck EXPECTED_SCHEMA_VERSION → '351'
2. packages/brain/src/lib/graph-extract.js:纯函数抽取器 extractSpawnEdges/extractHttpEdges(源码文本→边数组),配套单测
3. scripts/scan/scan-graph.mjs:import 边(dependency-cruiser 程序化 API,root devDependency)+ 调用两个抽取器扫全仓;**全量替换语义**(BEGIN;DELETE WHERE repo;INSERT;COMMIT——边无自然键,upsert 会积死边)
4. run-all-scans.sh 加第四扫描器;dependency-cruiser 入 root devDependencies
5. smoke(CI 安全:验表存在+抽取器对 fixture 出边,不依赖 CI 里跑过扫描)+ allowlist

## 为什么改
刀A 第一片:把"谁连谁"变成照相层第四张照片,复用刚上线的 scanned_at/哨兵/cron 基建。五查询端点(locate/related/radius/island-check/claim-status)留刀A2,有了这张表才有东西可查。

## 关联上下文
- 决策:2026-07-18 三条 architecture(照相层/账本层分离、认领制、索引服务)
- handoff:202607181440-dfb27642(next_steps 第一条)
- 已验证:dependency-cruiser 17.4.3 读本仓准确(07-18 上午验证,抽查零漏读、抓到 lazy import())

## 影响范围
- 新表+新脚本,不改任何现有 API/路由行为;run-all-scans.sh 加一行循环项
- packages/brain 改动(lib+selfcheck+migration)→ 版本 bump 1.267.5
- 合并后需对生产 cecelia 库跑 migrate(selfcheck 351 锚),再真跑一次 scan-graph 灌图

## 验收标准
- [ ] 单测:两个抽取器对 fixture 文本出正确边(spawn 字面量/cmd: 前缀/http URL 路径),边界(无匹配/多行)覆盖
- [ ] integration(CI 真库):migration 351 建表成功,插入+按 repo 全量替换语义验证
- [ ] 真跑 scan-graph.mjs:graph_edges 有 import/spawn/http 三类边,量级合理(import 边≈2700 上下),scanned_at=当天
- [ ] 抽查 3 条已知边存在:dispatcher.js→executor.js(import)、executor.js→cmd:claude 或 bash(spawn)、任一 skill/脚本→/api/brain/tasks(http)
- [ ] CI 全绿 + smoke 进 allowlist
