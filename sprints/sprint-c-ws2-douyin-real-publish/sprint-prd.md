# Sprint PRD — Sprint C / WS2：抖音视频真发 + 架构修正 + Lead 自验

**Initiative ID**: 969f7f8e-4941-4f70-b62d-2a06678f693a
**Task ID**: 969f7f8e-4941-4f70-b62d-2a06678f693a
**Sprint Dir**: sprints/sprint-c-ws2-douyin-real-publish
**生成时间**: 2026-05-08

---

## OKR 对齐

- **对应 KR**：内容运营 KR — "把 douyin/小红书/视频号 三大主平台跑成日常可调度的内容发布管线"（Brain context API 离线，按 sprint 名"sprint-c"推断为内容平台 KR；待 Brain 上线后由 Reviewer 校对编号）
- **当前进度**：抖音图文/文章已经在生产跑通，**视频通路标注"架构完成、待生产测试"**，端到端没真跑过一遍。当前估算 KR 抖音子项 ≈ 60%。
- **本次推进预期**：把视频通路从"架构存在"推到"lead 在客户机真发过一条 video 上线"，KR 抖音子项 → 80%（剩下 20% 留给后续稳定运行 + 失败兜底）。

## 背景

抖音 publisher 是 zenithjoy/cecelia 内容发布管线里的关键 worker 之一，三类内容（图文 / 视频 / 文章）已统一迁移到 `zenithjoy/services/creator/scripts/publishers/douyin-publisher/`（changelog 1.2.0，2026-04-11）。但视频脚本 `publish-douyin-video.cjs` 在 SKILL.md 里仍是 "✅ 架构完成，待生产测试" 状态：

1. **架构层未收敛**：当前 3 跳 SCP 链路（Mac mini → xian-mac → Windows PC）在视频文件场景下会反复 base64+scp，对 100MB 级 video 不友好；中转盘缓存目录 `~/.douyin-queue` 在三台机器上各有一份，没人对得上"哪份是 SSOT"。
2. **没有 lead 客户机自验记录**：视频从没在 xian-pc 客户机视角真正走完一次"lead 准备素材 → 触发发布 → 看到内容上线 creator.douyin.com"的端到端链路。CI 里的 mock smoke 不算数（铁律 7：CI 通过 ≠ 客户能用）。
3. **journey 未挂账**：抖音 publisher 的 Walking Skeleton Journey 在 Notion AI Journey DB 里有占位但没有指向 Sprint 的明确 thickness 进度。

本 Sprint 的范围是把 **video 通路** 这一条做到"lead 在客户机平台亲自跑通且留 evidence"，并顺手把架构上影响视频路径的问题修掉（不扩展到图文/文章；不扩展到其他平台）。

---

## 1. Journey 上下文

