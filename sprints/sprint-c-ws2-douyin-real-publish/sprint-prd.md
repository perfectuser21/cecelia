# Sprint PRD — Sprint 2.1a · WS2 修架构 + 抖音 video 真发 + Lead 自验

> **Sprint ID**: sprint-c-ws2-douyin-real-publish
> **Initiative ID**: 969f7f8e-4941-4f70-b62d-2a06678f693a
> **Layer**: Sprint（Initiative 下的 Workstream 切片，WS2 = Douyin 发布通路）
> **Planner 版本**: harness-planner v9（Walking Skeleton-aware）

---

## OKR 对齐

- **对应 KR**：Content Creator Pipeline · 多平台真发通路（Douyin / 微博 / 小红书 / 知乎 / 公众号 / 头条）
  - WS1: 微博 / 小红书 publishers · 已 thin
  - **WS2: 抖音 publisher · 当前 skeleton → 本 sprint 推进到 thin（真发跑通）**
  - WS3: 知乎 / 公众号 / 头条 · 后续 sprint
- **当前进度**：抖音 publisher 架构搭起、脚本写完、CDP 链路打通（packages/workflows/skills/douyin-publisher/STATUS.md 标"架构完成，待生产测试"），但**未在生产真账号上端到端真发过 1 条视频**
- **本次推进预期**：从"架构就绪 / mock 通过"推进到"真账号真发成功 + 主理人 ssh 客户机自验通过"，即 thin → medium 临界点

## 背景

**为什么做**：
1. 内容创作 pipeline 已落地 NAS 内容组织（`creator/output/douyin/{date}/video-N/`）+ Mac mini 调度器 + xian-mac 跳板 + Windows PC CDP 自动化，但抖音 video 这条链路**只有架构通**，缺生产真发证据
2. WS2 「修架构」需求来自历史复盘：现有 douyin-publisher SKILL.md 的脚本路径还指向 zenithjoy 老仓 `services/creator/scripts/publishers/`，与 cecelia 的 packages/workflows 边界不一致；NAS 路径在 SKILL.md 写 `creator/output/douyin/`，在 STATUS.md 写 `~/.douyin-queue/`，两份文档不一致
3. 「Lead 自验」是铁律 7 工程化首个落地——禁止"CI mock smoke pass = sprint deliver"，主理人必须 ssh 到 xian-pc 真机走完整客户视角链路

**关联决策**：
- harness-planner v9 强制 Walking Skeleton 5 问 + Lead 客户机自验
- douyin-publisher v1.2.0 决定脚本归属 zenithjoy 仓的统一管理方案——本 sprint 不重新搬迁脚本（不在范围内），但要求 cecelia 这边的 SKILL.md / STATUS.md / FIELDS.md 三份文档对齐

---

## 1. Journey 上下文（v9 — 来自 5 问 Q1）

