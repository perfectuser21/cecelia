# 锚点回填提案（刀C）—— 只读提案，未写库

生成时间：2026-07-18
数据源：`journeys` / `journey_steps` / `journey_step_links` / `journey_features`（psql 只读查询，cecelia 库）
代码验证仓库：`/Users/administrator/perfect21/cecelia`、`/Users/administrator/perfect21/zenithjoy`
（注：任务描述中的 `zenithjoy-workspace` 目录实际不存在，本机真身路径是 `/Users/administrator/perfect21/zenithjoy`，本次全部按这个真实仓库核验）

## 两个 seed 域

`SELECT DISTINCT domain FROM journeys WHERE domain IS NOT NULL` 返回 3 个值：`公司级` / `智能客服` / `工厂`。
但 migration 350（`packages/brain/migrations/350_seed_promise_map_two_domains.sql`）标题明确写着"两打样域"，注释①②确认打样域是：

- **智能客服**（Line04 微信客服 AI 接管，家③横切件池 + GP-B~F 五条 Golden Path）
- **公司级**（客户首次成功路径 / 抖音 CDP walking-skeleton）

`工厂` 域不在 migration 350 范围内（属于另一批数据），本提案**不覆盖**工厂域。

---

## 层级总览

| 域 | Journey | own feature 数 | 说明 |
|---|---|---|---|
| 智能客服 | 智能客服 · 绑定/安装（共享前置） (`6df5b884`) | 1 | 家②共享前置 |
| 智能客服 | 智能客服 · GP-B 被动接待 (`ac2e35bc`) | 0 | 4 步，全部通过 `journey_step_links.base_ref` 引用 `客户私域 AI 接管` 下的横切件 |
| 智能客服 | 智能客服 · GP-C 朋友圈发布 (`016459f9`) | 0 | 3 步 |
| 智能客服 | 智能客服 · GP-D 经营汇报 (`3ae2414e`) | 0 | 3 步 |
| 智能客服 | 智能客服 · GP-E 朋友圈互动 (`b6a73832`) | 0 | 3 步 |
| 智能客服 | 智能客服 · GP-F 社群运营 (`8fe9ed6b`) | 0 | 3 步 |
| 智能客服 | 客户私域 AI 接管 (`bfeed805`) | 43 | 家③横切件池 + Line04 全量 feature/ability |
| 公司级 | 客户首次成功路径 (`6e63f204`) | 9 | 抖音 walking-skeleton onboarding |

**合计 51 个 feature（两域范围内）**，其中 `unit_test_path` 已填 4 条、`workflow_ref` 已填 0 条、`guard_ref` 已填 0 条（`0b70f2ff`/`388873b3`/`adc64d68`/`1e4ee48d`）。

---

## 一、智能客服 · 绑定/安装（共享前置）(`6df5b884`)

| feature | 现有锚点及有效性 | 提议锚点 | 置信度 | 依据 |
|---|---|---|---|---|
| 绑定/安装（共享前置） (`24a98312`，working，被 GP-B/E/F 多步 base_ref 引用) | 无 | ①`zenithjoy/services/agent/wechat-rpa/qr_bind.py` + `zenithjoy/services/agent/wechat-rpa/tests/test_startup_selfcheck.py`（绑定侧）<br>②`zenithjoy/services/agent/modules/line04/preflight.ts` + `zenithjoy/services/agent/modules/line04/__tests__/preflight.test.ts`（安装/开机自检侧） | 中 | 关键词"扫码绑""安装""开机自检" grep 命中；该 feature 是"绑定"+"安装"两个动作合并的横切件，单一文件难以覆盖全部语义，需要主理人拍板选一个主锚或接受组合锚 |

---

## 二、客户首次成功路径 (`6e63f204`，域=公司级)

