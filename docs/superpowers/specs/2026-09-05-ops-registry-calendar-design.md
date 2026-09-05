# 指挥舱运行舱 · 刀1 设计：ops 统一注册投影 + 编排日历

- 日期：2026-09-05 ｜ Brain task 6fcb5356 ｜ gp 804520f5 ｜ 决策 1f4fbc0f（档位A 只看不控）
- 完整 PrepPRD（含 GAN 对抗吸收记录）：`sprints/09052225-ops-registry-calendar/prep-prd.md`——**实现细节以 PrepPRD §设计修订 D1-D5 为准**，本文只固化架构决策与测试策略。

## 目标一句话
把散在四层账本（Brain 队列 / 各机 launchd / OpenClaw clawdbot.json / cron）里的"有哪些 agent、什么任务什么时间在哪台机器跑"聚合成 Brain 里的只读投影，经现有 notion-push 管道映射到 Notion 两张库，主理人手机可看，且任何采集失败诚实标灰、绝不显示假数据。

## 已否决的备选（含理由）
1. **复用 migration 274 `agent_ops_agents`**——否决：那是 Path4 微信 RPA 的表（CHECK 枚举锁死 agent_type/host_alias，275 有外键引用），复用污染语义且写入全被 CHECK 拒。→ 新建 ops_* 三表。
2. **采集器用 LaunchAgent**——否决：本机 gui/501 域不存在，~/Library/LaunchAgents 永不加载（launchd-patrol.js:6-8 实证）。→ 系统域 LaunchDaemon + 登记 MUST_LOAD_DAEMONS。
3. **Notion 沿用现有一次性建页 push 模式**——否决：心跳/状态数据每 5 分钟变化，一次性模式页面永远停在首次快照。→ upsert 模式（有 notion_id 则 PATCH），日历行=排程条目非运行流水。
4. **Notion 作为编排控制入口**——拍板否决（决策 1f4fbc0f）：Notion Worker 回写链路已退役，档位B 不做。
5. **宿主 push LaunchDaemon 采集器 + POST /agent-ops/report 写端点**（PrepPRD D2/D3 原案）——计划阶段否决，改为 **Brain 内 scheduler job 拉取**（`runOpsCollector`，复用 launchd-patrol 的 host-exec ssh 逃逸范式）。理由：①正面消解 challenger"双采集链真相源打架"缺口——全系统只剩一条采集路径；②整类风险随写端点消失：internal token fail-open、5221/5222 静默错投、宿主 spool/单飞锁残留、LaunchAgent 永不加载、MUST_LOAD_DAEMONS 漏登记；③采集器停摆天然由现有 scheduler_job_last_run 哨兵覆盖。PrepPRD D2 的"fail-closed 鉴权/env 断言/spool"等条目随写端点一并作废，其余契约（per-source 心跳、宁 stale 不假数据、白名单、写死路径、0条可疑、UTC next_run）原样保留并已落进实施计划的测试断言。

## 架构（拉取式，三个独立单元 + 清晰接口）
```
[Brain scheduler job]──host-exec ssh 逃逸──▶[Brain ops 投影层]──5min notion-push──▶[notion-push 两库]
 runOpsCollector(pool)      三腿采集             ops_agents            upsert(PATCH)
 needsPool,5min自gate        per-source 全集快照   ops_schedule_entries
 launchd腿/OpenClaw腿/GHA腿  单一应用时钟 collectedAt  ops_source_heartbeats
                                                    GET /agent-ops/agents /calendar(现算)
```
- **单元1 采集器**：`runOpsCollector(pool)`（ops-collector.js），Brain 内 scheduler job（复用 launchd-patrol 的 host-exec 三件套 ssh 逃逸宿主），三腿采集（launchd@local / OpenClaw@hk-vps / GHA@github），每腿失败独立降级、互不影响。无宿主 daemon、无写端点、无 spool/lock（拉取模型天然无需）。
- **单元2 Brain ops 层**：migration（三表）+ routes（agents/calendar 两只读 GET，无 report 写端点）+ freshness 判定（服务端单一时钟，3×间隔阈值，per-source）。calendar 现算合并 tasks/dispatch_events（过去24h 实跑）+ ops_schedule_entries + recurring_tasks 直读（死排程标 ⚠️ 禁绿灯）。
- **单元3 Notion 推送**：create-dbs 一次性脚本（按 title 搜索幂等）+ 两个 upsert push 函数挂进现有 runNotionPushSync。

关键契约（全部来自对抗结论，违反即 bug）：空结果必须 source_status=ok 佐证；失败双写 reason_code+last_error；宁 stale 不假数据；next_run 采集端算绝对 UTC 或留空；OpenClaw 只读 docker exec 写死路径；launchd 只认已加载；meta 白名单禁凭据入库；快照 upsert 与 deactivation 同用应用时钟 collectedAt（禁 DB/应用双时钟）。

## 测试策略（四档）
- **unit**（vitest，无外部依赖）：plist→next_run 推算（fixture：数组型/缺省通配型/跨 DST 日期）；clawdbot entries 白名单抽取；freshness 判定函数；Notion properties 构造纯函数。
- **integration**（fake pool + fake exec，照 launchd-patrol.test.js 注入范式）：per-source 隔离（ssh 腿断只灰 openclaw、launchd 照常 ok）；0 行=parse_error 不写空快照；clawdbot 半写入整份丢弃；模块自 gate skipped；agent 消失标 offline 不删行；端点表缺失 503 migration_pending。
- **contract/负向**：ssh 腿断模拟（source=openclaw 心跳过期）→ 仅 hk 分区 stale、local 保持 fresh；Notion database 404 → 终止态不重试。
- **E2E（manual, CI 兼容 curl/psql）**：见 PrepPRD 验收标准 6 条（真机采集 ≥20 OpenClaw 行 + proven-to-fire bootout 留证 + Notion 两库行数一致）。
- CI 不跑真 ssh/真 Notion——外部命令全部依赖注入（照 launchd-patrol.js opts.exec 范式），mock 必须断言调用参数（教训：mock 真实外部命令必出哑火）。

## 交付与部署
单 PR（本分支 cp-09052227-ops-registry-calendar）；merge 后 brain-deploy.sh 重建镜像（容器跑镜像快照，不重建=改了没生效），迁移 433 随部署管道自动跑；采集器是 Brain scheduler job（无宿主 LaunchDaemon 需装，部署即生效，停摆由现有 scheduler_job_last_run 哨兵覆盖）；Notion 库创建脚本 create-ops-notion-dbs.js merge 后宿主手跑一次（NOTION_KEY 走 1Password），把两库 id 写进 working_memory.ops_notion_dbs，下一轮 notion-push 自动开始推。
