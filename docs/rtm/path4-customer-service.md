# Path 4 RTM — 客户私域 AI 接管（Line04 微信客服，16 步）

> 建制 W1 产物（任务 599338ce）。取证日期：2026-07-16。
>
> 权威 smoke 脚本：`zenithjoy-workspace/.github/workflows/scripts/smoke/golden-path-4-smoke.sh`
> 权威 CI workflow：`zenithjoy-workspace/.github/workflows/golden-path-4-smoke.yml`

---

## 等级判定标准

| 等级 | 定义 |
|------|------|
| **L0** | 无测试、无验证 |
| **L1** | mock / dryrun / grep 存在性 / 自发回执（纯函数断言，无真实 I/O 调用） |
| **L2** | 真 API + 真 DB 断言（服务端真链路，无需真机） |
| **L3** | 真机 + 真微信可观察面（xian-rog 真扫码 / 真气泡 / 真浮窗渲染） |

---

## ⚠️ 全局说明

- **Step 4/5** 是共享前门（注册/装机，Path1/2/4 复用），smoke 注明「断言见 golden-path-2-smoke.sh Step1-2，本 smoke 不复测」，本 RTM 收录步骤号但标注复用。
- **接缝步定义**：用户可直接观察到行为变化（真机真微信可见）= 承诺 L3；其他步目标 L2。
- **DB 回填**：`journey_steps`（migration 282）无 `metadata/jsonb` 列（列清单：`id/notion_id/journey_id/name/description/step_number/status/notion_synced_at/created_at/updated_at`），`golden_path`（migration 303）无 verification_level 列。**DB 回填待 L 级 schema（建制W2）**，本文档为唯一回填载体。

---

## 16 步 RTM 对账表

