# CodeGraph (codegraph-ai/CodeGraph) 引入评估

评估对象：https://github.com/codegraph-ai/CodeGraph （Rust + RocksDB + VS Code 扩展，作者/商业主体 aStudioPlus）
评估方式：纯文档级（WebFetch/WebSearch 公开资料），未安装未运行。

---

## 结论先行

**建议：不用（本尊不引入，A/B 两个角色都不成立）。**

一句话理由：这是一个 40 星、solo 维护者的 open-core 项目，商业化重心（图数据比较有价值的 27 个 pro + 17 个 security 工具，如 coupling/dead-code/git-mining）刻意留在闭源付费层；免费层拿到手的东西反而薄。角色 B（符号级边源适配器）的前提"它的 SQLite"本身就是误判——它的持久层是 **RocksDB**，schema 不公开、无导出命令，做适配器等于逆向一个随时可能变的私有内部格式，维护成本极高。角色 A（MCP 省 token）宣传语境里流传的"57% fewer tokens / 94% fewer tool calls"之类的可信 benchmark，查证后属于**另一个同名但完全不同的项目** `colbymchenry/codegraph`（TS + SQLite + MIT + 6万+星），本尊自己的 README 里没有任何 token/context 节省的实测数据，只有索引速度（~60 files/sec）和查询延迟（sub-100ms）这类无关指标。综合供应链风险、能力边界、宣传可信度三项都不过关，且我们已有自研 scan-graph + 五端点 + CI 三闸覆盖同一诉求，边际收益不足以覆盖引入一个弱维护外部依赖的风险。

如果角色 A 的真实诉求（MCP 代码问答省 token）仍然成立，值得单独另开一轮评估的候选是 **`colbymchenry/codegraph`**（见下文竞品快评），但这是与本次指定评估对象不同的仓库，需要重新走一遍评估流程，不能顺带并入这次结论。

---

## 逐项证据

### 1. 成熟度与供应链

