# 设计：美国 M4 只读 MCP Server（Notion 读 Cecelia 状态）

> 来源：`sprints/08111711-readonly-mcp-notion/prep-prd.md`（已完成 GAN 对抗补全 + 用户拍板）。
> 本文档是该 PrepPRD 到实现计划之间的架构落地层，不重复 PrepPRD 里已定的判定点/NFR 数值，只补"怎么搭"。

## 背景 / 目标

Notion AI 需要通过 MCP（Model Context Protocol）Streamable HTTP 只读访问 Cecelia 生产状态（schema 版本、Universal Map 投影汇总、部署状态、Brain 自身日志）。单 Bearer Token 鉴权，不做写操作，不做任意 SQL/Shell。信任模型类比 GitHub MCP token：token 不泄露即安全。

## 架构：独立新包，不改动 Brain 代码

新增 `packages/mcp-readonly/`，与 `packages/brain` 平级、物理隔离的独立 Node.js 进程：

```
packages/mcp-readonly/
  package.json          # 独立依赖（express, pg, dotenv 足够，不拉 Brain 全量依赖树）
  server.js             # 入口：鉴权中间件 → MCP Streamable HTTP handler → 路由到 tools/
  src/
    auth.js             # Bearer Token 校验中间件（统一 401，不分类）
    db.js                # 独立只读 pg Pool（max 5），查询超时分级 2s/5s
    redact.js            # 日志脱敏（token/密码段/sk-/ghp_ 等疑似密钥格式）
    rate-limit.js         # express-rate-limit：20次/分钟/token（复用 brain 已用的库，模式一致）
    tools/
      get-schema-version.js
      get-map-summary.js
      get-map-nodes.js
      get-map-edges.js
      get-deployment-status.js
      get-service-logs.js   # 白名单本次仅 ["cecelia-brain"]，硬编码常量数组，不做配置表（YAGNI，要扩再加）
  __tests__/
    auth.test.ts
    tools.test.ts
    rate-limit.test.ts
  migrations/
    (只读 DB 角色 SQL 放 packages/brain/migrations/ 下一个可用编号，不在本包内建表——本包不拥有任何表，只读别人的)
```

**为什么独立包而不是塞进 packages/brain**：CLAUDE.md 边界规则里 brain 是"数据库、业务逻辑、API 端点、调度、决策"——这个新服务是只读旁路查询服务，进程生命周期、依赖树、故障域都应该跟 Brain 主进程物理隔离（PrepPRD 里"OOM 时优先牺牲自己保 Brain"这条硬要求，独立进程是前提，同进程做不到独立 oom_score_adj）。

## 数据库只读角色

在 `packages/brain/migrations/` 下新增一个迁移（实现时取当前最大编号+1，多任务并发改 migrations 目录，写入前重新 `ls` 确认避免编号撞车）：

```sql
CREATE ROLE mcp_readonly WITH LOGIN PASSWORD '<从环境变量/1Password管理，迁移文件本身不含明文>';
GRANT CONNECT ON DATABASE cecelia TO mcp_readonly;
GRANT USAGE ON SCHEMA public TO mcp_readonly;
GRANT SELECT ON schema_version, map_manifest_versions, map_projection_runs,
  map_projection_nodes, map_projection_edges TO mcp_readonly;
-- 不 GRANT 其他表；deployment status / service logs 不查表，见下
```

`get_deployment_status` 不查 DB——直接读本机 `git rev-parse HEAD`/`git branch --show-current` + 现有健康检查逻辑（复用 Brain `/health` 已有的实现方式，只读文件系统/进程状态，不需要额外表）。

`get_service_logs` 不查 DB——白名单服务名 → 固定日志文件路径映射（硬编码，如 `cecelia-brain` → LaunchDaemon 的 stdout 日志路径），`tail -n <lines>` 读取后过脱敏正则。**不接受任意路径参数**，只接受白名单里的 key。

## 鉴权

