# 锚点回填批阅结论（刀C apply器输入）

> 提案原文：`docs/proposals/anchor-proposal-20260719.md`（只读，未写库）
> 批阅方式：主理人 07-19 指令"你看看你继续"——委托 AI 逐行批阅，裁决写入 `decisions` 表（id: `1e153663-c2fb-4823-b313-ddb6e06b3210`）
> 本文档 = apply器的权威输入（哪些 feature 焊、焊什么、哪些暂缓、哪些跳过），仍未写库，apply器实现后按本文档生成 UPDATE 语句

## 裁决原则

- **焊（approve）**：有真实存在的代码文件、语义与 feature 名/promise 原文对应，即使暂缓测试覆盖也先焊实现锚（nightly 锚点哨兵只验路径存在+图内匹配，测试可后补）
- **缓（hold）**：候选存在但语义不完整/横切件覆盖不全/判断内核与上层目标不完全等价——焊错比不焊更有害，会污染断锚计数棘轮，暂不写库，标记「待补证据」
- **跳（skip）**：deprecated 状态，或 grep 未命中任何候选（真缺失，尚未开工）

## 三个特批点裁决

| feature | 裁决 |
|---|---|
| CRM 表底座 (`0b70f2ff`) | **改锚**：原 `packages/brain/src/__tests__/integration/blast-radius.integration.test.js` 测的是 journey_step_links schema 语义不符，改为 `zenithjoy/apps/api/src/routes/crm.ts` + `zenithjoy/apps/api/tests/routes/crm-status-history.test.ts` |
| daily-crm-analysis (`8d21253a`) | **只焊锚，不改 status**：代码存在≠功能验收完成，status 判断留给独立验收流程 |
| 绑定/安装（共享前置）(`24a98312`) | **组合锚，不拆分 feature**：主锚 `qr_bind.py`+`test_startup_selfcheck.py`（绑定侧），副锚 `preflight.ts`+`preflight.test.ts`（安装侧）；拆分是结构性改动超出锚点回填范围 |

## 批准焊入（approve）