| feature | 现有锚点及有效性 | 提议锚点 | 置信度 | 依据 |
|---|---|---|---|---|
| 注册自动登录（含 free license 自动创建）(`388873b3`，done) | `unit_test_path=apps/api/src/__tests__/auth-bridge.test.ts` ❌路径失效（`src/__tests__` 目录在 zenithjoy 仓库不存在，实际测试目录是 `apps/api/tests/`） | `zenithjoy/apps/api/tests/auth-bridge.test.ts` + 实现 `zenithjoy/apps/api/src/auth-bridge.ts` | 高 | `find -iname auth-bridge*` 命中真实存在的实现+测试对；`git log --follow` 确认该测试文件历史上就在 `apps/api/tests/`，从未在 `src/__tests__` 下存在过——录入时路径写错 |
| 抖音长文发布脚本（Agent CDP 架构）(`adc64d68`，planned) | `unit_test_path=services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs` ✅存在 | 维持现状 | 高 | `test -f` 直接验证通过 |
| 绑本地视频文件夹（中台输入路径→推给 Agent→Agent watch 该文件夹）(`f91be81a`，done) | 无 | `zenithjoy/services/agent/src/handlers/folder-watch.ts`（暂无同名测试文件，需人工确认测试覆盖位置） | 中 | grep "watch.*folder" 命中唯一实现文件，但未找到专属单测 |
| 一键发抖音 dryrun（中台派任务→Agent 调 publisher，不点最后按钮）(`6b2ab9b5`，done) | 无 | `zenithjoy/services/agent/src/handlers/douyin-publish.ts` + `zenithjoy/services/agent/src/handlers/__tests__/douyin-publish.test.ts`（workflow_ref 候选：`zenithjoy/apps/dashboard/e2e/walking-skeleton-1.spec.ts`） | 高 | 实现+测试文件同目录成对存在，且 e2e spec 名字直接对应"walking-skeleton"（本 journey 的技术代号） |
| 首次扫码绑抖音（Agent 弹 Chrome→session 存本地）(`9b56cbae`，done) | 无 | `zenithjoy/services/agent/src/handlers/qr-bind-douyin.ts` + `zenithjoy/services/agent/src/handlers/__tests__/qr-bind-douyin.test.ts`（Dashboard 侧：`zenithjoy/apps/dashboard/src/pages/DouyinBindPage.tsx` + `__tests__/DouyinBindPage.test.tsx`） | 高 | 命名与"扫码绑抖音"完全对应，实现/测试成对 |
| Dashboard Agent 下载页 + Agent 自动识别 license (`5fea9715`，done) | 无 | `zenithjoy/apps/dashboard/src/pages/AgentDownloadPage.tsx` + `zenithjoy/apps/dashboard/src/pages/__tests__/AgentDownloadPage.test.tsx` | 高 | 文件名直接对应"Agent 下载页"；内容含 license 自动识别逻辑（`accountQuery.data?.license`） |
| Dashboard 显示发布回执（Agent 把 dryrun PASS / 抖音链接 / 失败原因 回报中台）(`2cc21ae5`，done) | 无 | `zenithjoy/apps/dashboard/src/pages/PublishPage.tsx` + `zenithjoy/apps/dashboard/src/pages/__tests__/PublishPage.test.tsx` | 高 | 文件内 `dryrun_evidence`/`发布失败 ✗`/`链路验证完成（dryrun）` 字样与承诺原文（dryrun PASS/失败原因）逐字对应 |
| 画像表单 3 字段（行业/受众/风格）(`5ae89574`，**deprecated**) | 无 | 不提议（已废弃，建议不焊） | — | 状态已是 deprecated，焊锚点无意义 |
| AI 生成内容（接 Claude API，画像作 prompt）(`d7c418f3`，**deprecated**) | 无 | 不提议（已废弃，建议不焊） | — | 同上 |

---

## 三、客户私域 AI 接管 (`bfeed805`，域=智能客服，家③横切件池主体)

### 3.1 家③横切件池（8 个，被 GP-B~F 多步 base_ref 引用）