Express 中间件，校验 `Authorization: Bearer <token>` 完全匹配环境变量 `MCP_BEARER_TOKEN`（常量时间比较，防时序攻击）。不匹配/缺失/格式错误一律 401 + `{"error":"unauthorized"}`，不回显收到的值。

## 错误处理

统一错误信封：`{"error": "<code>", ...context}`，code 枚举：`unauthorized` / `invalid_params` / `db_unavailable` / `timeout` / `schema_incomplete` / `service_not_whitelisted`。所有失败路径 fail closed（宁可 4xx/5xx 拒绝，不返回残缺/虚假数据）。

## 部署

- LaunchDaemon plist（本机死规矩，常驻服务不用 launchctl load 临时方式）
- Cloudflare Tunnel：新增 public hostname ingress 规则指向 `localhost:<mcp端口>`（Zero Trust 后台操作，不改本地 nginx）
- 启动自检：探测 `mcp_readonly` 角色是否真的只读（尝试 INSERT 到一次性临时表后立即 ROLLBACK，报错才算自检通过；不报错 = 权限配错 = 拒绝启动）
- **资源隔离（macOS 修正）**：`oom_score_adj` 是 Linux 专属机制，目标机器是 macOS（Darwin/ARM64），没有对应的用户可调 OOM 优先级接口。改用 LaunchDaemon plist 的 `SoftResourceLimits`/`HardResourceLimits` 里的 `ResidentSetSize`（**不是** `MemoryLimit`——这个 key 在 launchd.plist schema 里根本不存在，`man launchd.plist` 实测过 macOS 15.7.4，`ResidentSetSize` 才是真实存在的等价 key）给 MCP 进程设置 512MB 参考值。但这是 **advisory 机制，不是确定性硬顶**：man page 原文——"if memory is tight, the system will prefer to take memory from processes that are exceeding their declared resident set size"——只有系统整体内存紧张时才会被"优先"回收，进程超限不会被立即杀死重启，跟 Linux cgroups 那种确定性 kill 不是一回事。因此保护 Brain 不受拖累不能单靠这一层，实际是纵深防御组合：DB 连接池 max 5 + 限流（20 次/分钟/token）+ statement_timeout 分级 + `ResidentSetSize` advisory 兜底 + 崩溃限速重启（既有逻辑）+ Task 14 的重启风暴告警，多层叠加降低风险，而不是单一硬限制提供确定性保证。PrepPRD 里"人为制造内存压力确认真的是 MCP 先被杀"这条验收标准相应改为"确认 `ResidentSetSize` 配置存在且 `plutil -lint` 通过；如需验证实际内存回收行为需要在系统级内存压力下测试，非确定性触发，不作为可靠验收依据"。

## 测试策略

- **单元测试**（vitest，跟 brain 一致）：`auth.js` 鉴权逻辑（合法/缺失/畸形 token）、`redact.js` 脱敏正则、每个 tool 的参数校验（非法 node_type/limit 越界/非白名单 service → 抛 400 类错误，不查库）
- **集成测试**：起本地测试 DB（复用 brain 现有测试 DB 约定），跑 `get_schema_version`/`get_map_summary` 真实查询，验证只读账号对 INSERT 报错；额外一条：把测试用只读账号临时改成可写权限，验证启动自检探测到后主动拒绝启动（覆盖 PrepPRD 验收标准第5条，此前遗漏）
- **手动/CI 冒烟**（manual: 白名单命令）：启动服务后 curl 六个工具端点，验证 200/400/401 分支；`psql` 直接验证 `mcp_readonly` 角色权限
- 不做：真实 Notion 集成的端到端测试（Notion 侧不可控），MCP 协议层用官方 SDK 的 Streamable HTTP transport，信任其协议实现，只测我们自己的业务逻辑

## 不包含（本次范围外）

- Cloudflare Access 二次验证（已拍板不做）
- 多 token / token 轮换自动化（先手动轮换，需要再自动化）
- `get_service_logs` 除 `cecelia-brain` 外的其他服务
- Notion 自动巡检模式的专门优化（当前按人在回路问答场景设计参数）