- **Journey 名称**：Content Creator Multi-Platform Publish Journey（内容创作多平台真发链路）
- **Notion URL**：[ASSUMPTION: 待 walking-skeleton skill `init journey` 落 Notion；现阶段以 PRD + .agent-knowledge 为 SSOT]
- **当前 Maturity**：`skeleton`（端到端跑过一次，但无生产证据，多 publisher 仅 1-2 个真账号验过）
- **Journey Type**：`agent_remote`
- **journey_type 推断依据**：完整链路跨 3 台机器（Mac mini → xian-mac SSH 跳板 → Windows PC CDP → 抖音 Chrome），属"远端 agent 协议 / bridge / cecelia-run"类，不是单纯 dev_pipeline，也不是 user_facing（用户不直接看 dashboard，看 Douyin 平台）
- **端到端步骤**（Journey 共 8 步，本 sprint 推进到 Step 7）：
  - Step 1: 内容创作机生成视频 + 元数据（title / tags / cover）落 NAS `creator/output/douyin/{date}/video-N/`
  - Step 2: Mac mini scheduler 触发拉取 NAS 当日队列
  - Step 3: Mac mini 经 xian-mac 跳板 SCP 文件到 Windows PC `C:\Users\xuxia\douyin-media\`
  - Step 4: Mac mini 通过 xian-mac SSH 调起 Windows PC 的 publish-douyin-video.cjs
  - Step 5: publish-douyin-video.cjs 通过 CDP（19222 端口）连上 Windows Chrome 抖音实例
  - Step 6: Playwright 脚本上传视频 / 填标题标签 / 选公开 / 点发布
  - Step 7: 抖音返回成功，URL 跳转 `creator.douyin.com/content/manage`，retrieve item_id
  - Step 8: 回写发布记录到 cecelia Brain `dev-records` / NAS `published.log`（本 sprint 暂不强求，后续 sprint 完成）
- **E2E Test Path**：`tests/content-pipeline-douyin-e2e.test.js`（本 sprint 新建，从 Step 1 跑到 Step 7，包括 Lead 自验产出的 evidence 截图）

## 2. Feature 清单（v9 — 来自 5 问 Q3）

| # | Feature 名称 | Journey Step | thickness from → to | 备注 |
|---|---|---|---|---|
| 0 | Journey E2E smoke（Step 1 → 7）| 全链路 | new → thin | gating；任一中间 step 必须真链路（不许 mock CDP/不许跳过 SCP）|
| 1 | WS2 架构文档对齐 | Step 1, 3, 4 | broken → thin | SKILL.md / STATUS.md / FIELDS.md 三份文档统一 NAS 路径 + 脚本路径 + 退出码 |
| 2 | 抖音 video 真发跑通 | Step 5 → 7 | skeleton → thin | 真账号、真视频、真 item_id 回执，retry 0 次；publish-douyin-video.cjs 在生产 Windows PC 跑通 |
| 3 | Lead 客户机自验机制 | 全链路 | new → thin | 主理人 ssh xian-pc 走完整客户视角链路，evidence 文件 + 截图 + cmd stdout 摘录归档到 .agent-knowledge |

**范围说明**：本 sprint 不动 publish-douyin-image.cjs / publish-douyin-article.cjs（图文 / 文章已在 STATUS.md 标"成功"，留 WS2 后续 sprint 加深）。

## 3. Feature 0：Journey 端到端验证（v9 — 来自 5 问 Q4，gating）

- **smoke 路径**：`tests/content-pipeline-douyin-e2e.test.js`
- **验证范围**：从 Journey Step 1（内容落 NAS）跑到 Step 7（抖音返回 item_id），共 7 步真链路
- **gating 规则**：Feature 0 FAIL = 整 sprint FAIL，不论 Feature 1/2/3 状态
- **必须真链路的中间步骤**：
  - Step 3 SCP 必须真传文件到 Windows（不许 mock 文件 IO）
  - Step 5 CDP 必须真连 Windows Chrome（不许 mock playwright connect）
  - Step 7 必须 retrieve 到真 item_id（不许硬编码 fake id；item_id 必须来自 `creator.douyin.com/content/manage` URL 跳转后页面）
- **Reviewer 必挑战项**（Proposer 起草合同时必须含）：
  - smoke 真的从 Step 1 跑到 Step 7？没有中间 `exit 0` / `console.log("PASS")` 假装通过？
  - 任一中间 step 真链路（不是 mock）？特别是 SCP 和 CDP 两环节？
  - 失败时是否有清晰的 step 标记（哪一步挂的）？
  - smoke 跑完后 NAS 当日队列是否被标记 `status=published`？

## 4. Lead 客户机自验（v9 — 来自 5 问 Q5，铁律 7）

- **worker_machine**：`xian-pc`（Windows，Tailscale 100.97.242.124；用户 xuxia；CDP 端口 19222；ssh 经 xian-mac 跳板 `ssh -i ~/.ssh/windows_ed xuxia@100.97.242.124`）
  - 1Password CS Vault 凭据条目："Xian PC (node-pc-xian)"
- **checklist**（≥5 步，按客户视角顺序 lead 必须真跑）：
  1. ssh xian-mac && ssh xuxia@100.97.242.124（双跳到 Windows PC）
  2. 确认 Windows Chrome 抖音实例在 19222 端口运行：`curl http://localhost:19222/json | head -20`
  3. 在 Mac mini 触发 publish 命令：`bash batch-publish-douyin.sh $(date +%Y-%m-%d)`，观察 Mac mini 终端输出
  4. ssh xian-pc 看 `C:\Users\xuxia\douyin-media\{date}\video-1\` 目录文件是否真到位（视频 + 标题 + tags + cover）
  5. 在 Windows Chrome 看脚本是否真触发抖音上传 UI（截屏：上传中 / 标题填好 / 发布按钮点击）
  6. 等 1-2 秒看 URL 是否跳转到 `creator.douyin.com/content/manage`，截屏证据
  7. 在 Lead 自己的抖音 App 打开账号主页，看本次发布的视频是否真出现
- **evidence_path**：`.agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md`
  - 必含：cmd stdout 摘录（步骤 2/3 输出）+ 截图 ≥3 张（步骤 5、6、7）+ Lead 签名行（"Cecelia, 2026-05-08, 自验通过"）+ 真 item_id（步骤 6 retrieve）
- **完成判据**：
  - evidence 文件存在 ✅
  - 含 cmd stdout 真输出 ✅
  - 含截图 ≥3 张 ✅
  - 真 item_id 字段非空且不是 `7605861760767233306`（STATUS.md 历史值，必须本次新发的）✅
  - **未自验或 evidence 字段缺/截图为空 = sprint 不能 deliver 给用户测真账号**

## 5. Golden Path（核心场景）

**主路径**：内容生产者把当日抖音视频内容放进 NAS → 触发 batch-publish-douyin.sh → 视频在 1-2 分钟内成功发到抖音真账号 → Lead 在主页看到 → evidence 归档

具体：

1. **触发条件**：NAS `creator/output/douyin/2026-05-08/video-1/` 目录就位（含 title.txt / tags.txt / video.mp4 / 可选 cover.jpg）
2. **Mac mini 调度**：
   - `bash batch-publish-douyin.sh 2026-05-08` 被触发（手动 / cron / Brain 派单皆可）
   - 脚本枚举 `creator/output/douyin/2026-05-08/` 下所有 video-N 子目录
3. **跨机文件传输**：
   - 经 xian-mac 跳板 SCP video.mp4 + 元数据到 Windows `C:\Users\xuxia\douyin-media\2026-05-08\video-1\`
4. **远程执行**：
   - Mac mini 经 xian-mac 调起 Windows 上的 `publish-douyin-video.cjs --content C:\Users\xuxia\douyin-media\2026-05-08\video-1\`
5. **CDP 自动化**：
   - 脚本 connect Windows Chrome 19222 端口，导航 creator.douyin.com，上传视频，填标题，选公开，点发布
6. **可观测结果**：
   - 抖音返回 URL 跳转到 `creator.douyin.com/content/manage`，retrieve item_id（数字字符串）
   - Mac mini 终端打印 `PASS: published item_id=<新 item_id>`，退出码 0
   - 视频 1 小时内通过抖音审核，Lead 在自己 App 主页可见
7. **回执**：
   - publish-douyin-video.cjs 把 item_id + 时间戳追加到 NAS `creator/output/douyin/2026-05-08/video-1/published.log`
   - Mac mini scheduler 把目录标记为 `status=published`（重命名 / metadata file 任一方式）

## 边界情况

- **CDP 连不上 Windows Chrome（19222）**：脚本 exit 2 + 清晰 stderr "CDP unreachable"，Mac mini 不重试更不假装成功；Lead 自验时若遇到，需 ssh xian-mac 跑 `schtasks /run /tn StartAllBrowsers` 重启 Chrome
- **抖音登录失效**：脚本检测 URL 含 `/login` 时 exit 2 + stderr "Session expired, manual scan needed"
- **视频文件不存在 / 损坏**：scheduler exit 1 + stderr "video.mp4 missing"，不进入 SCP
- **同 video-N 目录被重复触发**：通过 NAS 上 `published.log` 是否含 item_id 判幂等；已发不再发
- **空当日队列**：`creator/output/douyin/2026-05-08/` 不存在或为空 → exit 0 + stdout "no work today"，不算失败

## 范围限定

**在范围内**：
- 抖音 video 真发链路（Step 1 → 7）
- 三份文档（SKILL.md / STATUS.md / FIELDS.md）路径与字段对齐
- Lead 自验机制工程化落地（evidence 文件模板 + checklist 模板 + .agent-knowledge 归档目录）
- E2E smoke 测试（tests/content-pipeline-douyin-e2e.test.js）

**不在范围内**（thin scope 决策显式声明）：
- 抖音 image / article 发布（已在 STATUS.md 标"成功"，留 WS2 后续 sprint 加深为 medium）
- 微博 / 小红书 / 知乎 / 公众号 / 头条 publisher（WS1 / WS3 sprint 范围）
- Brain 回写 dev-records（Step 8 留下 sprint 实现）
- 抖音 publisher 性能优化 / 并发发布（thin → medium 时再做）
- Windows PC 上 Chrome 实例的 systemd-equivalent 自启（schtasks 已现存，本 sprint 不动）
- 把 zenithjoy 仓的 douyin-publisher 脚本搬到 cecelia 仓（v1.2.0 决定保留 zenithjoy 统一管理；本 sprint 只对齐 cecelia 这边的文档）

## 假设

- [ASSUMPTION: 抖音真账号本身可登录、未被风控；本 sprint 不处理"账号被封"边界]
- [ASSUMPTION: Windows PC 19222 端口 Chrome 实例本 sprint 期间持续在线（task scheduler 已配 StartAllBrowsers）]
- [ASSUMPTION: xian-mac 跳板机 + Tailscale 链路稳定，不在本 sprint 范围内做高可用]
- [ASSUMPTION: 抖音 web 端 UI 在本 sprint 期间无大改版（XPath `/html/body/div[1]/div[1]/...` 仍有效）；若改版需触发 hotfix sprint 单独处理]
- [ASSUMPTION: Notion AI Journey DB 中 "Content Creator Multi-Platform Publish Journey" 条目可由 walking-skeleton skill `init journey` 后续补建；本 sprint 不阻塞]
- [ASSUMPTION: Lead 自验时主理人本人有 xian-mac SSH key 和 Windows ssh 跳板权限]

## 预期受影响文件

- `packages/workflows/skills/douyin-publisher/SKILL.md`：NAS 路径字段对齐到 STATUS.md（统一为 `creator/output/douyin/{date}/`）；增加 Lead 自验章节链接
- `packages/workflows/skills/douyin-publisher/STATUS.md`：更新真发证据记录（新 item_id + 自验时间 + Lead 签名）
- `packages/workflows/skills/douyin-publisher/FIELDS.md`：补全 video 类型必填字段表 + 退出码定义
- `tests/content-pipeline-douyin-e2e.test.js`：新建 E2E smoke 测试
- `.agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md`：新建 Lead 自验 evidence
- `.agent-knowledge/content-pipeline-douyin/journey.md`：新建 Journey 概念定义文件（walking-skeleton skill 元数据）
- `sprints/sprint-c-ws2-douyin-real-publish/sprint-prd.md`：本文件
- `sprints/sprint-c-ws2-douyin-real-publish/sprint-contract.md`：Proposer 后续起草
- `sprints/sprint-c-ws2-douyin-real-publish/contract-dod-ws2.md`：Proposer 后续起草

---

## journey_type: agent_remote
## journey_type_reason: 完整链路跨 3 台机器（Mac mini → xian-mac SSH 跳板 → Windows PC CDP → 抖音），属远端 agent 协议 / bridge 类，不是 dev_pipeline 也不是单纯 user_facing