| feature | 现有锚点及有效性 | 提议锚点 | 置信度 | 依据 |
|---|---|---|---|---|
| 消息/动态采集通道 (`6691d09a`，working，被 GP-B/E/F 引用) | 无 | `zenithjoy/services/agent/wechat-rpa/listen_chat.py` + `zenithjoy/services/agent/wechat-rpa/tests/test_classify_unread_no_drop.py`（或 `test_mainloop_wiring.py`） | 高 | listen_chat.py 是"感知消息"主循环，test_classify_unread_no_drop 直接对应"一条不漏、一条不重"的 promise 原文 |
| Agent 运行时底座（启动状态恢复·开机自检·保活重连）(`0d4922c9`，planned) | 无 | `zenithjoy/services/agent/modules/line04/preflight.ts` + `zenithjoy/services/agent/modules/line04/__tests__/preflight.test.ts`（重连侧：`zenithjoy/services/agent/wechat-rpa/tests/test_restart_blindspot.py`） | 中 | "开机自检"对应 preflight，"保活重连"对应 test_restart_blindspot，但没有单一文件同时覆盖三件事（启动状态恢复/开机自检/保活重连），建议保留 planned 状态待补齐后再焊 |
| 后台静默发送通道 (`2dde3bb5`，working) | 无 | `zenithjoy/services/agent/wechat-rpa/listen_chat.py` 中的发送路径 + `zenithjoy/services/agent/wechat-rpa/tests/test_uia_send_no_swrestore.py`（或 `test_offscreen.py`） | 中 | "静默发送"关键词命中多个 UIA 相关测试，但发送逻辑与感知逻辑同文件（listen_chat.py），建议人工核实是否需要单独锚点或直接引用同一文件 |
| 接管开关 (`7f680eb3`，working) | 无 | `zenithjoy/apps/api/src/middleware/cs-config-guard.ts` + `zenithjoy/apps/api/src/middleware/cs-config-guard.test.ts` | 高 | 文件名+代码内 `auto_agent_enabled` 字段直接对应"接管开关" |
| 客户画像卡 (`d831dd0f`，planned) | 无 | `zenithjoy/services/agent/wechat-rpa/overlay/overlay_window.py`（画像展示相关代码位） | 低 | 仅在 overlay_window.py 里发现"客户画像"字样引用，未找到独立的"画像卡"组件/测试，该 feature 状态本就是 planned，可能尚未实现 |
| CRM 表底座 (`0b70f2ff`，building) | `unit_test_path=packages/brain/src/__tests__/integration/blast-radius.integration.test.js` ⚠️**路径存在但语义存疑** | 维持路径，但需说明：该测试实为 Brain 侧 `journey_step_links` blast-radius 查询的 schema 回归测试（用 CRM 表底座的 feature_id 当测试夹具），并未测试 CRM 表底座功能本身的业务代码。真正的业务侧候选：`zenithjoy/apps/api/src/routes/crm.ts` + `zenithjoy/apps/api/tests/routes/crm-status-history.test.ts` | 存疑 | 已用 Read 工具核对 blast-radius.integration.test.js 全文：3 个 it 全部测 journey_step_links 的 ON DELETE SET NULL / blast-radius 查询语义，与"CRM 表底座"这个业务 feature 无关，只是借用了它的 UUID 做夹具数据 |
| 记忆库租户隔离（不变量）(`39130340`，working) | 无 | `zenithjoy/apps/api/src/services/wechat/tenant-memory.ts` + `zenithjoy/apps/api/src/services/wechat/__tests__/tenant-memory.test.ts` | 高 | 命名与"记忆库"+"租户隔离"完全对应，且有独立 integration 测试 `tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts` 可作 workflow_ref 候选 |

### 3.2 CRM / 客户管理类（10 个）

