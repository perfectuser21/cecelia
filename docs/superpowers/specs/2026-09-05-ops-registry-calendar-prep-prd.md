# PrepPRD：指挥舱运行舱加厚 · 刀1 — agent/机器统一注册只读投影 + 编排日历

- Brain task: 6fcb5356-a918-46fa-8e23-73a5f64d5361（dev, claimed by interactive-dev-skill）
- 锚点：工厂价值流 · 指挥舱（G1）· S1「总图页可打开且与账本一致」· 加厚
- golden_path: 804520f5-66a6-4a24-8904-53195e3a937d ｜ 决策: 1f4fbc0f（档位A 只看不控）
- GAN 对抗：challenger 19 条 + chaos 17 行矩阵 + 6 陷阱，已全部吸收（见 §设计修订）

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 本 PrepPRD 包含：ops 注册投影表 + 采集器 LaunchDaemon + Brain 端点 + Notion 两库推送
- [ ] 另立 Sprint（本次不做）：Dashboard 运行舱前端页（刀2）；档位B 统一控制平面（拍板暂缓）；GHA cron 深度采集若在本刀超重可降级为静态清单
- [ ] 待讨论：无

## 本次要做的（用户语言）
主理人打开 Notion（手机即可）能看到两张自动更新的库：①「Agents & 机器」——有几台机器、每台上注册着哪些 agent（Brain + OpenClaw 23 个 + launchd 任务）、谁活着谁死了；②「编排日历」——系统里所有定时/排程任务：什么任务、什么 skill、哪台机器、什么调度、上次跑的结果。数据假不了：任何一条采集腿断了，对应分区显式变灰标 stale + 显示原因，绝不显示假数据。

## Golden Path（用户视角，单线性）
1. 主理人打开 Notion「Agents & 机器」库 → 看到全部机器与 agent 行，每行有 host、来源系统、状态、最后心跳时间 → 知道"我有什么、谁活着"
2. 主理人打开「编排日历」库 → 看到全部排程条目（任务名/skill/机器/调度描述/下次触发(如可算)/上次结果）→ 知道"什么时间在哪跑什么"
3. 主理人（或 AI）调 `GET /api/brain/agent-ops/agents|calendar` → 拿到同一份数据的 JSON（现算，含 per-source freshness）→ Dashboard 刀2 直接消费
4. 出错恢复：某采集腿断（如 ssh hk-vps 不通）→ 该分区行标 stale + reason（"ssh 握手超时 · 沿用 22:10 快照"）→ 主理人看到的是「旧但诚实」；采集器整体停摆 >3×间隔 → Brain 侧检出 + Bark 告警 → 主理人按告警里的 SOP 重载 daemon

## 客户视角
手机 Notion 两张库随时看全厂；红/灰状态一眼分清"真挂了"和"采集断了"。

## 完成后用户能
1. 回答"我有几台机器、哪些 agent"不再靠问 AI 现挖
2. 回答"什么任务什么时间在哪台机器跑、用什么 skill"
3. 发现停摆（采集器/worker/派发失败）由系统标红而非靠人翻日志

## 涉及的 Ability / Feature
- 指挥舱 S1 加厚：ops 注册投影（新增 feature, thin）+ 编排日历投影（新增 feature, thin）

## 不包含
- Dashboard 前端页（刀2）
- 从视图发起控制动作（档位B，拍板暂缓）
- OpenClaw agent 逐个会话活性探测（只到 entries+gateway 容器级）

---

## 设计修订（对抗后定稿，实现必须遵守）

### D1 数据模型 — 全新 ops_* 表，禁复用 migration 274
`agent_ops_agents`(274) 是 Path4 微信 RPA 的表（CHECK 枚举锁死 + 275 外键引用），不动它。新迁移（**编号取当时 migrations/ 最大号+1，勿撞并行分支**）建三张：
- `ops_agents`：source(brain|openclaw|launchd) / host_alias(自由文本: local,hk-vps,mmv,xian-*…) / name / agent_type(自由文本) / status(active|offline) / last_seen_at / meta jsonb（**白名单字段，禁整份 config——clawdbot.json 含明文凭据**）。唯一键 **(source, host_alias, name)**（跨机器同名不许互撞）。
- `ops_schedule_entries`：source / host_alias / label / kind(launchd_interval|launchd_calendar|openclaw|brain_recurring|gha_cron) / schedule_desc(人话) / next_run_utc(可空——算不准就空，禁假精确) / last_state / last_exit_code / updated_at。唯一键 (source, host_alias, label)。
- `ops_source_heartbeats`：source+host_alias / last_report_at(服务端时钟) / source_status(ok|unreachable|parse_error|config_missing|auth_failed…) / reason_code / last_error(截断原文)。**per-source freshness——ssh 腿断只灰 hk 分区，不许全量假红。**