| 项 | 证据 |
|---|---|
| License | Apache-2.0（[LICENSE 引用](https://github.com/codegraph-ai/CodeGraph)），但配套的 CodeGraph Pro（`codegraph.astudioplus.com/pro`）为闭源付费产品 |
| 星标/Fork | 40 stars / 6 forks（[repo 主页](https://github.com/codegraph-ai/CodeGraph)） |
| 维护活跃度 | 143 commits；Releases 页面仅可见 1 个 tag（`model`, 2025-06-30 附近，另有 VSIX 版本号 0.19.1/0.19.0 并存，版本号体系混乱）；Issues 仅 1 个 open（[#13，macOS 内存误检测导致 embedding 模型加载失败](https://github.com/codegraph-ai/CodeGraph/issues)，2026-07-10 提出，页面未见维护者回复痕迹）；无 CHANGELOG，无 CI/测试覆盖率徽章 |
| 安装形态 | 无预编译二进制/无 Docker 镜像；MCP server 需要 `cargo build --release -p codegraph-server`（需 Rust stable + Node.js 18+）；仅 VS Code 扩展有 VSIX 发行包（[VS Code 插件市场](https://marketplace.visualstudio.com/items?itemName=aStudioPlus.codegraph)：4,528 次安装，1 条评论 5 星，最近更新 2026-06-28，版本 0.19.0） |
| Telemetry/外呼 | README 全文未出现 telemetry/privacy/analytics/phone-home 关键词，**未做任何数据收集披露**——这意味着"local-first"是未经验证的口头承诺，不是可审计的工程事实（对比下文竞品 colbymchenry/codegraph 有专门 `TELEMETRY.md` 明确披露+可关闭） |
| 依赖树 | Cargo.toml 核心依赖：serde/serde_json/thiserror/**rocksdb 0.22**/tokio/tower-lsp/dashmap/notify(文件监听)/regex/clap 等，另有 39 个内部 crate（含 37 种语言的 tree-sitter 解析器）；依赖图功能本身未被仓库管理员开启，无法用 GitHub Dependency Graph 交叉验证 |

### 2. 能力边界（决定角色 B 可行性）

- 符号级边：支持函数/类/import/调用链（call chains），38 种语言经 tree-sitter 解析，声称索引速度 ~60 files/sec、查询延迟 sub-100ms。
- **持久层是 RocksDB（`~/.codegraph/graph.db`），不是 SQLite**——这与评估任务背景假设的"它的 SQLite"不符，是本次调研最重要的纠偏点。RocksDB 是纯 KV store，没有 SQL 可查，schema 未公开文档化。
- README 全文未提及任何图导出机制（无 JSON dump、无 GraphQL、无 CLI export/query 命令）。想把它的图搬进我们的 `graph_edges` 表，只能靠逆向其内部 key 编码格式，而这是一个 40 星 solo 项目、随时可能无预警变更内部存储布局——**角色 B 不可行**。

### 3. MCP 工具清单（角色 A）

README 声称"45 MCP tools"（页面描述前后出现 42/45 不一致），分层为：
- 免费社区层 42 个：Code Analysis(11)、Navigation(13)、Indexing(3)、Memory(7)、PR Analysis(1)、Documentation(7)，代表工具如 `get_ai_context`/`get_edit_context`/`analyze_impact`/`find_circular_deps`/`get_callers`/`get_callees`/`pr_context`/`memory_store` 等。
- Pro 付费层 27 个 + Security 层 17 个（合计 44 个，闭源，在 `codegraph.astudioplus.com/pro`）：coupling metrics、dead code detection、similarity clustering、git history mining、SBOM 生成、多引擎安全扫描、SARIF 导出——**这些恰好是我们最想要的"符号级边+影响面分析"能力，被刻意留在付费闭源层**，免费层拿到的更多是导航类工具，价值打了折扣。
- Token 节省 benchmark：**本尊 README 未提供任何量化数据**。网上流传的"94% fewer tool calls / 73% fewer tokens"等说法（[Developers Digest 博客](https://www.developersdigest.tech/blog/codegraph-local-indexes-ai-coding-agents)）经核实测的是 `@colbymchenry/codegraph`（TS 版本 v1.1.0），而非本尊；另一篇更详尽的 benchmark（["57% fewer tokens, 71% fewer tool calls"，Opus 4.7 headless 模式对照实验，4 次运行取中位数](https://medium.com/kd-agentic/codegraph-the-open-source-knowledge-graph-that-makes-ai-coding-tools-dramatically-cheaper-190f8b89f8a7)）测的也是 colbymchenry/codegraph（该文章标注 32,100 星，经查证该仓库实际 60.8k 星，进一步说明这类第三方转述数字本身也需要打折扣）。**这些数据不能作为引入 codegraph-ai/CodeGraph 的依据。**

### 4. 增量同步机制

- 声称"FNV-1a content hashing"做增量重索引，触发方式未明确说明是文件监听(watch)自动触发还是需要手动调用 `reindex_workspace`/`index_files` 工具；VS Code 扩展有 `codegraph.indexOnStartup` 配置项，但正文没有给出监听延迟的 SLA 数字。Cargo 依赖里有 `notify`（Rust 文件系统事件监听库）说明底层具备 watch 能力，但对外文档没有把这条链路讲清楚——**这本身就是一处文档不透明**，实际延迟未知，只能靠实测验证。

### 5. 与我们自研 radius 的重叠/互补分析

- 我们的 scan-graph 是**文件级** import/spawn/http 三类边 + 业务承诺翻译（journey/feature 层）；CodeGraph 是**符号级**（函数/类调用链）纯代码结构分析，不做任何业务语义映射。
- 理论上符号级粒度比我们细（能看到函数级调用链，我们只到文件级），这确实是它相对我们的真实增量点。但代价是：闭源商业化把最有价值的 impact/coupling 分析层拿走，且存储格式不开放，导致这个增量点拿不到手（要么掏钱进 Pro，要么自己重新实现一遍符号级解析——不如我们直接自研符号级能力，不引入这个依赖）。
- 结论：它并不构成对我们 radius 端点的有效补充，因为拿到的免费层能力集中在"给 AI agent 看代码导航"，而不是"给我们的 graph_edges 表喂符号级边"。

### 6. 竞品快评（角色 A：轻量 MCP 代码问答，谁最轻最稳）

- **`colbymchenry/codegraph`**（[repo](https://github.com/colbymchenry/codegraph)）：MIT，**60.8k stars / 3.8k forks**，最新 release v1.4.1（2026-07-10），`npm i -g @colbymchenry/codegraph` 一条命令安装、自带运行时无需编译，存储 SQLite+FTS5（`.codegraph/codegraph.db`，schema 可读性远好于 RocksDB），文件监听 debounce 2 秒自动同步（`CODEGRAPH_WATCH_DEBOUNCE_MS` 可调），默认只暴露单一工具 `codegraph_explore`（刻意压缩 tool 列表的 token 占用，这个设计思路本身就值得借鉴），telemetry 有专门 `TELEMETRY.md` 披露+`codegraph telemetry off` 可关。**如果角色 A 的诉求还在，这是目前证据链里最值得单独评的候选**，但需要另开一轮独立评估（星标量级和本次指定目标差两个数量级，不能默认它=本次结论的一部分）。
- **`CodeGraphContext`**（[repo](https://github.com/CodeGraphContext/CodeGraphContext)）：MIT，4,000 stars，最新 v0.4.7（2026-05-07），220 个 open issues + 114 个 PR 说明需求量大但维护跟进吃力；默认后端 FalkorDB Lite 不需要 Docker，但选 Neo4j 后端要额外起容器，功能面（23 语言、多图数据库可切换）比单纯"代码问答"诉求要重，装配复杂度高于 colbymchenry 版本。
- **`sdsrss/code-graph-mcp`**（[repo](https://github.com/sdsrss/code-graph-mcp)）：单二进制内嵌 SQLite+FTS5+sqlite-vec，~10MB（含 embedding 模型约 150MB），BLAKE3 Merkle tree 增量同步、无变化检测 <250ms，技术上最轻；但只有 **54 星**，社区规模太小，solo 维护风险和 codegraph-ai 本尊接近，不建议作为角色 A 首选。

**角色 A 若要选，轻/稳排序：colbymchenry/codegraph > sdsrss/code-graph-mcp ≈ CodeGraphContext（功能重）> codegraph-ai/CodeGraph（商业化拆分导致免费层价值最薄）。**

---

## 风险清单

1. **供应链风险**：solo 维护者 + 40 星 + open-core 商业模式，随时可能把更多能力移入付费层，或项目停止维护；143 commits/1 tag 的节奏不足以支撑生产依赖。
2. **数据不透明风险**：无 telemetry 披露 = 无法验证 local-first 承诺是否属实，只能靠网络层实测证伪/证实，不能采信 README 的默认声明。
3. **格式锁定风险**：RocksDB 内部 key 布局未公开文档化，若做适配器会被绑死在特定版本的内部实现上，官方一次内部重构就可能全部报废。
4. **宣传数据误用风险**：市面上流传的 token 节省 benchmark 实际测的是另一个同名不同源项目（colbymchenry/codegraph），若不做这次核查很容易把两者的信誉混为一谈，做出"它很成熟"的误判——这正是本次评估任务背景描述里已经出现的假设错位（"它的 SQLite"）。
5. **License 边界风险**：Apache-2.0 覆盖的只是免费层代码；Pro/Security 工具条款未见公开，若后续误用或依赖了商业层能力，需要重新审查授权条款。
6. **安装成本风险**：无预编译二进制/无 Docker，MCP server 只能本地 `cargo build`，对我们"零安装做评估"之外，真要接入还要在生产机上装 Rust 工具链，增加攻击面和维护面。

---

## 如果引入的隔离试跑方案（容器内，不碰宿主凭据）

即便结论是不用，仍给出后续如需复核/或评估上文提到的 colbymchenry/codegraph 时可复用的隔离验证流程：

1. **构建隔离环境**：自建 Dockerfile（基础镜像 `rust:1.78-slim`），容器内 `git clone` 目标仓库并 `cargo build --release -p codegraph-server`；不使用宿主已有的 Rust/Node 环境，不 mount 宿主 `~/.credentials`、`~/.ssh`、1Password 相关卷。
2. **网络隔离验证 local-first 承诺**：容器起两组——一组 `--network none`（完全断网跑索引，验证是否能正常工作/是否报错要求联网）；另一组挂代理/`tcpdump` 抓包或用自定义 bridge + iptables 记录出站请求，跑同样的索引流程，比对是否有任何 DNS 查询或出站连接（尤其关注是否偷偷请求 embedding 模型下载或任何 `*.astudioplus.com`/分析类域名），验证"无 telemetry"是否属实。
3. **样例数据，非生产代码**：只挂载一个从 Cecelia 仓库摘出的**只读、脱敏的小样例子目录**（或直接用公开的开源小项目做测试对象），绝不把生产 `packages/brain` 全量代码喂给一个未经信任的三方工具索引。
4. **存储格式可行性复核**：索引完成后，用 `rocksdb ldb`（或对应语言的 RocksDB 只读工具）dump 生成的 `graph.db`，人工核对 key/value 编码规律，判断角色 B 适配器是否真的不可行（本次评估基于文档判断"无导出/schema 不公开"，实测可以进一步证实）。
5. **MCP token 实测**（若要验证角色 A）：容器内起 `codegraph-server --mcp`，用一个**非生产、无敏感项目权限**的隔离测试 Claude session 连接，跑几个固定的"找调用链/找影响面"任务，和不挂 MCP 的 baseline 比较 tool call 数与 token 消耗，产出自己的实测数字而不是照抄网上的第三方 benchmark。
6. **收尾**：试跑完毕后 `docker rm -f` 容器 + 删除镜像 + 清理临时卷，不在宿主机全局安装任何组件，不写入任何生产配置。

---

## 第二轮：colbymchenry/codegraph（真身）

评估对象：https://github.com/colbymchenry/codegraph （TypeScript + SQLite，MIT，`npm i -g @colbymchenry/codegraph`，文档站 https://colbymchenry.github.io/codegraph/）
评估方式：纯文档级（GitHub API `gh api` + README/CHANGELOG/schema.sql/TELEMETRY.md 源码级阅读），**未安装未运行**，未碰宿主凭据。

### 结论先行

**建议：边源适配器（角色 B）—— 开一次容器隔离试跑，若通过则纳入 graph_edges 符号级扩展；角色 A（MCP 进交互 session）列为二级候选，暂不作为本轮首选引入。**

这是本轮迄今证据链最扎实的一个候选：60,754 星 / 3,806 fork（[repo 主页](https://github.com/colbymchenry/codegraph)），MIT，SQLite schema **就在仓库里**（`src/db/schema.sql`，逐字段注释 + `schema_versions` 表 + 明确记录的历史迁移 v4/v6），依赖树只有 10 个直接依赖、lockfile 总共 108 个包（[package.json](https://github.com/colbymchenry/codegraph/blob/main/package.json)），npm 发布走 trusted publishing + provenance attestation，telemetry 有专门文档 + 公开源码的 ingest worker + 三种关闭开关，README 自带 7 个真实开源仓库的 with/without 对照 benchmark（含方法论、命令行、每次运行的原始数字）。这些都是第一轮 codegraph-ai/CodeGraph（RocksDB、40 星、无 schema 文档、无自己的 benchmark）逐条对不上号的地方——**这次评估对象是真正把"能证伪"的材料都摆在台面上的项目**。

选边源适配器而非 MCP 的理由：①它直接、无中间层地扩展我们现有的 graph_edges（文件级）到符号级，且 schema 公开稳定，适配器是可控的一次性/周期性 ETL 读取，不需要在生产开发机上跑一个常驻 daemon；②MCP 角色要求把它的文件监听 + MCP server 长期挂进每个交互 Claude session 的进程空间，多引入一层供应链信任面（哪怕这个项目目前证据很扎实，也是单人维护——见下文风险①），而我们已有的 scan-graph/radius 端点已经覆盖了"省 token 找关联"的大部分诉求，MCP 角色的边际收益不如适配器角色对现有基础设施的直接增量大。

如果后续token成本真的成为交互 session 的痛点，MCP 角色（角色A）值得单独另开一轮隔离实测（见下文隔离试跑方案第5步），但不作为这次结论的一部分。

### 逐项证据

#### 1. 供应链

| 项 | 证据 |
|---|---|
| License | MIT（[gh api repos/colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) 返回 `license.spdx_id: MIT`） |
| 星标/Fork/Issue | 60,754 stars / 3,806 forks / 324 open issues（GitHub API 实时数据，2026-07-18） |
| 维护者结构 | **事实上单人维护**：`gh api .../contributors` 显示 colbymchenry 651 次提交，第二名是 `github-actions[bot]` 24 次，第一个真人第二贡献者 `omonien` 仅 16 次、`andreinknv` 7 次，其余 20+ 位贡献者均 ≤4 次。npm 包 maintainers 字段也只有一个人（`colbymchenry <me@colbymchenry.com>`）。**这是本项目最大的结构性风险**：60k 星的热度和近乎单人的 bus factor 并存。 |
| 发版节奏 | **极高频**：v1.0.0 (2026-06-12) → v1.4.1 (2026-07-10) 共 15 个 tag，近一个月单日内出多个版本的情况多次出现（如 07-10 当天 v1.3.1→v1.4.0→v1.4.1）；npm 上共 44 个已发布版本；提交历史显示几乎每天都有 commit，07-17/07-18 仍在做 C/C++ 内核移植等大改动。活跃度远高于第一轮的 codegraph-ai/CodeGraph（143 commits / 40 星 / 1 tag）。 |
| 依赖树 | `package.json` 直接依赖仅 10 个（`@clack/prompts`/`commander`/`fast-string-width`/`fast-wrap-ansi`/`ignore`/`jsonc-parser`/`picomatch`/`sisteransi`/`tree-sitter-wasms`/`web-tree-sitter`），devDependencies 5 个；lockfile 总计 108 个包（含传递依赖）。`npm view` 显示已发布包本身 `deps: none`（运行时被打包进 `dist`，不对外暴露依赖树）。规模远小于典型 Node 工具链。 |
| Telemetry/外呼 | **有专门披露**：[`TELEMETRY.md`](https://github.com/colbymchenry/codegraph/blob/main/TELEMETRY.md) + 工程契约文档 [`docs/design/telemetry.md`](https://github.com/colbymchenry/codegraph/blob/main/docs/design/telemetry.md) 逐字段列出 envelope（`machine_id` 随机 UUID、版本、os/arch、node_major、`ci` 布尔）+ 4 类事件（install/index/usage_rollup/uninstall），明确写明"never collected"清单（无源码、无路径、无 IP、无指纹）。Ingest worker 源码公开在仓库 `telemetry-worker/`（Cloudflare Worker，`wrangler.jsonc`），POST 到 `telemetry.getcodegraph.com`，允许清单式校验，本地先聚合成日汇总再发送。三个关闭方式都可用：`codegraph telemetry off` / `CODEGRAPH_TELEMETRY=0` / `DO_NOT_TRACK=1`（跨工具标准环境变量，最高优先级）。另有一个独立的"检查新版本"后台请求（每天最多一次，只发版本号），`CODEGRAPH_NO_UPDATE_CHECK=1` 单独关闭。 |
| "auto syncs on code changes" 机制 | 三层明确记录在 README（["How auto-syncing works"](https://github.com/colbymchenry/codegraph#key-features) 折叠块）：①原生 OS 文件事件（FSEvents/inotify/ReadDirectoryChangesW）+ 防抖（默认 2000ms，`CODEGRAPH_WATCH_DEBOUNCE_MS` 可调，范围 [100ms, 60s]）；②同步窗口内的"per-file staleness banner"，MCP 响应里对仍待同步的文件加 ⚠️ 提示 agent 直接 Read；③MCP server 重连时做一次 `(size, mtime)+content-hash` 对账，吸收"服务器没跑期间"的外部改动（如 `git pull`）。沙箱/CI 环境或设 `CODEGRAPH_NO_DAEMON=1` 时 watcher 关闭，退化为手动 `codegraph sync`。**不是 git hook，是文件系统级 watch + 防抖 + 连接时校验的组合**，机制交代得比第一轮候选清楚得多。 |

#### 2. SQLite schema 公开程度与导出可行性（角色 B 命门）

**结论：schema 完全公开、有版本追踪、有迁移记录，导出/适配器可行性高——这是与第一轮（RocksDB 不公开）最大的反转。**

`src/db/schema.sql`（[源码](https://github.com/colbymchenry/codegraph/blob/main/src/db/schema.sql)）在仓库根目录随包分发（`package.json` 的 `copy-assets` 脚本把它复制进 `dist/db/schema.sql`），核心表结构：

```sql
-- Nodes: 代码符号（函数/类/变量等）
nodes(id, kind, name, qualified_name, file_path, language,
      start_line, end_line, start_column, end_column,
      docstring, signature, visibility,
      is_exported, is_async, is_static, is_abstract,
      decorators, type_parameters, return_type, updated_at)

-- Edges: 节点间关系
edges(id, source, target, kind, metadata, line, col, provenance,
      FOREIGN KEY(source/target) REFERENCES nodes(id) ON DELETE CASCADE)
      -- UNIQUE(source, target, kind, IFNULL(line,-1), IFNULL(col,-1))

-- Files: 追踪的源文件
files(path, content_hash, language, size, modified_at, indexed_at, node_count, errors)

-- Unresolved References: 待解析引用（含重试状态机 pending/failed）
unresolved_refs(id, from_node_id, reference_name, reference_kind, line, col,
                candidates, file_path, language, status, name_tail)

-- FTS5 全文索引 + 触发器保持同步（nodes_fts）
-- schema_versions 表追踪 schema 版本号，注释里明确记录了 v4（删索引）、v6（去重+加唯一约束）等历史迁移
```

关键设计事实（读 `src/types.ts` 得到，非猜测）：
- `EDGE_KINDS`（[源码](https://github.com/colbymchenry/codegraph/blob/main/src/types.ts)）固定为 12 种：`contains/calls/imports/exports/extends/implements/references/type_of/returns/instantiates/overrides/decorates`，且源码注释明确写"ARRAY ORDER is part of the native kernel's wire contract...append new kinds, never reorder"——这是对外部消费者（我们做适配器）的一个隐性稳定性承诺。
- `edges.provenance` 字段区分 `'tree-sitter' | 'scip' | 'heuristic'`，可以过滤掉跨语言桥接类的启发式边（如 Swift↔ObjC）、只取静态解析出来的高置信度边。
- 数据库文件是 `.codegraph/codegraph.db`，用 Node 内置 `node:sqlite`（WAL 模式，并发读不阻塞写），任何标准 SQLite 客户端都能只读打开做 dump，不需要逆向任何私有格式。

对比第一轮"角色 B 因 RocksDB 不公开而不可行"的结论，这次前提本身就成立——**这是本轮评估里 role B 命门问题的正面回答**。

#### 3. 语言支持与边粒度（能否表达"文件A函数x调用文件B函数y"）

**能，而且是一等公民场景，不是边缘特性。** `edges` 表的 `source`/`target` 都是 `nodes.id`（每个 node 带 `file_path`），`kind='calls'` 是标准边类型之一。一条跨文件调用边就是：`edges(source=<文件A里函数x的node.id>, target=<文件B里函数y的node.id>, kind='calls', line=..., col=..., provenance='tree-sitter')`，两个 node 的 `file_path` 天然不同即为跨文件。

语言覆盖极广：README 列出 20+ 种语言"Full support"（TypeScript/JavaScript/Python/Go/Rust/Java/C#/PHP/Ruby/C/C++/Swift/Kotlin/Scala/Dart/Svelte/Vue/Astro/Lua/R/Erlang/Solidity/Terraform/Nix 等），JS/TS 精细度最高（含 TSX/JSX、装饰器、类型参数、异步/静态/抽象标记）。CHANGELOG 显示的 fix 记录质量很高——不是空泛宣传，是具体到"PHP 通过类属性调用方法解析错误 (#1220)"、"Go 通过 struct 字段调用绑定到无关同名方法 (#1276)"这类真实的符号解析 corner case 修复，说明这套符号级解析在生产使用中被大量打磨过。

还有"Measured cross-file coverage"一节（README），用真实开源仓库量化"有多少符号文件至少有一个被跨文件引用/调用/路由解析出来"，TS/JS 自举仓库本身 95.8%，Python(requests) 100%，Go(gin) 96.6%，诚实地把"运行时动态分派/反射/框架约定入口"这类静态分析天花板单独列出，不通过缩小分母来刷数据——这是一个愿意自曝短板的项目,可信度加分项。

#### 4. Token 节省 benchmark 的真实性（自己的数据）

**是自己的一手数据，方法论透明，且**主动**标注了局限性（不是营销话术）。** README 的"Benchmark Results"一节（[源码](https://github.com/colbymchenry/codegraph#why-codegraph)）：

- 7 个真实开源仓库（VS Code ~10k 文件、Excalidraw、Django、Tokio、OkHttp、Gin、Alamofire），7 种语言。
- 方法论写明：`claude -p`（Opus 4.8）headless 跑，`--strict-mcp-config`，WITH=启用 codegraph MCP，WITHOUT=空 MCP 配置，内建 Read/Grep/Bash 两边都保留，同一问题跑 4 次取中位数，仓库 `--depth 1` clone，2026-06-02 用当前 build 重新验证过一次（并解释了为什么 Opus 4.8 比之前 Opus 4.7 验证时数字更保守——因为新模型本身 grep 更高效，"没有 CodeGraph 回归"，而是基线变强了，这种解释是诚实自曝而非往有利方向粉饰）。
- headline 数字：**58% 更少 tool calls、22% 更快、文件读取趋近于零**（跨仓库一致）；VS Code 单例 81% 更少 tool calls / 64% 更少 token / 18% 更省钱；也有"even"（不省钱）的例子（Excalidraw/Tokio）。
- **最关键的诚实声明**：README 原话——"token 和 dollar cost 节省是 scale-dependent 的：在中小代码库上小且有噪声，只有在大型缠结代码库、乘以整个团队的日常 agent 用量时才会累积成真正的成本线项"。**这与市面上被转述成"57%/94%"的营销话术调性完全不同**，是一个愿意说"在你的 500 文件项目上，这个工具的价值是速度不是省钱"的项目。
- 另有更早、更大规模的 A/B 矩阵（`docs/benchmarks/codegraph-ab-matrix.md`，2026-05-24，codegraph 0.9.4）：37 个 cell（语言×规模×真实仓库），文件读取从 159→38（76% 减少，0 次退化），同样诚实报告了"在小仓库/短任务上，MCP 固定开销可能让成本持平甚至略高于不用"的负面结果。

结论：这是我们评估过的两个 codegraph 里**唯一一个自己的 benchmark 经得起方法论审查**的项目，且它自己都不敢把 token/成本节省说成普遍真理,只说"规模化后才是真钱"。

#### 5. 与 Claude Code 的集成形态（对我们 headless cecelia-run 容器是否可用）

- 集成形态是标准 **MCP stdio server**：`codegraph serve --mcp`，配置写入 `~/.claude.json` 的 `mcpServers.codegraph = {type: "stdio", command: "codegraph", args: ["serve","--mcp"]}`，或用 `codegraph install` 自动配置（支持 Claude Code / Cursor / Codex CLI / opencode / Gemini CLI 等 8 种 agent）。默认只暴露**一个**工具 `codegraph_explore`（其余 `codegraph_node/search/callers/callees/impact/files/status` 默认不注册，用 `CODEGRAPH_MCP_TOOLS` 环境变量按需打开）——这个"默认只留一个宽工具"的设计本身就是刻意压缩上下文占用的产物，值得我们自己的 skill/MCP 设计借鉴。
- **对 headless 场景是可用的**，证据链：
  1. 官方自己的 benchmark 方法论就是 `claude -p ... --strict-mcp-config` 跑的（见第 4 项）——这就是 headless 用法的官方验证。
  2. `codegraph install --yes` / `--target=... --yes` / `--print-config <agent>` 全部是非交互式路径，专为脚本/CI 设计（README 明确写"Non-interactive (scripting / CI)"）。
  3. CHANGELOG 记录了"Indexing inside CPU- or memory-limited containers (Docker, CI runners) now sizes its worker pools from the container's actual allowance"——**项目自己在给容器场景做资源探测适配**，说明容器内运行是被验证过的使用场景，不是理论上"应该能跑"。
  4. 更重要的一点：如果不想引入 MCP 协议握手这层，**每个 MCP 工具都有等价 CLI 命令**（`codegraph explore/node/query/callers/callees/impact/files/status`，均支持 `--json`），headless 容器完全可以绕开 MCP server，直接 shell 出 `codegraph explore "<query>" --json` 拿结构化结果——这对 cecelia-run 这种非交互容器可能是比 MCP 握手更简单、更可控的接入方式（无常驻进程、无 stdio 协议依赖，一次性子进程调用即可）。
- 安装形态：不需要编译，`install.sh`/`install.ps1` 直接拉预编译 bundle（含捆绑的 Node 运行时），Windows/macOS/Linux × x64/arm64 全平台预编译（release.yml 自动构建 + npm trusted publishing + GitHub attestation 签名，`gh attestation verify` 可验证）。库嵌入模式（`import CodeGraph from '@colbymchenry/codegraph'`）需要宿主 Node ≥22.5（用内置 `node:sqlite`），但 **CLI 和 MCP server 本身用自带运行时，不受宿主 Node 版本限制**——这对我们容器化部署很友好，不需要对齐宿主 Node 版本。

#### 6. 结论三选一

**选：边源适配器（角色 B）—— 先在隔离容器里验证可行性，再决定要不要正式纳入 graph_edges 符号级扩展管线。**

理由汇总（详见"结论先行"）：schema 公开且有版本/迁移记录、edges 表的 source/target/kind/provenance 结构与我们的 graph_edges 语义直接对得上、20+ 语言全覆盖（含我们最关心的 JS/TS）、且是纯离线读取一个 SQLite 文件的批处理性质，不需要往交互 session 里加一个常驻 daemon。

角色 A（MCP 进交互 session）**列为二级候选，本轮不作为首选**：证据质量很高（自己的 benchmark 方法论扎实、telemetry 透明、CI/headless 都验证过），如果换成"我们要专门解决交互 session 的 token 成本"这个问题，它是目前查过的所有候选里最值得投入的一个（比第一轮竞品快评列出的 colbymchenry/codegraph 同款、CodeGraphContext、sdsrss/code-graph-mcp 都更成熟——因为这次深挖后发现它其实就是同一个项目，第一轮只是浅评）。但引入它意味着每个交互 Claude session 里挂一个第三方文件监听 + MCP server 进程，这层供应链信任面（哪怕当前证据很扎实）不应该在角色 B 验证完成之前就顺带打开。

**不选"不用"**：这次证据链没有找到第一轮那种"结构性拒绝理由"（不透明 schema、无自己数据、solo 弱维护低活跃度），相反在每一项关键指标上都给出了可验证、可复现的正面证据。唯一实质性风险是单人维护的 bus factor（见下），但这不足以否决一次低成本的容器隔离试跑。

### 风险清单

1. **Bus factor 风险**：尽管 60k 星、44 个版本、近乎每日发版，代码库事实上由 colbymchenry 一人维护（651/约700+ 次提交里的绝大多数），npm 包 maintainers 也只有他一人。任何单人维护项目都有"维护者停更/被收购/转向商业化（`CodeGraph Pro` 已经在 getcodegraph.com 排队等候名单）"的风险——注意 README 顶部已经出现"The CodeGraph platform is coming"的商业化预告和 waitlist，说明这个项目未来也可能走 open-core 路线（虽然目前免费层就是全部核心功间，Pro 目前定位是"platform"级产品而非拆分现有 CLI 功能）。
2. **商业化路线不确定性**：目前 MIT 协议覆盖的 CLI/MCP server 本身没有功能阉割的迹象（`codegraph_explore`/callers/impact 等核心能力全部在开源包内），但"CodeGraph Pro"等待名单已经出现，需要持续关注未来版本是否会把当前免费能力移入付费层（第一轮 codegraph-ai/CodeGraph 就是前车之鉴）。
3. **原生内核迁移期风险**：项目正在把提取逻辑从 WASM tree-sitter 迁移到 Rust 原生内核（`codegraph-kernel`，napi-rs，[设计文档](https://github.com/colbymchenry/codegraph/blob/main/docs/design/native-extraction-kernel.md)），目前状态是"spike validated，approved but not started"到"部分语言已 R7a 落地"之间，处于活跃迁移期。迁移文档写明有等价性门禁（node/edge/ref 计数 ±0.5% + 保留 WASM 兜底路径），风险可控，但意味着近期版本的内部实现变动频率会比一般项目高，适配器如果依赖任何"实现细节"（而非公开的 schema.sql + EDGE_KINDS 常量）就会踩坑——**适配器必须只读 schema.sql 定义的表结构，不能依赖内核实现细节**。
4. **Telemetry 默认开启**：虽然文档透明、开关简单，但默认行为是"opt-out"而非"opt-in"（交互安装器会问一次，但 `npx` 直接跑或非交互安装时只在 stderr 打一行提示后默认发送）。生产环境使用前必须显式设置 `CODEGRAPH_TELEMETRY=0` 或 `DO_NOT_TRACK=1`，不能依赖"文档说了不采集代码"就默认信任，需要用网络层实测确认（隔离试跑第 2 步）。
5. **协议版本/wire contract 耦合**：`NODE_KINDS`/`EDGE_KINDS` 源码注释明确说"array order is part of the native kernel's wire contract"——这是稳定性承诺，但也说明适配器如果直接用数组下标（而非 kind 的字符串值）会脆弱；**必须以字符串值（如 `'calls'`）而非数组 index 作为适配器的映射键**，字符串值有"append new kinds, never reorder"的显式保证，数组下标没有。
6. **CI 中的可用性尚需实测**：CHANGELOG 提到容器资源自适应，但具体在我们的 cecelia-run 容器镜像（Node 版本、cgroup 限额）里索引我们自己代码库的真实耗时/内存曲线未知，需要隔离试跑实测而非直接采信 README 数字（他们的容器测试环境和我们的不一定一致）。

### 隔离试跑方案（容器内，验证角色 B 优先，不碰宿主凭据）

1. **构建隔离环境**：`node:22-slim` 基础镜像（满足 `engines: node>=20 <25`），容器内 `npm i -g @colbymchenry/codegraph@1.4.1`（锁定当前最新版本号，不用 `@latest` 避免试跑期间版本漂移），不 mount 宿主 `~/.credentials`、`~/.ssh`、1Password 相关卷、不 mount 任何生产数据库连接串。
2. **网络隔离验证 telemetry 关闭是否属实**：容器起两组——一组设 `CODEGRAPH_TELEMETRY=0` + `DO_NOT_TRACK=1` 且 `--network none` 完全断网跑 `codegraph init`，确认索引流程本身不依赖网络（README 声称"100% local"）；另一组挂 `tcpdump`/自定义 bridge + iptables 记录出站请名单，跑同样流程，比对是否有任何 DNS 查询或到 `telemetry.getcodegraph.com`/`getcodegraph.com` 的出站连接，实测代替文档采信第 4 条风险。
3. **样例数据，非生产代码**：先用一个从 Cecelia 仓库摘出的**只读脱敏小样例子目录**（如单独的 `packages/quality` 或一个公开小型开源 JS/TS 项目）跑 `codegraph init`，确认能生成 `.codegraph/codegraph.db`；不要第一次就把 `packages/brain` 全量代码喂给它。
4. **Schema 适配器可行性复核（角色 B 核心验证）**：索引完成后，用 `sqlite3 .codegraph/codegraph.db ".schema"` 核对实际落库结构与本次读到的 `src/db/schema.sql` 是否一致（**验证是否有 README 未提及的 schema drift**），然后写一个最小 Node 脚本，用 `node:sqlite` 只读打开该文件，跑 `SELECT n1.file_path, n1.qualified_name, n2.file_path, n2.qualified_name, e.kind, e.line FROM edges e JOIN nodes n1 ON e.source=n1.id JOIN nodes n2 ON e.target=n2.id WHERE e.kind='calls' AND n1.file_path != n2.file_path LIMIT 20`，人工核对输出的"文件A函数x→文件B函数y"记录是否准确、能否直接映射进我们的 `graph_edges` 表结构（source_file/target_file/edge_kind/symbol_from/symbol_to/line）。
5. **MCP token 实测（若要验证角色 A，二级候选，非本轮必需）**：容器内起 `codegraph serve --mcp`，用一个**非生产、无敏感项目权限**的隔离测试 Claude session 连接（`--strict-mcp-config` 指向仅含 codegraph 的配置），跑几个固定的"找调用链/找影响面"任务，和不挂 MCP 的 baseline 比较 tool call 数与 token 消耗，产出自己的实测数字，不采信 README 里的 7 仓库数字（那是别人代码库的结果，不代表我们自己代码库的收益曲线）。
6. **收尾**：试跑完毕后 `docker rm -f` 容器 + 删除镜像 + 清理临时卷 + 删除任何生成的 `.codegraph/` 目录，不在宿主机全局安装任何组件，不写入任何生产配置，不把试跑过程中生成的 `machine_id`/telemetry 状态文件带出容器。

---

## 第三轮：docker 隔离试跑实测

评估对象：`@colbymchenry/codegraph@1.4.1`（npm 实名核对通过，非 typosquat）
试跑方式：`node:22` 官方镜像容器，容器名 `codegraph-trial`，未挂载任何宿主凭据目录，代码样本经 `git archive HEAD packages/brain/src` 导出（仅 git 管控文件）后取前 200 个文件、`docker cp` 进容器；索引阶段 `docker network disconnect bridge` 断网；试跑结束后 `docker rm -f` + 清理宿主临时样本目录，宿主机全程未 `npm install/npx` 该包。

### 前置核验（防 typosquat）

```
npm view @colbymchenry/codegraph
  → @colbymchenry/codegraph@1.4.1 | MIT | deps: none | versions: 44
  → maintainers: colbymchenry <me@colbymchenry.com>
curl https://api.npmjs.org/downloads/point/last-week/@colbymchenry/codegraph
  → {"downloads":72754,"start":"2026-07-11","end":"2026-07-17"}
```
包名、版本号、周下载量（7.3 万/周）与第二轮文档调研（60.8k star、MIT、colbymchenry 单人维护）互相印证，非仿冒包，安装前核验通过。

### 四件验证结果

**① 索引成功与耗时**：成功，退出码 0。样本 200 个文件（`packages/brain/src` 前 200 个 git 管控文件，约含 JS 源码），`codegraph init .` 输出 **`2,939 nodes, 6,834 edges in 721ms`**（工具自报的纯索引耗时）；容器内命令总墙钟时间（含进程启动/CLI 渲染）约 2.7 秒。断网（`--network none` 效果，用 `docker network disconnect bridge` 实现）状态下运行，**全程无网络报错、无重试提示、正常跑完退出**，直接支持 README "100% local" 的索引侧承诺。

**② SQLite 文件位置与 schema**：文件在 `<项目根>/.codegraph/codegraph.db`（本次样本内为 `/work/sample/.codegraph/codegraph.db`，10.19MB）。因容器内无 `sqlite3` 客户端，改用 Node 22 内置 `node:sqlite`（`DatabaseSync`，只读打开）核对：
- 实际建表 `nodes`/`edges`/`files`/`schema_versions` 的字段与第二轮从 `src/db/schema.sql` 读到的定义**逐字段完全一致**，无 drift。
- 额外发现两张第二轮文档阅读时未提及的表：`project_metadata`（key/value/updated_at）和 `name_segment_vocab`（应为模糊搜索用的分词表），加上 FTS5 影子表（`nodes_fts_config/data/docsize/idx`）——都是辅助设施，不影响核心 nodes/edges 结构，非阻断性发现。
- **关键负面发现**：本次索引产出的全部 6,834 条边，`provenance` 字段**清一色为 NULL**（`SELECT provenance, COUNT(*) FROM edges GROUP BY provenance` 只有一行 `null: 6834`），与第二轮文档记录的 "`'tree-sitter' | 'scip' | 'heuristic'`三态标注" **不符**——至少在这个 JS/TS 样本、这个版本（1.4.1）上，README/types.ts 描述的置信度分层字段没有被实际写入。这意味着"用 provenance 过滤低置信度边"这条第二轮设想的适配器安全阀**当前不可用**，需要另找准确性过滤手段（见④）。

**③ 抽 5 条 calls 边人工核对真实性**：抽取 5 条跨文件 `kind='calls'` 边，逐条比对源码：

| src (file:symbol) | dst (file:symbol) | line:col | 人工核对结论 |
|---|---|---|---|
| actions.js:buildInsertStatement | role-registry.js:getDomainRole | 53:41 | ✅ 正确，源码第53行确有 `getDomainRole(domainInput)` 调用 |
| actions.js:buildInsertStatement | domain-detector.js:detectDomain | 65:19 | ✅ 正确，源码第65行确有 `detectDomain(...)` 调用 |
| actions.js:createTask | db.js:getPoolHealth | 109:28 | ❌ **误判**，源码第109行实际是 `pool.query(...)`（对 `pg` Pool 实例方法调用），与 `getPoolHealth`（db.js 里一个无关的具名导出函数）毫无关系 |
| actions.js:createTask | db.js:getPoolHealth | 145:25 | ❌ **误判**，第145行同样是 `pool.query(sql, params)` |
| actions.js:createTask | db.js:getPoolHealth | 149:31 | ❌ **误判**，第149行同样是 `pool.query(...)` |

准确率 **2/5**。三条误判呈现同一根因：当调用目标是"从其他模块 import 进来的对象实例的方法"（`pool.query()`，`pool` 是 `import pool from './db.js'` 的默认导出，运行时是 `pg.Pool` 实例）时，静态解析器无法确定 `pool` 的真实类型，退化成"落到同一个被导入模块里挑一个具名导出符号"这类启发式兜底，而不是老实标记为"无法解析"（对照 `unresolved_refs` 表本应承接这类情况）。**这是一个真实存在的符号级噪声模式**，且恰好因为 provenance 字段未填充（见②），我们没有任何字段能自动过滤掉这三条误判——必须在适配器层自己加规则。

**④ 断网期间外呼报错**：无。索引前已执行 `codegraph telemetry off`（返回"Telemetry disabled. Buffered, unsent data was deleted."），且断网验证用 `curl -m 3 https://registry.npmjs.org` 确认容器网络不可达（`NETWORK_UNREACHABLE`）后才跑索引；索引全程 stdout 无任何网络异常提示，命令正常退出（exit 0）。等价支持 local-first 承诺，但因为提前关闭了 telemetry，这次没有单独做"telemetry on + 断网 + 抓包对比"的差异实验，只验证了"关闭后确实不需要网络也能正常索引"，未验证"打开 telemetry 时是否会在索引路径里发起被断网阻断的静默失败请求"（第二轮方案第2步的抓包比对没有做，可视为本轮的一个遗留验证项）。

### 适配可行性判决

**结论：可行，但必须带两条硬性 accuracy 护栏，且需要新增/扩展 `edge_type` 取值。**

- schema 稳定性判决**维持第二轮结论**：字段逐一对得上，SQLite 单文件、`node:sqlite` 只读打开即可读取，无需逆向任何私有格式。
- 但**第二轮设想的"用 provenance 过滤低置信度边"在实测中不可用**（②的负面发现），且**实测确实抽到了系统性误判**（③），所以"直接批量导入"不可行，适配器必须补两条护栏：
  1. 对 `kind='calls'` 且 target 来自"跨模块 import 的实例方法调用"模式的边做二次校验（比如用轻量正则/AST 复核调用点原始文本里的方法名是否真的等于 `dst_sym` 的 `name` 字段，不等则丢弃）——这次误判里三条边的调用点文本都是 `pool.query`/`pool.query`，而 `dst_name` 是 `getPoolHealth`，方法名字面不匹配，用这条规则就能自动过滤掉本次全部三条误判。
  2. 只对 `kind IN ('calls','imports')` 做符号级导入（这次样本另外还有 `contains`/`references`/`instantiates`，边际价值低于 calls/imports，且 `contains` 是从属结构关系不是我们要的"调用/依赖"语义，暂不导入）。

- `graph_edges` 表目前的 `edge_type` CHECK 约束（`packages/brain/migrations/351_graph_edges.sql`）只允许 `'import' | 'spawn' | 'http'` 三值，**必须先出一个新 migration 把 `calls` 加进 CHECK 白名单**（或另开一张 `graph_edges_symbol` 表隔离符号级数据，避免和现有文件级三类边混在一张表里造成语义混淆——两种方案都可行，倾向后者，因为符号级边多了 `src_symbol`/`dst_symbol`/`line`/`col` 这些文件级边没有的维度，塞进 `detail` jsonb 虽然可行但会让这张表的查询模式分叉）。

**字段映射草案 SQL**（以扩展现有表为例；若采用独立表方案，把 `graph_edges` 换成 `graph_edges_symbol` 且不改 CHECK 约束）：

```sql
-- 前提：先加 migration 把 edge_type CHECK 扩展为
--   CHECK (edge_type IN ('import', 'spawn', 'http', 'calls'))
-- 数据来源：.codegraph/codegraph.db（SQLite，node:sqlite 只读打开）
-- 目标：packages/brain 的 graph_edges（Postgres）
-- 因跨数据库引擎，实际落地为 Node ETL 脚本，此处给出等价的字段映射逻辑（伪 SQL/查询模板）：

-- Step 1：从 SQLite 侧只取跨文件、高置信 calls/imports 边
--（SQLite 侧查询，node:sqlite 执行）
SELECT
  n1.file_path      AS src_path,
  n2.file_path      AS dst_path,
  e.kind            AS cg_kind,        -- 'calls' | 'imports'
  n1.qualified_name  AS src_symbol,
  n2.qualified_name  AS dst_symbol,
  n2.name            AS dst_name,      -- 用于方法名字面校验
  e.line, e.col, e.metadata
FROM edges e
JOIN nodes n1 ON e.source = n1.id
JOIN nodes n2 ON e.target = n2.id
WHERE e.kind IN ('calls', 'imports')
  AND n1.file_path != n2.file_path;   -- 只要跨文件边，与我们文件级图对齐

-- Step 2（ETL 脚本内做，非 SQL）：
--   对 kind='calls' 的每一行，读取 src_path 第 e.line 行原始文本，
--   正则提取调用点紧邻的方法/函数名，与 dst_name 做字面比对，
--   不一致则丢弃（本次实测这条规则能过滤掉全部 3 条 pool.query→getPoolHealth 误判）。

-- Step 3：写入 Postgres graph_edges（批量 INSERT，$1.. 为绑定参数）
INSERT INTO graph_edges (repo, src_path, dst_path, edge_type, detail, scanned_at)
VALUES (
  'cecelia',
  $1,                          -- src_path
  $2,                          -- dst_path
  'calls',                     -- edge_type（imports 边可复用既有 'import' 值，无需扩展 CHECK）
  jsonb_build_object(
    'src_symbol', $3::text,    -- n1.qualified_name
    'dst_symbol', $4::text,    -- n2.qualified_name
    'line', $5::int,
    'col', $6::int,
    'source', 'codegraph',
    'source_version', '1.4.1',
    'provenance', NULL         -- 实测本版本恒为 NULL，字段占位，未来版本填充后再启用置信度过滤
  ),
  NOW()
);
```

补充说明：`kind='imports'` 的符号级边其实可以直接复用现有 `edge_type='import'` 值（不占用新 CHECK 分支），真正需要新增枚举值的只有 `calls`；`kind='imports'` 与我们 scan-graph 现有的文件级 import 边是同名不同粒度（一个到符号、一个到文件），落库时建议在 `detail` 里加 `"granularity":"symbol"` 字段做区分，避免和 scan-graph 产出的文件级 import 边覆盖/去重时张冠李戴。

### 本轮新增风险清单（补充第二轮风险①-⑥）

7. **provenance 字段实测未填充**：第二轮设想的"用 provenance 区分 tree-sitter/scip/heuristic 置信度"在 1.4.1 版本 JS/TS 索引路径上不生效（恒为 NULL），适配器不能依赖这个字段做质量过滤，必须自建启发式校验（方法名字面比对）。
8. **符号解析存在系统性误判模式**：外部库实例方法调用（如 `pool.query()`）会被错误关联到同名导入模块内的无关具名导出，本次 200 文件小样本里 5 条抽样就命中 3 条同类误判（60% 命中率警示这不是偶发噪声，扩大样本前必须先上线④的字面校验护栏）。
9. **`graph_edges` 表结构冲突**：现有 `edge_type` CHECK 约束不含符号级语义（`calls` 等），正式引入前必须先决定"扩展现有表 CHECK" vs "开独立符号级表"，这是一个需要在写代码前拍板的架构决策点，不是本次试跑该定的事。