- **Journey 名称**：抖音内容发布 Journey（Douyin Content Publishing）
- **Notion URL**：（待 walking-skeleton skill `status` 查或 `init journey` 建；本 sprint 内不阻塞，由后续 step 补登）
- **当前 Maturity**：`mvp`（图文+文章已上线，视频未真跑过 → 整条 journey 还没到 production）
- **Journey Type**：`agent_remote` — 链路必须穿越远端 agent（Mac mini → 跳板 xian-mac → Windows PC CDP），关键执行体不在本地
- **端到端步骤**（共 6 步）：
  1. Lead 在 NAS 准备视频素材（title.txt / video.mp4 / 可选 tags.txt / cover.jpg）放到 `creator/output/douyin/<date>/video-<n>/`
  2. Mac mini 调度器拣到该任务，把素材包传到 xian-mac 中转盘
  3. xian-mac 经 SSH+SCP 把素材推到 Windows PC `C:\Users\xuxia\douyin-media\<date>\video-<n>\`
  4. xian-mac 触发 Windows Chrome（CDP 19222）执行 `publish-douyin-video.cjs`，登录态走已有抖音账号 cookie
  5. Playwright 自动化把视频 + 标题 + 标签灌进 creator.douyin.com 发布表单，提交并等 URL 跳到 `/content/manage`
  6. Lead 在 creator.douyin.com 后台 / 抖音 App 内看到该视频已上线，并在归档目录留 evidence
- **E2E Test Path**：`zenithjoy/services/creator/scripts/publishers/douyin-publisher/scripts/smoke-douyin-video-real.sh`（本 sprint 新增；从 Step 1 的素材准备一直跑到 Step 6 的"creator.douyin.com 出现该 itemId"判定）

## 2. Feature 清单

| # | Feature 名称 | Journey Step | thickness from → to | 备注 |
|---|---|---|---|---|
| 1 | 视频素材中转链路收敛（Architecture）| Step 2-3 | thin → medium | 解决 base64 大文件浪费、SSOT 不清；不引入新组件，只修中转盘约定 + 出错码 |
| 2 | 视频真发（Real Publish）| Step 4-5 | new → thin | 现有脚本第一次走完 prod 链路，保证一次跑通；不做重试/断点续传 |
| 3 | Lead 客户机自验 + Evidence 归档 | Step 6 | new → thin | lead ssh xian-pc 真跑一遍，evidence 写入 `.agent-knowledge/douyin-publishing/lead-acceptance-sprint-c-ws2.md` |

**显式不在范围内**：
- 图文 / 文章通路任何改动（已在生产，不动）
- 其他平台（小红书 / 视频号 / 微博 / 公众号）publisher
- 失败重试 / 断点续传 / 多账号并发 / 内容审核兜底（留给后续 sprint）
- 视频转码 / 封面自动生成（lead 提供成品素材即可）

## 3. Feature 0：Journey 端到端验证（gating）

- **smoke 路径**：`zenithjoy/services/creator/scripts/publishers/douyin-publisher/scripts/smoke-douyin-video-real.sh`
- **验证范围**：从 Step 1（NAS 素材就绪）跑到 Step 6（creator.douyin.com 后台出现该视频且 itemId 可追）；中间 4 个 hop（Mac mini SCP → xian-mac SCP → Windows CDP → Playwright 自动化）必须真实发生，禁止任何 hop 用 mock 替代。
- **gating 规则**：Feature 0 FAIL → 整 sprint FAIL。其他 Feature 单独 PASS 也不能 deliver。
- **Reviewer 必挑战项**（Proposer 起草合同时必须明确含）：
  - smoke 是否真的从 Step 1 跑到 Step 6？是否有任何 hop 提前 `exit 0` 假装通过？
  - 任一中间 step 是否走真链路（真 ssh / 真 scp / 真 CDP / 真 Playwright），还是被 stub 掉？
  - 成功判据是否是"creator.douyin.com 出现 itemId"而非"脚本 stdout 印了 PASS"？后者是反模式。
  - 失败时退出码是否 ≠0 且 stderr 含可定位的 hop 名？

## 4. Lead 客户机自验（铁律 7）

- **worker_machine**：`xian-pc`（Tailscale alias；1Password CS Vault "Xian PC (node-pc-xian)" 含 ssh 凭据）
- **checklist**（≥5 步，按客户视角顺序）：
  1. lead 从开发机 ssh 到 xian-mac（跳板）
  2. lead 从 xian-mac 把测试视频素材推到 NAS `creator/output/douyin/<date>/video-test-<sprint>/`
  3. lead 从 xian-mac 触发 `batch-publish-douyin.sh <date>` 或单条 `publish-douyin-video.cjs --content ~/.douyin-queue/<date>/video-test-<sprint>/`
  4. lead 在 Windows PC（xian-pc）上观察 Chrome 自动化窗口走完表单（不能只看 stdout，必须确认 Playwright 真在跑）
  5. lead 打开 creator.douyin.com 后台"内容管理"页确认视频已发布且 itemId 可记录；同时打开抖音 App 搜本账号确认列表里有该视频
  6. lead 把以上 5 步的命令 stdout + 后台截图（≥2 张：creator.douyin.com 列表页 + 视频详情页）整理成 evidence 文件
- **evidence_path**：`.agent-knowledge/douyin-publishing/lead-acceptance-sprint-c-ws2.md`
- **完成判据**：evidence 文件存在 + 含每一步的 cmd stdout 摘录（≥关键退出码） + 含 ≥2 张创作者后台截图 + lead 在文件末尾签名行（"lead self-verified on <ISO timestamp>"）。**evidence 缺任何一项 = sprint 不能 deliver 给用户跑真账号；CI mock smoke 全绿也不算数。**

## 5. Golden Path（核心场景）

Lead 从 **开发机** → 经过 **xian-mac 跳板 → xian-pc Windows Chrome CDP** → 到达 **抖音创作者后台已上线视频**

具体：

1. **触发条件**：lead 在 NAS `creator/output/douyin/<date>/video-test-<sprint>/` 放好 `type.txt=video` + `title.txt` + `video.mp4`（可选 `tags.txt` + `cover.jpg`）
2. **系统处理**：
   a. Mac mini 调度器拣到该目录 → SCP 到 xian-mac 中转盘（中转盘路径在本 sprint 收敛为单一约定值）
   b. xian-mac 经 SSH+SCP 把视频文件 + meta 推到 Windows PC `C:\Users\xuxia\douyin-media\<date>\video-test-<sprint>\`
   c. xian-mac 通过 SSH 触发 Windows PowerShell 启动 `node publish-douyin-video.cjs --content <windows-path>`
   d. Windows Chrome（CDP 19222，已扫码登录的抖音账号）被 Playwright 接管 → 走完 6 步发布流程（导航 → 上传 → 填标题/标签 → 选立即发布 → 确认 → 等跳转 `/content/manage`）
3. **可观测结果**：
   - Playwright 脚本 stdout 印 `PUBLISHED itemId=<19位数字>` 并 exit 0
   - creator.douyin.com 后台"内容管理"页出现该视频，状态 = 已发布 / 审核中
   - 抖音 App 在该账号主页可搜到该视频
   - `.agent-knowledge/douyin-publishing/lead-acceptance-sprint-c-ws2.md` 由 lead 写入完整 evidence

## 边界情况

- **视频文件 > 500MB**：本 sprint 不优化，超大视频走原 SCP 流程容忍慢即可；如果 SCP 失败必须 stderr 有明确"上传到 windows 失败"提示，不能静默
- **Windows Chrome CDP 断开 / 登录态失效**：脚本必须 exit ≠0 + stderr 含"CDP unreachable" 或 "session expired"，不能 silent retry 假装成功
- **重复发布同标题**：抖音侧会拒绝（duplicate）—— 本 sprint 接受这个错误码并 propagate 上来，不在本地去重
- **NAS 中转盘三机不一致**：Feature 1 的核心，把"Mac mini 视角的中转盘 vs xian-mac 视角的中转盘 vs Windows 视角的素材落地"三层路径在本 sprint 内统一记录到一份 README，三方使用同一份变量名约定
- **抖音平台审核延迟**：发布后 creator.douyin.com 后台可能短期显示"审核中"。本 sprint 接受"审核中"作为发布成功（lead evidence 截图标注"审核中" 也算通过；不要求等到"已发布"）

## 范围限定

**在范围内**：
- 抖音 video 通路（脚本：`publish-douyin-video.cjs`）的架构修正 + 真实生产发布 + lead 自验 evidence
- 中转盘路径约定 README（位于 `zenithjoy/services/creator/scripts/publishers/douyin-publisher/ARCHITECTURE.md`）
- E2E smoke 脚本（`smoke-douyin-video-real.sh`）从 Step 1 跑到 Step 6
- Lead 自验 evidence 文件 + 配套 checklist 模板

**不在范围内**：
- 抖音图文 / 文章通路改动（保持现状，不动）
- 其他平台 publisher（小红书 / 视频号 / 微博 / 微信公众号 / 头条 / 快手 / 知乎）
- 视频转码 / 封面自动生成 / 内容审核侧逻辑
- 失败重试 / 断点续传 / 多账号并发 / 配额管理
- Brain 端调度器逻辑（`creator-publisher-orchestrator` 之类）— 本 sprint 假定 orchestrator 已能拣到 video 目录并触发，只验证下游链路

## 假设

- **[ASSUMPTION-1]**：xian-pc Windows Chrome 在 CDP 19222 端口持续可达（启动任务由 `StartAllBrowsers` 自启动管理，本 sprint 不验证启动逻辑，只在 smoke 失败时报"CDP unreachable"）
- **[ASSUMPTION-2]**：xian-pc 抖音账号已扫码登录且 cookie 至少在本 sprint 跑完前不过期（lead 自验前 lead 自己确认登录态新鲜）
- **[ASSUMPTION-3]**：1Password CS Vault "Xian PC (node-pc-xian)" 条目对 lead 可访问（凭据通过 credentials skill 拉取，不硬编码）
- **[ASSUMPTION-4]**：测试视频素材由 lead 自备（≤30s、≤50MB、内容合规、避开抖音审核敏感词）—— 不在本 sprint 范围内造素材
- **[ASSUMPTION-5]**：Brain context API 临时离线，OKR 编号在 PRD 内仅描述性引用；Reviewer / Proposer 阶段需在 Brain 恢复后回填精确 KR 编号
- **[ASSUMPTION-6]**：Notion AI Journey DB 中"抖音内容发布 Journey"页面在本 sprint 内由 walking-skeleton skill 异步建立 / 更新，不阻塞本 PRD 出案

## 预期受影响文件

> 仅描述受影响范围；具体新增/修改路径由 Proposer 在合同 GAN 阶段从 Golden Path 倒推。

- `zenithjoy/services/creator/scripts/publishers/douyin-publisher/publish-douyin-video.cjs`：现有脚本，可能微调以兼容收敛后的中转盘路径
- `zenithjoy/services/creator/scripts/publishers/douyin-publisher/ARCHITECTURE.md`：**新增**，三机中转盘路径与变量名 SSOT
- `zenithjoy/services/creator/scripts/publishers/douyin-publisher/scripts/smoke-douyin-video-real.sh`：**新增**，Feature 0 的 E2E smoke
- `zenithjoy/services/creator/scripts/publishers/douyin-publisher/batch-publish-douyin.sh`：可能微调以读统一中转盘约定
- `.agent-knowledge/douyin-publishing/lead-acceptance-sprint-c-ws2.md`：**新增**，lead 自验 evidence 归档
- `packages/workflows/skills/douyin-publisher/STATUS.md`：状态从"待生产测试"更新为"已在生产真发过 video 一次"
- `packages/workflows/skills/douyin-publisher/SKILL.md`：视频行状态字段更新

## journey_type: agent_remote
## journey_type_reason: 链路必须穿越远端 agent（Mac mini → xian-mac 跳板 → Windows PC CDP），关键执行体不在本地，且 lead 自验铁律 7 强制要求在远端客户机 xian-pc 真跑