| feature | 现有锚点及有效性 | 提议锚点 | 置信度 | 依据 |
|---|---|---|---|---|
| 中台 AI-native CRM·客户列表页(状态A1-A5+接管开关→驱动客服白名单) (`ca5fe5ec`，done，ability/mature) | 无 | `zenithjoy/apps/dashboard/src/pages/CustomerListPage.tsx` + `zenithjoy/apps/dashboard/src/pages/__tests__/CustomerListPage.test.tsx`（数据层：`zenithjoy/apps/api/src/services/crm/customer-roster.ts`） | 高 | 文件名直接对应"客户列表页"，e2e `crm-customer-list.spec.ts` 可作 workflow_ref |
| 客户状态变化历史追踪(推进速度指标数据基础) (`8a2d2b2f`，planned) | 无 | `zenithjoy/apps/api/src/routes/crm.ts` + `zenithjoy/apps/api/tests/routes/crm-status-history.test.ts` | 高 | 测试文件名 `crm-status-history` 与 feature 名"状态变化历史"逐字对应 |
| 客服层多租户隔离 (`ca26491c`，working，medium) | 无 | `zenithjoy/apps/api/tests/regression/line04-cs-tenant-isolation.test.ts`（实现分散在 `agent-tenant-resolver.ts`/`cs-account-config-store.ts`） | 高 | regression 测试文件名 `line04-cs-tenant-isolation` 直接对应 |
| 客户机按身份拉中台配置土台 (`4fcb5bbd`，planned) | 无 | `zenithjoy/services/agent/wechat-rpa/cs_config_gate.py` + `zenithjoy/services/agent/wechat-rpa/tests/test_cs_config_gate.py`（配套：`zenithjoy/apps/api/src/services/wechat/cs-account-config-store.ts`） | 高 | cs_config_gate.py 注释原文"导致「装一次写死一次、改开关要重装」...跟随该客服中台配置的 auto_agent_enabled...对「中台不可达拉配置失败」做强制 dryrun 兜底"——与 feature 名"客户机按身份拉中台配置"逐句对应 |
| crm-platform-connect (`0e4e1aa9`，planned) | 无 | 未找到候选 | — | grep "crm-platform-connect"/"platformConnect" 在两仓均无命中，且状态本就是 planned，判断为尚未开工 |
| daily-crm-analysis (`8d21253a`，planned) | 无 | `zenithjoy/apps/api/src/services/daily-crm-analysis.ts` + `zenithjoy/apps/api/src/services/__tests__/daily-crm-analysis.test.ts` | 高 | 文件名与 feature 名完全一致（同一 slug），status=planned 但代码已存在，建议核实是否该同步更新 feature 状态 |
| Line04飞书客户列表表+单向同步飞书到本地镜像 (`d4e82202`，planned) | 无 | 未找到强候选（`env-registry.ts`/`dropped-feishu-routes.test.ts` 仅间接提及 feishu 客户表环境变量） | 低 | grep 未命中专属实现文件，`dropped-feishu-routes.test.ts` 文件名暗示该功能可能已被下线/合并，需人工确认 |
| wechat-crm-sync (`a88d4eda`，planned) | 无 | `zenithjoy/apps/api/src/services/crm-wechat-sync.ts` | 高 | 文件 slug 与 feature 名一致（顺序颠倒但语义相同），未找到专属测试文件，需人工补测试后再焊 |
| 中台内容红线配置（Prompt/文档位）(`ceaa8602`，planned) | 无 | 未找到候选 | — | grep "内容红线"/"contentGuardrail"/"敏感词" 均无命中，判断为尚未开工 |
| 微信客服 无审批自动回复闭环 (`8bc7fdcd`，planned) | 无 | `zenithjoy/apps/api/src/services/wechat/cs-route-decision.ts` + `zenithjoy/apps/api/src/services/wechat/__tests__/cs-route-decision.test.ts`（配套：`zenithjoy/services/agent/wechat-rpa/auto_reply.py`） | 中 | cs-route-decision 是"该不该转人工"的判断内核，"无审批自动回复"是其上层闭环目标，两者相关但不完全等价，建议人工确认闭环范围 |

### 3.3 客服工作台 / 报表类（5 个）