| 步骤号 | 用户语言动作 | FR / NFR / invariant | 现有验证物（文件:行） | 实际等级 | 承诺等级 | 差距与责任通道 |
|--------|--------------|----------------------|-----------------------|----------|----------|----------------|
| **S1** | 客户扫码绑定个人微信号 → Agent 建立后台 UIA 监听（不弹前台窗口） | FR: POST /api/wechat/qr-bind 接受 platform+agent_id 参数；NFR: 不弹前台窗口（后台静默）；invariant: 400 body 必含 platform+agent_id 字段 | `golden-path-4-smoke.sh:73-77`（API shape 校验，期望 400 含 platform/agent_id 字段） | **L1** | L3（接缝步：真扫码，手机真登微信） | 差距：真机扫码段未进 CI。TODO `line04-realmachine-evidence`：见 `sprints/07150800-line04-overlay-continuation/evidence/`。责任：xian-rog 真机通道 |
| **S2** | 客户装客户端 → Agent 注册连中台 | FR: dryrun 子进程正常退出（exit 0）+ wechat_id 回执；NFR: dryrun 模式不触碰真实微信；invariant: receipt 含 `mock_wx_` 前缀 wechat_id | `golden-path-4-smoke.sh:83-87`（dryrun 子进程真跑，验 receipt wechat_id 格式） | **L1** | L2 | 差距：真注册链路（非 dryrun）无独立测试。责任：zenithjoy-workspace integration 补测 |
| **S3** | Agent 检测微信已登录、找到主窗口 → 后台静默监听开始 | FR: overlay_window.py 存在 + switch_customer/events 消费逻辑；NFR: 不弹窗；invariant: overlay 目录不得有 events 写入调用（单写者约束） | `golden-path-4-smoke.sh:90-93`（grep overlay_window.py 存在性+方法），`:494-498`（扫描守卫三路径 window_needs_maximize 纯函数，L1） | **L1** | L3（接缝步：真机大窗 log 可见） | 差距：真机 630×622 小窗守卫日志、sessions>0 验证未进 CI。责任：xian-rog 真机通道 |
| **S4** | 客户（商家）安装 Agent 客户端（共享前门 Path1/2/4 复用） | FR: Agent 安装+注册能力（共享前门）；见 golden-path-2-smoke.sh Step1 | `golden-path-4-smoke.yml` 注释：「断言见 golden-path-2-smoke.sh Step1-2，本 smoke 不复测」 | **L1**（复用 Path2 断言） | L2 | 差距：Path4 侧未独立复测共享前门。责任：Path2 smoke 覆盖，若 Path2 降级则 Path4 同步影响 |
| **S5** | 系统检测登录态有效（共享前门 Path1/2/4 复用） | FR: 登录态校验；见 golden-path-2-smoke.sh Step2 | 同 S4，引用 golden-path-2 smoke | **L1**（复用） | L2 | 同 S4 |
| **S6** | 每次 Agent 启动时向固定测试联系人发一条自检消息 | FR: send_startup_selfcheck 找到目标会话真调 reply_in_chat_with_lease；NFR: 每进程只发一次（done once 标志）；invariant: deny-by-default（未配收件人/已发过 → 不发） | `golden-path-4-smoke.sh:102-148`（纯函数 3 路径断言 + monkeypatch 真调 reply_with_lease + 软失败路径 + 主循环接线 grep startup_selfcheck_done_once）；`services/agent/build-modules/line04/wechat-rpa/tests/test_startup_selfcheck.py`（89行） | **L1** | L3（接缝步：真机真微信真发给固定联系人） | 差距：真机段（真实微信真发送）未进 CI。`line04-startup-selfcheck-smoke.sh` 存在但为 CI 侧 smoke。责任：xian-rog 真机通道 |
| **S7** | 客户触发好友扫描 / 联系人首次发消息 → 系统建立 CRM 档案 | FR: POST /api/crm/friend-scan/trigger → POST ingest → crm_customers 落库；NFR: source='scan'；invariant: resolveServiceWriteTenant deny-by-default（无绑定行 → 拒绝） | `golden-path-4-smoke.sh:159-188`（真 API+真 DB: trigger 200 + ingest ingested≥1 + psql count=1 source='scan'）；`apps/api/tests/routes/crm-friend-scan-trigger.test.ts`（269行）；`apps/api/tests/routes/crm-friend-scan-reconcile.test.ts`（156行）；`apps/api/tests/integration/p4-sprint-1-ws1/wechat-routes.integration.test.ts`（21行） | **L2** | L2 | 无差距（DB_REACHABLE 时全真链路覆盖）。已达标 |
| **S8** | 客户在中台 CRM 列表页给联系人打 A1-A5 状态 | FR: customer-profile 路由含 level/nickname/source/contact_count/recent_actions/ai_profile 六字段；NFR: 字段结构完整；invariant: 六字段缺一不可 | `golden-path-4-smoke.sh:197-222`（wechat.ts grep customer-profile + 六字段声明；API_REACHABLE 时真 HTTP 六字段结构断言）；`apps/api/src/services/crm/customer-roster.test.ts`（202行） | **L2** | L2 | API 不可达时降为 L1 grep。CI 中真 API 断言视环境而定，建议 integration test 补真 DB 全流程。轻微差距 |
| **S9** | 设置白名单 / 接管模式 | FR: PUT /api/wechat/cs/config/:wechatId upsert + GET 回读一致；NFR: 按租户+角色闸（requireCsAdmin+requireSameTenant）；invariant: 非管理员 → 403，跨租户 → 403，目标解析不出 → 404 | `golden-path-4-smoke.sh:230-248`（真 API: PUT 200 + GET 回读 whitelist 一致）；`apps/api/tests/integration/p4-wechat-cs-config/wechat-config.integration.test.ts`（168行）；`apps/api/src/middleware/cs-config-guard.test.ts`（416行）；`apps/api/tests/regression/line04-cs-config-permission.test.ts`（332行）；`apps/api/tests/regression/line04-cs-tenant-isolation.test.ts`（258行） | **L2** | L2 | 无差距。角色闸+租户隔离有完整回归测试。已达标 |
| **S10** | 联系人给客户微信发来一条消息（事件触发点） | FR: 消息触发后续链路（S11-S14 消费）；invariant: 此步无独立断言，只作事件输入 | `golden-path-4-smoke.sh:254-255`（仅 ok 注释，无断言：「事件触发点，消费方见 Step 11-14」） | **L0** | L0 | 此步为纯事件入口，smoke 明确标注无断言。符合设计（L0=无需独立验证，由下游步骤消费） |
| **S11** | 系统判断该消息是否需要回复（白名单 wxid 优先匹配） | FR: should_reply wxid 优先命中 + 旧格式兼容；NFR: 改备注不断链（wxid 稳定标识）；invariant: wxid 命中 → True；纯字符串格式向后兼容 → True | `golden-path-4-smoke.sh:263-278`（纯函数 2 路径断言：wxid 命中+旧格式兼容）；`services/agent/build-modules/line04/wechat-rpa/tests/test_cs_config_gate.py`（178行） | **L1** | L1 | 无差距。判定逻辑为纯函数，L1 是当前最高可达（无真机真微信联动）。已达标 |
| **S12** | 系统调取该联系人历史对话记忆（租户×联系人隔离） | FR: POST /api/wechat/memory/message 写入 + GET memory/context 回读；NFR: 租户隔离（B 读不到 A 的内容）；invariant: 无租户上下文 → 400 MISSING_TENANT | `golden-path-4-smoke.sh:285-312`（真 API+真 DB: 写A租户→B租户读不到+缺租户400）；`apps/api/tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts`（256行）；`apps/api/src/routes/__tests__/wechat-memory.test.ts`（112行，mock层） | **L2** | L2 | 无差距。租户隔离有 integration test + smoke 双覆盖。已达标 |
| **S13** | 生成回复草稿，判断是否转人工 | FR: POST /api/wechat/draft-generate 返回含 status 字段；NFR: 内核内部质量按 2026-07-15 拍板不深挖；invariant: 响应必含 status 字段 | `golden-path-4-smoke.sh:323-334`（真 API 一次调用 + 响应含 status 字段断言）；`apps/api/tests/ws3/draft-generate.test.ts`（46行）；`apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts`（253行） | **L2** | L2 | smoke 中「一次真调+结构断言」已覆盖。内核内部质量（回复质量/转人工判断精度）按拍板不在本轮验收范围。已达标 |
| **S14** | 后台把回复真实发送出去，气泡刷新确认才算成功（防假成功） | FR: cs/outbound 列表含任务 + receipt POST 回执 → DB status='auto_sent'；NFR: 必须气泡回执才翻 auto_sent（防假成功）；invariant: receipt 前状态≠auto_sent，receipt 后状态=auto_sent | `golden-path-4-smoke.sh:342-368`（真 API+真 DB: outbound list含任务+receipt 200+psql 确认 auto_sent）；`apps/api/src/services/wechat/__tests__/cs-outbound.test.ts`（171行，markOutboundReceipt ok→auto_sent/fail→send_failed） | **L2** | L3（接缝步：真机气泡刷新确认） | 差距：真机气泡确认段未进 CI。smoke 已有「服务端等价断言」（DB 翻 auto_sent）覆盖 L2。气泡可见面属 xian-rog 真机通道。责任：真机真验证据见 `sprints/07150800-line04-overlay-continuation/evidence/` |
| **S15** | 客户桌面浮窗实时看到正在回复谁+推理摘要+发送中→已送达 | FR: _write_event 写 events.jsonl 六字段（v/event_id/date/type/contact/stage/reasoning/ts）；NFR: 单写者约束（overlay 只读不写）；invariant: overlay 目录禁止写 events | `golden-path-4-smoke.sh:378-405`（纯函数 _write_event 六字段断言 + DELIVERED 点 grep + 单写者约束 grep）；`services/agent/wechat-rpa/tests/test_overlay_window.py`（378行）；`sprints/07121132-line04-ai-thinking-overlay/tests/test_events_pipeline.py`（322行） | **L1** | L3（接缝步：真机桌面浮窗用户可见） | 差距：真机浮窗渲染（DOM 可见性）未进 CI，smoke 在纯函数层。责任：xian-rog 真机通道 |
| **S16** | 浮窗切换显示当前回复客户的画像面板 | FR: get_events() 消费 reply_sent 事件 → 真调 switch_customer；html 真定义 __updateCustomerCard + DOM 容器；switch_customer 传完整六字段给 evaluate_js；NFR: 不得是孤儿代码（调用链接上且渲染落地）；invariant: called==['联系人名'] | `golden-path-4-smoke.sh:418-484`（三段：16a grep 真调用点 + 16b 端到端功能断言真调 get_events()→switch_customer + 16c 真渲染断言六字段传全）；`services/agent/wechat-rpa/tests/test_overlay_window.py`（378行） | **L1** | L3（接缝步：真机浮窗画像卡可见） | 差距：真机浮窗画像卡 DOM 渲染（用户眼见）未进 CI，smoke 在 Python 层端到端。责任：xian-rog 真机通道 |

