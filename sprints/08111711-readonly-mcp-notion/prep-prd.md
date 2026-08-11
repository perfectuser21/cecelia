# 小改动 PrepPRD：美国 M4 只读 MCP Server（Notion 读 Cecelia 状态）

## 改什么
在美国 Mac Mini M4（38.23.47.81，当前跑 Cecelia 生产 Brain 5221/staging 5222）新增一个独立的只读 MCP (Model Context Protocol) Streamable HTTP Server 进程，供 Notion AI 通过 Notion 的 MCP 集成远程只读查询 Cecelia 部分状态。不改动任何现有服务代码。

## 为什么改
Alex 想让 Notion AI 直接了解 Cecelia 生产状态（schema 版本、map 投影汇总/节点/边、部署状态、白名单服务日志），不用手动汇报。只读、无 Shell、无任意 SQL，跟 GitHub MCP 的信任模型一致：一个 Bearer Token，不泄露即安全。

## 关联上下文
- 决策：本机 pf 防火墙历史上曾封禁无认证裸奔的 Brain 5221 API（`docs/runbooks/mac-mini-m4-us-security.md`）——本次新增的是**有认证**的只读端点，性质不同，不需要额外二次验证层（用户已确认）。
- Journey 锚点：`cccccccc-f0f0-4000-8000-000000000003`（管家 · G3 凭据与安全守卫）

## 设计（已收敛，GAN 对抗 + 用户确认）

### 鉴权与凭据
- Bearer Token，`openssl rand -hex32` 生成，写入 1Password CS Vault，双写 `~/.credentials/mcp-bearer.env`（chmod 600），不进 git/日志
- 单 token（不做多租户/多 token，需要再加）
- 鉴权失败统一 401，不区分具体原因（防信息泄露给探测者）
- Token 格式校验：空值/`Bearer `后空值/异常长度 → 一律按鉴权失败处理，不做特殊分支

### 网络暴露
- 走本机已有的 Cloudflare Tunnel（token 管理式），在 Cloudflare Zero Trust 后台新增一条 public hostname ingress 规则指向 MCP 进程本地端口——不新装 Nginx/Caddy
- 不加 Cloudflare Access 二次验证（用户已确认：单 token 模型足够，机器历史问题是"完全无认证"而非"token 泄露"）

### 数据库
- 独立只读 PostgreSQL 用户，仅 GRANT SELECT，无 INSERT/UPDATE/DELETE/DDL
- 独立小连接池（max 5），与生产 Brain 连接池物理隔离
- 启动自检：探测该账号写权限（BEGIN+INSERT 到影子表后 ROLLBACK 或查 pg_roles），检测到非只读立即拒绝启动+告警
- 查询超时分级：轻查询（schema/deployment）2s，重查询（nodes/edges/logs）5s
- migration 未到 405（`map_manifest_versions`/`map_projection_runs`/`map_projection_nodes`/`map_projection_edges`/`schema_version` 不全）→ 返回结构化 `{error:"schema_incomplete", missing_tables:[...], current_version:N}`，不静默空数据、不崩溃、不自动跑 migration

### 工具白名单（固定 6 个，不是通用 SQL 接口）
| 工具 | 参数 | 说明 |
|---|---|---|
| `get_schema_version` | 无 | 兼职连通性探测 |
| `get_map_summary` | 无 | manifest/projection 状态 + 四类对象数量 |
| `get_map_nodes` | `node_type`, `limit`(1-200,默认50) | 非法 node_type/limit → 400，不 fallback 全量 |
| `get_map_edges` | `edge_type`, `limit`(1-200,默认50) | 同上 |
| `get_deployment_status` | 无 | commit SHA/branch/服务状态/启动时间 |
| `get_service_logs` | `service`(白名单), `lines`(≤200) | **本次白名单仅含 `cecelia-brain`**（Brain 自身日志），其余服务以后要看再加；日志内容过脱敏正则（token/密码段/`sk-`/`ghp_`等疑似密钥格式二次遮盖） |

### 资源隔离（与生产 Brain 共机运行的硬要求）
- 独立日志文件，按天+10MB 双阈值轮转，保留 14 份，不写入 Brain 主日志
- 进程走 LaunchDaemon 常驻（本机死规矩），崩溃限速重启（5次/分钟后退避）
- OOM 场景通过 `oom_score_adj` 调低 MCP 进程优先级，让它比 Brain 先被杀；**实现阶段必须真实验证一次**（人为制造内存压力，确认真的是 MCP 先被杀，不能只信配置文件）
- 限流：20 次/分钟/token（人在回路问答场景的富余量，收窄 token 泄露后的滥用半径）

### 告警（Bark，不走飞书）
- 5 分钟内同 token 鉴权失败 ≥10 次 → 疑似暴力破解
- 连续 3 次（1 分钟内）DB 连接失败 → 疑似下线
- 1 小时内 LaunchDaemon 重启 >3 次 → 疑似 crash loop
- 10 分钟内同 token 触发限流 >5 次 → 疑似 token 泄露/异常轮询

### 可观测性
- `/health` 只做 LaunchDaemon/Tunnel 存活探测：`{db, schema_version, uptime, last_query_ok}`
- 不新起 metrics 栈，请求数/错误数/鉴权失败数定期写回 Brain 一张轻表，复用现有巡检+告警链路

## 影响范围
新增独立进程 + 独立 DB 账号 + 一条 Tunnel ingress 规则，不修改现有 Cecelia Brain/Dashboard 代码或配置；失败路径全部 fail closed，不影响现有服务可用性。

## 验收标准
- [ ] 6 个工具均可通过合法 Bearer Token 调用并返回结构化数据
- [ ] 无 Token / 错误 Token / 畸形 Token 请求一律 401
- [ ] 只读 DB 账号对 INSERT/UPDATE/DELETE 实测报错（不是仅信任 GRANT 语句）
- [ ] 非白名单 service / 非法 node_type / limit 越界 → 400，不返回数据
- [ ] 启动自检：故意把 DB 账号配成可写，确认服务拒绝启动
- [ ] 5221/5222 现有服务在 MCP 服务部署前后响应无劣化（跑一次对比 smoke）
- [ ] Bark 告警四条阈值各手动触发一次，确认真的报警（proven-to-fire）
- [ ] CI 全绿