| feature | 现有锚点及有效性 | 提议锚点 | 置信度 | 依据 |
|---|---|---|---|---|
| 客服工作汇总统计页 (`7b5b403c`，building) | 无 | `zenithjoy/apps/dashboard/src/pages/CsWorkStatsPage.tsx` + `zenithjoy/apps/api/src/services/wechat/__tests__/cs-work-stats.test.ts`（e2e：`zenithjoy/apps/dashboard/e2e/cs-work-stats.spec.ts`） | 高 | 文件名 `CsWorkStatsPage`/`cs-work-stats` 与 feature 名"工作汇总统计页"完全对应，且实现/单测/e2e 三件套齐全 |
| 客服每日工作报告(每日定时固化+历史回看) (`7bf891b8`，building) | 无 | `zenithjoy/apps/api/src/services/wechat/cs-daily-report.ts` + `zenithjoy/apps/api/src/services/wechat/__tests__/cs-daily-report.test.ts`（Dashboard 展示：`zenithjoy/apps/dashboard/src/api/wechat-cs-daily-report.api.ts`） | 高 | 文件名 `cs-daily-report` 直接对应 |
| 客服日报/周报/月报(汇总接收/回复/接待/工时→固化→中台看) (`ee0b211c`，building，ability) | 无 | 同上 `cs-daily-report.ts`（周报/月报暂未发现独立文件，可能与日报共用 `scheduler.ts` 定时机制） | 中 | 日报侧强证据，周报/月报侧仅推测复用同一 scheduler，需人工确认是否已实现周期切换 |
| 桌面租约仲裁层(Desktop Arbiter) (`8358dd63`，building) | 无 | 未找到候选 | — | grep "Desktop Arbiter"/"租约仲裁"/"lease.*arbit" 在两仓均无命中，与其 building 状态矛盾——建议核实该 feature 命名是否已改名或实现是否在未纳入本次文件扫描范围的路径下（如 supervisor/ 目录，本次未逐文件深挖） |
| 客服回复判断内核接入(wechat-cs-reply) (`5778a80a`，done，medium) | 无 | `zenithjoy/apps/api/src/services/wechat/cs-route-decision.ts` + `zenithjoy/apps/api/src/services/wechat/__tests__/cs-route-decision.test.ts`（配套：`context-assembler.ts`） | 高 | feature 名括号内直接点名 `wechat-cs-reply`，cs-route-decision.ts 正是该判断内核的路由决策实现 |

### 3.4 Agent 客户端形态类（4 个）