| feature_id | feature | unit_test_path 候选 | workflow_ref 候选 | 备注 |
|---|---|---|---|---|
| adc64d68 | 抖音长文发布脚本 | `services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs` | — | 维持现状，已验证存在 |
| 388873b3 | 注册自动登录 | `zenithjoy/apps/api/tests/auth-bridge.test.ts` | — | 修正路径（原路径已失效） |
| f91be81a | 绑本地视频文件夹 | `zenithjoy/services/agent/src/handlers/folder-watch.ts` | — | 暂无专属单测，先焊实现锚 |
| 6b2ab9b5 | 一键发抖音 dryrun | `zenithjoy/services/agent/src/handlers/__tests__/douyin-publish.test.ts` | `zenithjoy/apps/dashboard/e2e/walking-skeleton-1.spec.ts` | |
| 9b56cbae | 首次扫码绑抖音 | `zenithjoy/services/agent/src/handlers/__tests__/qr-bind-douyin.test.ts` | `zenithjoy/apps/dashboard/src/pages/__tests__/DouyinBindPage.test.tsx` | |
| 5fea9715 | Dashboard Agent 下载页 | `zenithjoy/apps/dashboard/src/pages/__tests__/AgentDownloadPage.test.tsx` | — | |
| 2cc21ae5 | Dashboard 显示发布回执 | `zenithjoy/apps/dashboard/src/pages/__tests__/PublishPage.test.tsx` | — | |
| 6691d09a | 消息/动态采集通道 | `zenithjoy/services/agent/wechat-rpa/tests/test_classify_unread_no_drop.py` | — | 家③横切件，被 GP-B/E/F 引用 |
| 7f680eb3 | 接管开关 | `zenithjoy/apps/api/src/middleware/cs-config-guard.test.ts` | — | guard_ref 候选：`cs-config-guard.ts` |
| 39130340 | 记忆库租户隔离（不变量） | `zenithjoy/apps/api/src/services/wechat/__tests__/tenant-memory.test.ts` | `tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts` | |
| ca5fe5ec | 中台 AI-native CRM 客户列表页 | `zenithjoy/apps/dashboard/src/pages/__tests__/CustomerListPage.test.tsx` | `crm-customer-list.spec.ts` | |
| 8a2d2b2f | 客户状态变化历史追踪 | `zenithjoy/apps/api/tests/routes/crm-status-history.test.ts` | — | |
| ca26491c | 客服层多租户隔离 | `zenithjoy/apps/api/tests/regression/line04-cs-tenant-isolation.test.ts` | — | |
| 4fcb5bbd | 客户机按身份拉中台配置土台 | `zenithjoy/services/agent/wechat-rpa/tests/test_cs_config_gate.py` | — | guard_ref 候选：`cs_config_gate.py` |
| 8d21253a | daily-crm-analysis | `zenithjoy/apps/api/src/services/__tests__/daily-crm-analysis.test.ts` | — | 特批点2：只焊锚不改 status |
| a88d4eda | wechat-crm-sync | `zenithjoy/apps/api/src/services/crm-wechat-sync.ts` | — | 无专属测试，先焊实现锚，待补测试 |
| 7b5b403c | 客服工作汇总统计页 | `zenithjoy/apps/api/src/services/wechat/__tests__/cs-work-stats.test.ts` | `cs-work-stats.spec.ts` | |
| 7bf891b8 | 客服每日工作报告 | `zenithjoy/apps/api/src/services/wechat/__tests__/cs-daily-report.test.ts` | — | |
| ee0b211c | 客服日报/周报/月报 | `zenithjoy/apps/api/src/services/wechat/__tests__/cs-daily-report.test.ts` | — | 日报侧强证据，周报/月报暂复用同锚 |
| 5778a80a | 客服回复判断内核接入(wechat-cs-reply) | `zenithjoy/apps/api/src/services/wechat/__tests__/cs-route-decision.test.ts` | — | |
| 12d572b0 | agent-python-embedded-installer | `zenithjoy/services/agent/modules/line04/__tests__/wechat-rpa-python-path.test.ts` | — | |
| 00de40bd | Agent客户端形态收口 | `zenithjoy/services/agent/src/__tests__/tray-fallback-icon.test.ts` | — | 仅覆盖图标部分，安装包入口待补 |
| 22c67be2 | AI 思考浮窗 | `zenithjoy/services/agent/wechat-rpa/tests/test_overlay_window.py` | — | |
| 1e4ee48d | 微信客服 窗口可见+不抢焦点+真送达验证 | `services/agent/wechat-rpa/tests/test_delivery_verification.py` | — | 维持现状 |
| 85d08c6c | Step1 扫码绑个微 + xian-pc NodeJS Agent 启动 | `zenithjoy/services/agent/wechat-rpa/qr_bind.py` | — | 暂无专属单测文件名，先焊实现锚 |
| bb5b6a1f | Step3 名单内客户私聊 LLM 写回复草稿 | `zenithjoy/services/agent/wechat-rpa/auto_reply.py` | — | 暂无专属单测，先焊实现锚 |
| 49d982cc | Step5 飞书审批后 spawn 真发 | `zenithjoy/services/agent/wechat-rpa/send_moment.py` | — | guard_ref 候选：`rate_limiter.py`（频控保护） |
| 24a98312 | 绑定/安装（共享前置） | `zenithjoy/services/agent/wechat-rpa/tests/test_startup_selfcheck.py` | `zenithjoy/services/agent/modules/line04/__tests__/preflight.test.ts` | 特批点3：组合锚，workflow_ref 存副锚 |
| 2dde3bb5 | 后台静默发送通道 | `zenithjoy/services/agent/wechat-rpa/tests/test_uia_send_no_swrestore.py` | — | 与消息采集通道共享 listen_chat.py 实现 |
| 0b70f2ff | CRM 表底座 | `zenithjoy/apps/api/tests/routes/crm-status-history.test.ts` | — | 特批点1：改锚 |

共 **30 条批准焊入**（原提案「24 高置信度」口径 + 6 条存疑经判断可焊；提案头部"51 个 feature"与分域小计存在原文自身的计数误差，以本表逐行裁决为准，不强行凑数）。

## 暂缓不焊（hold，标记待补证据）

| feature_id | feature | 暂缓理由 |
|---|---|---|
| 0d4922c9 | Agent 运行时底座（启动状态恢复·开机自检·保活重连） | 三合一横切件，无单一文件覆盖全部三个动作，待补齐后再焊 |
| d831dd0f | 客户画像卡 | 低置信度，仅在 overlay_window.py 有引用，feature 本身仍是 planned，证据不足 |
| 8bc7fdcd | 微信客服 无审批自动回复闭环 | cs-route-decision.ts 是"该不该转人工"判断内核，与"无审批自动回复闭环"上层目标不完全等价，需先确认闭环范围 |
| f2913c7a | 朋友圈制作 | 三段证据分散（文案草稿/审核台/真机发）且状态仍 planned，可能只搭骨架未打通 |
| 98907c14 | Step4 定时朋友圈 LLM 写文案草稿到飞书内容排期表 | 飞书内容排期表对接证据弱 |

## 不焊（skip）

**deprecated（2，跳过）**：主动发起触达 (`78734deb`) / 微信好友扫描→飞书同步→互动频率筛选→客户标记名单 (`88336307`)

**真缺失（10，尚未开工，grep 未命中任何候选）**：crm-platform-connect (`0e4e1aa9`) / 中台内容红线配置 (`ceaa8602`) / Line04飞书客户列表表 (`d4e82202`) / 桌面租约仲裁层 (`8358dd63`) / 微信掉线飞书通知 (`4b051536`) / 中台转人工设置 (`6739402d`) / 社群运营·微信群 (`03dee814`) / 客户朋友圈互动 (`82a9cd0e`) / Step2 飞书三表初始化 (`c10cbd2d`) / Step6 发布回执回写飞书 (`b4edb571`)