### D2 Brain 端点
- `POST /api/brain/agent-ops/report`：**fail-closed 鉴权**（禁用现有 internalAuth 的无 token 放行路径；用 internalAuthOrLoopback 或硬要求 token；先鉴权后校验，401 就是 401，body 带 reason_code）。payload 按 source 分段，每段声明"本段是该 source 全集"；某段缺席不影响其他 source 行；快照内 agent 消失 → 标 offline 不删行；`collected_at` 单调递增，旧快照到达丢弃并记 skipped_stale_snapshot。响应体回带 `env/instance`，采集器断言不匹配即失败（防 5221/5222 静默错投）。
- `GET /api/brain/agent-ops/agents`：清单 + per-source freshness；表不存在（迁移未跑）返回 **503 + migration_pending，禁 200 空数组**。
- `GET /api/brain/agent-ops/calendar`：现算合并：过去 24h 实跑（tasks + dispatch_events；机器标注尽力——tasks.location 只有 us/hk/xian 粒度，skill 由 task_type 映射反推，推不出显示"未标注"，禁编造）+ 排程面（ops_schedule_entries + **Brain recurring_tasks 直读**）。recurring_tasks 中消费链已死的条目（executeTick 废弃族）按"近 N 天无对应实跑"标 ⚠️可疑，禁画绿灯。
- 0 条永远可疑：所有列表响应必须带 source_status，前端/Notion 对「确实为空」vs「采集失败」渲染不同。

### D3 采集器 — 系统域 LaunchDaemon（本机 gui/501 域不存在，LaunchAgent 永不加载）
- `scripts/ops/agent-ops-collector.sh` + `/Library/LaunchDaemons/com.cecelia.agent-ops-collector.plist`（照 com.cecelia.smoke-nightly.plist 范式），间隔 300s。
- **必须登记进 launchd-patrol.js 的 MUST_LOAD_DAEMONS**，否则采集器被 disable 无人告警。
- 脚本开头显式 PATH（launchd 极简环境不含 /opt/homebrew/bin，照 brain-keepalive-check.sh）。
- 单飞锁 = PID+启动时间戳 + TTL 老化回收（记 stale_lock_reclaimed；并发后来者退出码 0 记 skipped_concurrent）。
- 采集腿：
  - launchd：**只认 `launchctl list` 实际加载的**（目录里 .bak/.migrated 残留是退役任务）；调度细节 `launchctl print` 抓 run interval/last exit，StartCalendarInterval 回读 plist；**next_run 在采集端算成绝对 UTC**（宿主 LA 有 DST，容器上海无，禁固定偏移）；语义坑全覆盖：缺省字段=通配、dict 数组多触发点、Weekday 0/7 都是周日；StartInterval 标"约每 N 秒"禁假精确。
  - OpenClaw：**只读 `ssh hk-vps "docker exec openclaw-gateway cat /root/.openclaw/clawdbot.json"` 写死路径**（宿主同名文件有 5 份含旧备份，禁 find/通配）；ssh 必须 BatchMode=yes + ConnectTimeout=6 + 外层 timeout 25；解析失败整份丢弃沿用上轮+stale，禁部分写入；白名单取字段。
  - Brain/GHA：recurring_tasks 由 Brain 端直读不走采集器；GHA cron 从本机两 repo checkout 的 .github/workflows 静态解析（超重则本刀降级为手维静态清单文件+TODO，写明）。
- 失败处理照 chaos 矩阵 17 行执行：Brain API 不可达 → 本地 spool ≤3 轮补传，连续 3 轮失败 Bark；健康探针用 `/api/brain/health`（`/health` 是 404）。

