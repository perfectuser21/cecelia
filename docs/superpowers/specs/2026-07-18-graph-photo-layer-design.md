# 设计:刀A1 总关系图进照相层——graph_edges 表 + scan-graph 扫描器

> 2026-07-18 | 任务 1fdfd27d | 信息逻辑重建刀A 第一片(数据层;五查询端点留刀A2)
> 前提:刀0 已上线(照相层三表+账龄哨兵+run-all-scans+cron,PR #4082);dependency-cruiser 17.4.3 对本仓准确性已验证(零漏读,抓得到函数体内 await import())

## 目标

把"谁连谁"变成照相层的第四张照片:一张 graph_edges 表,每日由 scan-graph 扫描器全量重拍,承载三类边(import/spawn/http),复用刀0 的 scanned_at/哨兵/cron 基建。

## 非目标

- 不做查询端点(locate/related/radius/island-check/claim-status = 刀A2)
- 不扫 zenithjoy-workspace(repo 字段留好扩展位,加第二仓是后续小刀)
- 不抽 cron/DB-派发边(cron 定义在 packages/brain/src/cron/ 已被 import 边覆盖;task_type→executor 派发边等引导员刀把路由声明化后再抽)
- 不动任何现有 API/路由行为

## 设计

### 1. migration 351_graph_edges.sql

```sql
CREATE TABLE IF NOT EXISTS graph_edges (
  id bigserial PRIMARY KEY,
  repo varchar(100) NOT NULL DEFAULT 'cecelia',
  src_path text NOT NULL,          -- repo 相对路径(边的出发文件)
  dst_path text NOT NULL,          -- import/spawn(脚本): repo 相对路径;spawn(外部命令): 'cmd:<name>';http: URL 路径名(如 /api/brain/tasks)
  edge_type varchar(20) NOT NULL CHECK (edge_type IN ('import', 'spawn', 'http')),
  detail jsonb NOT NULL DEFAULT '{}',   -- {line, via} 等
  scanned_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_src ON graph_edges(repo, src_path);
CREATE INDEX IF NOT EXISTS idx_graph_edges_dst ON graph_edges(repo, dst_path);
CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(edge_type);
```

- schema 版本锚 **五处必须同 commit 全改 '351'**(Research 审查确认,LEARNINGS 反复踩的机械漏项):
  1. `packages/brain/src/selfcheck.js:28` EXPECTED_SCHEMA_VERSION
  2. `packages/brain/src/__tests__/selfcheck.test.js:198` 的 `toBe('350')`
  3. `packages/brain/src/__tests__/learnings-vectorize.test.js:460` 的 `toBe('350')`
  4. `DEFINITION.md:519`(Schema 版本: 350)
  5. `DEFINITION.md:886`(当前 '350')
  - 注:desire-system.test.js 已豁免(只验数字串),**别多改**
- **本地验 migration 一律 DB_NAME=cecelia_scratch(死规矩);CI 的 brain-integration 自动 migrate cecelia_test**

### 2. 纯抽取器 packages/brain/src/lib/graph-extract.js(ESM,零 IO,可单测)

- `extractSpawnEdges(content, srcPath)` → 边数组:
  - 匹配 `spawn(`/`exec(`/`execFile(`/`execSync(` 且首参为字符串字面量
  - 首参命令词:含 `/` 且以 .sh/.js/.mjs/.cjs/.py 结尾 → dst=该路径(去开头 ./);否则 dst=`cmd:<命令词>`
  - 同一调用行内其余字面量参数里出现的 .sh/.js/.mjs/.py 相对路径 → 追加一条 spawn 边(bash xxx.sh 场景)
  - detail: `{ line, via: 'spawn'|'execSync'|... }`
- `extractHttpEdges(content, srcPath)` → 边数组:
  - 匹配字面量里的 `localhost:5221/api/...`、`127.0.0.1:5221/api/...` 或独立的 `/api/brain/...` 路径(引号内、以 /api/ 开头)
  - dst = URL 路径名(去 query/模板变量段:遇 `${`/`?` 截断,截断后仍以 /api/ 开头才收)
  - detail: `{ line }`
  - 说明:dst 存路径字符串,刀A2 查询层用它 JOIN api_registry(照相层已有 path→file_path)解析到目标文件——本刀不做解析
- 两个函数对无匹配内容返回 `[]`;不抛异常(坏行跳过)

### 3. scan-graph.mjs(scripts/scan/,IO 层)

- import 边:`import { cruise } from 'dependency-cruiser'`(程序化 API,root devDependency `^17`),扫 `packages/*/src、packages/brain/server.js、apps/api/src、apps/dashboard/src、scripts`,排除 node_modules;仅收 resolved 且落在 repo 内的边;detail `{ via: 'import', dynamic }`
- spawn/http 边:walk 同范围 .js/.mjs/.cjs/.ts 文件,逐文件调两个抽取器
- **写入=按 repo 全量替换**:`BEGIN; DELETE FROM graph_edges WHERE repo=$1; 批量 INSERT; COMMIT`——边无自然键,upsert 会积死边(scan-api-registry 的已知缺陷不复制)
- 结束打印三类边计数;DB 连接同姊妹扫描器(`DATABASE_URL || postgresql://localhost/cecelia`)
- 测试文件(__tests__/*.test.*)**包含在扫描内**——"哪些测试 import 了文件 X"= 反向覆盖边,radius 查询的原料

### 4. 接线与守卫

- `run-all-scans.sh` 循环加 `scan-graph.mjs`(node 直跑,.mjs 与 .js 同样处理;循环里文件名带扩展名区分)
- 账龄哨兵:graph_edges 有 scanned_at,刀A2 的查询端点复用 computeFreshness;本刀 smoke 只验结构
- smoke `graph-photo-layer-smoke.sh`(CI 安全,不依赖 CI 里跑过扫描):
  - psql 验 graph_edges 表存在(迁移生效)
  - node -e 调 graph-extract 两个抽取器对内联 fixture 字符串出正确边(纯逻辑,离线)
  - 进 packages/quality/smoke-allowlist.txt

### 5. 版本

packages/brain 改动(lib/selfcheck/migration)→ brain 1.267.5,四处同步

## 测试策略(四档:unit + integration)

- unit:两个抽取器——spawn 字面量/cmd: 前缀/bash+脚本参数/多行内容/无匹配返回 [];http URL 路径截断(query、模板变量)、非 /api 忽略
- integration(CI 真库):351 表存在;插入两批同 repo 数据验证全量替换语义(第二批写入后第一批消失);连接走 db-config DB_DEFAULTS(死规矩)
- 真跑验收(本地,merge 前 Task 内):scan-graph 对本仓真跑,三类边入库,抽查 3 条已知边:
  1. import:`packages/brain/src/dispatcher.js → packages/brain/src/executor.js`
  2. spawn:executor.js 或 dispatcher 族 → `cmd:claude` / `cmd:bash` 任一
  3. http:任一文件 → `/api/brain/tasks` 前缀路径

## 实现注意

- scan-graph.mjs 是 ESM,跨包引 graph-extract.js 用**相对文件路径 import**(packages/brain type:module 已确认;注意 facts-check.mjs 是 readFileSync 读文本、不是 import 先例,别照抄错误类比);`import { cruise } from 'dependency-cruiser'` 从 scripts/scan/ 上溯 root node_modules 可解析
- 加 devDep 后必须 `npm audit` 确认无 critical(dep-audit-critical 闸全量查;runtime high 闸 --omit=dev 不受影响);root package-lock 必须重生成提交(CI 多处 root npm ci,不同步即 EUSAGE)
- 单测必须落 `packages/brain/src/lib/__tests__/graph-extract.test.js` 且 import 被测模块名(lint-test-pairing 闸判据)
- dependency-cruiser 加 root package.json devDependencies 并提交 root package-lock(注意 lock 两处陷阱记忆)
- 真跑会写本地生产 cecelia 库的 graph_edges——这正是目的(照片就是给生产 Brain 用的),但**必须先在 cecelia_scratch 跑过 migration 351**再对生产库 migrate
- 合并后手动步骤:生产 cecelia 跑 migrate(否则 selfcheck 351 锚报警)→ 真跑 scan-graph 灌图 → cron 无需改(run-all-scans 已含)

## 影响范围

- 纯新增(表/脚本/lib),现有行为零变化;run-all-scans.sh 加一行
- 风险点:root package-lock 更新(dependency-cruiser 及其依赖树);CI install 时长小幅增加