| feature | 现有锚点及有效性 | 提议锚点 | 置信度 | 依据 |
|---|---|---|---|---|
| agent-python-embedded-installer (`12d572b0`，done) | 无 | `zenithjoy/services/agent/modules/line04/preflight.ts` + `zenithjoy/services/agent/modules/line04/__tests__/wechat-rpa-python-path.test.ts` | 高 | 测试文件名 `wechat-rpa-python-path` 直接对应"python embedded installer"（解决 python 路径嵌入问题） |
| Agent客户端形态收口(悦升云端图标+安装包无窗入口) (`00de40bd`，building） | 无 | `zenithjoy/services/agent/src/tray.ts` + `zenithjoy/services/agent/src/__tests__/tray-fallback-icon.test.ts`（图标资源：`zenithjoy/services/agent/scripts/prepare-base-icon.js`） | 中 | tray.ts 覆盖"图标"部分，"安装包无窗入口"未找到独立测试，需人工确认 |
| AI 思考浮窗(贴靠微信·回复动态流+推理展示) (`22c67be2`，building) | 无 | `zenithjoy/services/agent/wechat-rpa/overlay/overlay_window.py` + `zenithjoy/services/agent/wechat-rpa/tests/test_overlay_window.py` | 高 | 文件名 `overlay_window` 与"浮窗"直接对应，`test_events_writer.py`/`overlay/watchdog.py` 可作补充 workflow_ref |
| 微信客服 窗口可见+不抢焦点+真送达验证 (`1e4ee48d`，working，ability/medium) | `unit_test_path=services/agent/wechat-rpa/tests/test_delivery_verification.py` ✅存在 | 维持现状 | 高 | `test -f` 直接验证通过，且测试内容（focus/送达验证）与 feature 名逐字对应 |

### 3.5 已废弃/planned 但缺候选（4 个）

| feature | 现有锚点及有效性 | 提议锚点 | 置信度 | 依据 |
|---|---|---|---|---|
| 主动发起触达 (`78734deb`，**deprecated**，ability) | 无 | 不提议（已废弃） | — | status=deprecated，跳过 |
| 微信好友扫描→飞书同步→互动频率筛选→客户标记名单 (`88336307`，**deprecated**，ability) | 无 | 不提议（已废弃） | — | status=deprecated，跳过 |
| 微信掉线飞书通知 (`4b051536`，planned) | 无 | `zenithjoy/services/agent/wechat-rpa/auto_reply.py` 中的掉线检测片段 | 低 | 仅在 auto_reply.py 里发现零星"掉线"相关字样，未找到独立"通知飞书"实现或测试，可能尚未开工 |
| 中台转人工设置（转接人+转接条件）(`6739402d`，planned) | 无 | `zenithjoy/apps/api/src/services/wechat/cs-outbound.ts`（转人工执行侧）+ `cs-route-decision.ts`（转接判断侧） | 低 | 关键词"转人工"命中的都是"执行转接动作"的代码，未找到"设置转接人/转接条件"的配置管理界面，判断为尚未实现该配置层 |

### 3.6 社群/朋友圈运营类（4 个）

| feature | 现有锚点及有效性 | 提议锚点 | 置信度 | 依据 |
|---|---|---|---|---|
| 社群运营·微信群(建群/群公告/群内答疑/群发/踢广告) (`03dee814`，planned，ability) | 无 | 未找到候选 | — | grep "群公告"/"踢广告"/"群内答疑" 在两仓均无命中，判断尚未开工，与其 planned 状态一致 |
| 朋友圈制作(定时/手动→AI写文案草稿→审核台→真机发) (`f2913c7a`，planned，ability) | 无 | `zenithjoy/apps/dashboard/src/pages/MomentDraftReviewPage.tsx`（审核台）+ `zenithjoy/apps/api/tests/ws5/send-moment-dryrun.test.ts` + `zenithjoy/services/agent/wechat-rpa/send_moment.py`（真机发） | 中 | 三段（文案草稿/审核台/真机发）分别在不同代码位置找到证据，但状态是 planned，说明可能只搭了骨架未完全打通，建议按"审核台"页面为主锚 |
| 客户朋友圈互动(拉客户朋友圈→AI点赞/评论→真机执行) (`82a9cd0e`，planned，ability) | 无 | 未找到强候选 | — | grep "点赞"/"评论.*朋友圈"/"moment.*interact" 未命中专属实现，与其 planned 状态一致（对应 migration 350 里 GP-E S3 的 capability 格子也全是 gray/red，尚未点亮） |
| Step4 定时朋友圈 LLM 写文案草稿到飞书内容排期表 (`98907c14`，planned） | 无 | `zenithjoy/apps/api/src/services/wechat-draft.ts`（文案草稿生成，含飞书排期表读写） | 中 | wechat-draft.ts 覆盖"LLM 写文案草稿"，"飞书内容排期表"部分证据较弱，需人工确认是否已对接飞书 Bitable |

### 3.7 Line04 早期 Step1-6 系列（飞书 Bitable 版本，7 个）

> 这一组是 Line04 更早期的"飞书 Bitable 三表"实现路线（Step1~Step6），与 3.1~3.6 中较新的"中台 API + Dashboard"实现路线是**两套并存的技术栈**，提案时按字面语义分别搜索，不代表两条路线都在维护。

| feature | 现有锚点及有效性 | 提议锚点 | 置信度 | 依据 |
|---|---|---|---|---|
| Step1 扫码绑个微 + xian-pc NodeJS Agent 启动 (`85d08c6c`，done) | 无 | `zenithjoy/services/agent/wechat-rpa/qr_bind.py` + `zenithjoy/services/agent/src/index.ts`（Agent 启动主入口） | 高 | qr_bind.py 是扫码绑定唯一实现；xian-pc 启动对应 agent/src/index.ts 主进程 |
| Step2 飞书 Bitable 客户档案+营销画像+内容排期 三表初始化 (`c10cbd2d`，planned) | 无 | `zenithjoy/apps/api/scripts/seed-feishu-profile.js` | 低 | 仅找到一个 seed 脚本，"三表初始化"的完整证据不足，需人工确认 |
| Step3 名单内客户私聊 LLM 写回复草稿到飞书互动记录表 (`bb5b6a1f`，done，mature) | 无 | `zenithjoy/services/agent/wechat-rpa/auto_reply.py` + `zenithjoy/apps/api/src/services/wechat-draft.ts` | 高 | auto_reply.py 是"名单内私聊自动回复"主实现，wechat-draft.ts 是"写回复草稿"服务层 |
| Step4 定时朋友圈 LLM 写文案草稿到飞书内容排期表 (`98907c14`) | 见 3.6 | 见 3.6 | 中 | 同上 |
| Step5 飞书审批后 spawn wechat_rpa.py 真发（频控保护+分组可见）(`49d982cc`，done) | 无 | `zenithjoy/services/agent/wechat-rpa/send_moment.py` + `zenithjoy/services/agent/wechat-rpa/rate_limiter.py`（频控） | 高 | send_moment.py 是"真发"实现，rate_limiter.py 对应"频控保护" |
| Step6 发布回执回写飞书排期+互动记录 (`b4edb571`，planned) | 无 | 未找到强候选 | — | grep 未命中"回执回写飞书"的专属实现，判断尚未开工 |

---

## 统计

| 类别 | 数量 | 说明 |
|---|---|---|
| **可直接焊**（高置信度，含 1 条修正路径） | 24 | 含：路径失效需修正 1 条（`388873b3`）、路径存在但语义存疑需改锚 1 条（`0b70f2ff`）、路径已有效维持 2 条（`adc64d68`/`1e4ee48d`）、新候选高置信度 20 条 |
| **存疑**（中/低置信度，需主理人核实语义或范围） | 15 | 中置信度候选，多为"横切件覆盖不全"或"关键词命中但语义偏移" |
| **缺失**（未找到任何候选，或状态明确 deprecated 不需要） | 12 | 含 2 条 deprecated（`78734deb`/`88336307`）跳过 + 10 条真缺失（`crm-platform-connect`/`中台内容红线配置`/`Line04飞书客户列表表`/`桌面租约仲裁层`/`微信掉线飞书通知`/`中台转人工设置`/`社群运营·微信群`/`客户朋友圈互动`/`Step2三表初始化`/`Step6发布回执回写`） |
| **总计** | 51 | 两域范围内全部 feature |

---

## 主理人批阅方式

1. **逐行批阅**（推荐）：每个 feature 后面直接回复"✅第N条"或"❌第N条+理由"，我按批准结果整理成 SQL UPDATE 语句（仍需你二次确认才会真正写库，本文档本身不写库）。
2. **整域通过**：如果对某个大类（如"3.7 Step1-6 系列"整组）已经有判断，直接说"3.7 全通过"/"3.7 全部不焊"即可，我按域内统一规则处理。
3. **特别提醒 3 个需要单独拍板的点**：
   - `CRM 表底座`(`0b70f2ff`) 现有 unit_test_path 语义存疑（测的是 DB schema 不是业务代码），是否改锚到 `crm.ts`/`crm-status-history.test.ts`？
   - `daily-crm-analysis`(`8d21253a`) 代码已存在但 DB 状态仍是 planned，是否需要同步更新 feature 状态？
   - `绑定/安装（共享前置）`(`24a98312`) 是"绑定"+"安装"两个动作合并的横切件，选组合锚还是拆成两个 feature？

（本文档为提案，全程未执行任何 INSERT/UPDATE/DELETE，`journey_features` 表未被写入。）