### D4 Notion 两库（AI Hub）
- 一次性创建脚本：**先按 title 搜索已有库，存在即复用**（Notion 无 upsert，防重跑建平行库）；DB id 按现状写成 notion-push-sync.js 常量（容器镜像快照，改动走 brain-deploy.sh 重建，PrepPRD 明示此链路）。
- 新 push 函数是 **upsert 模式（有 notion_id 则 PATCH）**，不是现有 8 函数的一次性建页模式；两张新表都带 notion_id/notion_synced_at 列。
- 「编排日历」Notion 行 = 排程条目（含上次结果/下次触发），**不是逐次运行流水**（防页面爆炸）；运行流水留给 API/Dashboard 现算。
- 错误兜底：404 'Could not find database' = 终止态停推 + 状态灯红（现有 isStaleRelationError 只兜 page 级，需补），**禁自动重建库**；429 退避尊重 Retry-After；401 停推 + Bark；Notion 纯下游，失败不影响 Brain 侧。

### D5 守卫（接缝清单 → 每条一个守卫，全部 proven-to-fire）
| 接缝 | 守卫 | proven-to-fire 方法 |
|---|---|---|
| 采集器停摆（环境接缝） | Brain 服务端检测 now-last_report_at>3×间隔 → 全局 stale 横幅 + Bark | 手动 bootout daemon 看变红 |
| ssh hk 腿断 | per-source heartbeat → 仅 hk 分区 stale | 临时改错 host 跑一轮 |
| 鉴权 fail-open | 写端点无 token/坏 token 必 401 的 CI test | test 三态用例 |
| 迁移未跑 | 端点 503 migration_pending 的 CI test | 断表跑 test |
| next_run 推算 | 真实 plist fixture（数组型/缺省型/跨 DST 日期）断言 UTC 结果 | fixture 单测 |
| report 幂等 | 同 payload 双 POST 无重复行 CI test | 单测 |
| Notion 库删除 | database 404 → 终止态不无限重试 | mock 404 单测 |

## 判定点登记表（decisions e035dad8；均为只读视图低危，无 ⚠️ 拍板级）
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| agent 存活 | 逐进程探测 / 心跳新鲜度 | per-source 心跳 + 服务端时钟 3×间隔阈值 | 单一时钟防漂移；探测成本高 | 面板假活/假死（只读低危） |
| OpenClaw 配置真身 | find 同名文件 / 写死容器内路径 | docker exec 写死 /root/.openclaw/clawdbot.json | 宿主 5 份副本含旧快照 | 把几天前备份当现状 |
| launchd 活任务 | 列举 plist 目录 / launchctl list | 只认 launchctl list 已加载 | 目录有 .bak/.migrated 残留 | 退役任务显示为活 |
| 空结果语义 | 0条=空 / 0条=可疑 | 0 条必须有 source_status=ok 佐证才算真空 | "失败不留原因"病史 | 假"无任务"掩盖采集失败 |
| next_run 推算 | 固定时区偏移 / 采集端算 UTC | 采集端绝对 UTC，算不准留空 | LA 有 DST 上海没有 | 一年错两次/假精确 |

## 前置工作（已逐项确认）
- [x] ssh hk-vps（root@100.86.118.99）本 session 实测可达；openclaw-gateway 容器在跑
- [x] Brain prod 5221 可达，psql 直连 cecelia 库正常；internal-auth 中间件与测试范式已存在
- [x] NOTION_KEY：1Password CS Vault "Notion"（op 取用流程见全局规则）；notion-push-sync 管道每 5 分钟在跑
- [x] LaunchDaemon 范式：scripts/ops/com.cecelia.smoke-nightly.plist；锁老化范式：scripts/ops/brain-keepalive-check.sh
- [x] 测试 fixture：本机真实 plist 可采样脱敏进 repo

## 验收标准（Final E2E）
- [ ] psql 查 ops_agents：OpenClaw source ≥20 行、launchd source ≥10 行、均带 host_alias 与新鲜 last_seen_at
- [ ] `GET /api/brain/agent-ops/agents` 返回含 per-source freshness；手动 bootout 采集器 daemon 后 15 分钟内该接口全局 stale=true（proven-to-fire 留证）
- [ ] `GET /api/brain/agent-ops/calendar` 返回：过去 24h 实跑条目（含今日真实 dispatch 记录）+ 排程条目（含 launchd 与 recurring_tasks 来源）
- [ ] Notion 两张库存在且行数与 DB 一致（±同步窗口），第二轮同步走 PATCH 不新建重复页
- [ ] 守卫表 7 条全部有对应 test/证据，负向用例（ssh 腿断只灰 hk）通过
- [ ] CI 全绿；merge 后 brain-deploy.sh 重建镜像并在 prod 验证端点存活