---

## 等级汇总

| 步骤 | 实际等级 | 承诺等级 | 是否达标 |
|------|----------|----------|----------|
| S1   | L1       | L3       | ❌ 差距：真机扫码 |
| S2   | L1       | L2       | ❌ 差距：真注册无测试 |
| S3   | L1       | L3       | ❌ 差距：真机守卫 log |
| S4   | L1       | L2       | ❌ 复用 Path2，未独立测 |
| S5   | L1       | L2       | ❌ 同 S4 |
| S6   | L1       | L3       | ❌ 差距：真机真发 |
| S7   | L2       | L2       | ✅ 已达标 |
| S8   | L2       | L2       | ✅ 已达标（CI 真 API 依赖环境） |
| S9   | L2       | L2       | ✅ 已达标 |
| S10  | L0       | L0       | ✅ 已达标（设计即无断言） |
| S11  | L1       | L1       | ✅ 已达标 |
| S12  | L2       | L2       | ✅ 已达标 |
| S13  | L2       | L2       | ✅ 已达标 |
| S14  | L2       | L3       | ❌ 差距：真机气泡确认 |
| S15  | L1       | L3       | ❌ 差距：真机浮窗可见 |
| S16  | L1       | L3       | ❌ 差距：真机画像卡渲染 |

**已达标**：7 步（S7/S8/S9/S10/S11/S12/S13）
**有差距**：9 步（S1/S2/S3/S4/S5/S6/S14/S15/S16）

---

## 责任通道汇总

| 通道 | 涉及步骤 | 说明 |
|------|----------|------|
| **xian-rog 真机通道** | S1/S3/S6/S14/S15/S16 | 真扫码、真气泡、真浮窗，须在 xian-rog 上执行并留证据到 `evidence/` 目录 |
| **zenithjoy-workspace integration 补测** | S2/S4/S5 | 真注册链路、共享前门独立 Path4 侧测试 |
| **建制 W2（judge L 级 schema）** | 全部 | DB 回填待 `journey_steps` 表加 verification_level 列 |

---

## DB 回填状态

`journey_steps` 表（migration 282）列清单：
`id / notion_id / journey_id / name / description / step_number / status / notion_synced_at / created_at / updated_at`

`golden_path` 表（migration 303）列清单：
`id / owner_task_id / order_no / feature_id / note / notion_id / notion_synced_at / created_at`

**两张表均无 metadata/jsonb 列，无 verification_level 字段，DB 回填待 L 级 schema（建制W2）。**

本 RTM 文档为当前唯一 verification_level 载体。
