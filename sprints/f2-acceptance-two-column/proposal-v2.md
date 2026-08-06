# 发版验收一体两面——F2 步2 加厚「一张表两列背靠背合着看」Golden Path v2

提案人：Cecelia（AI）。v2 = 对 r1 三镜头（tech / product / risk）合并 findings 的逐条修订轮：**7 P0 / 14 P1 全部回应，8 P2 记账**。

- **归位**：工厂 · F2 部署闭环（journey `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`）· 步2「部署被证明没坏」· 动作=**加厚**（非新路）
- **GP_ID**：`7790f728-f490-4243-b166-03f3250a0938`（golden_paths，candidate）
- **法源**：决策 `fdeb48aa` 六条（一字为法，本提案不得改写其语义）；④「移交节奏」Phase 2+ 只登记
- **现状依据**：`.harness/explore-report.md` + 本轮为核销 findings 新增的直接读码/实测（新增部分逐条标「v2 实测」）

---

## 0. 相对 v1 的结构性变化

| # | 变化 | 回应 |
|---|---|---|
| 1 | **实现路径改判**：本 GP 不进 harness 主链，按交付物拆成多个 `/dev` 任务（新判定点 **J13**）。连带作废 v1 的 J11-A「措辞分区」与 J3-A「mac_web 执行体」两条 | → tech#P0-1、tech#P0-2、tech#P1-2 |
| 2 | **新增「两列九组合裁决矩阵」整节**：人列三态 × AI 列三态画全，每组合定最终态与闸判据；闸判据由「任一红则拦」改为「**未拿到确定绿则拦**」 | → product#P0-1 |
| 3 | **run 状态机改造进交付物**（新增 `human_complete`/`adjudicated`/`stale`，`passed` 不再是放行判据） | → product#P0-1、product#P2-2 |
| 4 | **放行闸加 sha 绑定断言 + backend_sha 双源对账**（第二源=构建侧 GitHub API，不吃被测系统自报） | → product#P0-2、risk#P1-2 |
| 5 | **Gate A 从「三层规范」改为「四层机械剥夺」**：打表器执行环境换成 GitHub 托管 ubuntu runner（无真机车道 label、secrets 白名单、Playwright 域名 allowlist），能力层剥夺而非事后 SQL | → risk#P0-1 |
| 6 | **取消格级 waive**：hard 红线格不可豁免；只保留 `bypass_two_column_infra`（仅 infra 故障生效，机械区分 `cells_red`），并加棘轮与计数 | → risk#P0-2、risk#P1-4 |
| 7 | **防锚定出口清单补全为 9 条**（含公网 5223、`GET /runs?gp_id=`、`GET /runs/:run_key` 默认态、repo 内 `ai-column.json`），A2 逐出口断言 | → risk#P0-3、risk#P2-1、risk#P2-2 |
| 8 | **取消 dry_run**：改「独立脚本四情形 + selftest workflow + 首次真实 promote 日志」三段取证，生产放行闸不新开旁路、不改生产 run 状态 | → tech#P1-3、tech#P1-4、risk#P1-1 |
| 9 | **建单生成器 kind 来源定案**（yaml 显式 `kind` 字段 + schema required，新判定点 **J14**） | → tech#P1-1 |
| 10 | **新增员工侧两个断点的挂片**：待办角标信号（Step 1）、裁决理由回显（新 Step 6） | → product#P1-1、product#P1-3 |
| 11 | **新增仪式定义**（发起人/频率/工时预算，新判定点 **J16**） | → product#P1-2 |
| 12 | **分流建任务改为聚合式 + 熔断**：每 run 至多 1 个 bug 任务 + 1 个追查任务，红格占比超阈值改开「规程分叉」P0；A7 分母改用 SQL 直算不手算 | → product#P1-4、risk#P1-3 |
| 13 | **冻结锁加规程版本锁**（`spec_sha` + `version`，改版即 stale） | → product#P1-5 |
| 14 | **AI 列改用与人列同一套中文三值枚举**，消掉词表映射层 | → tech#P2-2 |
| 15 | **v2 新发现并纳入交付物**：`submitAcceptanceResults` 的 `UPDATE ... WHERE check_key = $4`（`routes/acceptance.js:62-66`，v2 实测）不带 `run_id`——J5-A 把 check_key 改成 per-run 格号后会跨 run 串写，A3 加隔离断言 | 提案人自查 |
| 16 | 误触达恢复 SOP、device/scenario 员工可见、A4 变量名、grep 退出码、Gate B 前推 —— 见对应节与 P2 记账 | → risk#P1-5、product#P2-1、tech#P2-1、tech#P2-3、tech#P2-4 |

---

## R1 核销台账

> 处置只有两种：**核销@节名**（提案已改）或 **REFUTED+证据**。本轮 **29 条全部核销，0 条 REFUTE**（两条附证据修正，但不改变 finding 成立性，仍按核销处置）。

| id | 处置 |
|---|---|
| tech-P0-1（target_environment 无 override，L3 物理不可达） | 核销@**J13 实现路径** + §交付物：改走 `/dev`，harness 主链不参与，依赖消除。理由不是「不重要」而是「即使参数化也解不开」——`golden-path-contract-task.js:1-2` 两个常量（`GP_HARNESS_BASE_REPO`=cecelia.git、`GP_HARNESS_TARGET_ENVIRONMENT`='local_api'）都是唯一写入点（v2 实测 grep 全仓仅 `golden-path-contracts.js:397,398` 各一处消费），本 GP 过半交付物落 zenithjoy-workspace，只改 env 不改 base_repo 依旧做不了。harness 侧参数化转 P2 记账 P2-9 |
| tech-P0-2（theater 闸 substring 挡不住） | 核销@**J11 重写 + J13**：闸只在 `runMechanicalGate` 内、只对 harness judge 链生效（v2 实测 `harness-judge.js:690,782` ← `routes/harness.js:19` 唯一调用方），走 `/dev` 则整条闸不在路径上。同时明确**不改闸**（不走候选 B），闸本身是对的 |
| tech-P1-1（37 格建单缺 kind 映射） | 核销@**J14 kind 来源** + D1：yaml 每格补显式 `kind`，`line02-android.schema.json` 设 required，生成器不做语义猜测 |
| tech-P1-2（GP 段提取兜底陷阱：无标题则全文被扫、`###` 不终止段落） | 核销@**J11**：走 `/dev` 后不产 `sprint-prd.md`/`contract-draft.md`，该兜底路径不在本 GP 路径上；同时记 P2-10 供 harness 侧修 |
| tech-P1-3（A7 四情形无编排，需改生产 run 状态） | 核销@**J9 重写 + A8**：四情形改由独立脚本对**只读 gate 端点的构造响应**跑（`--fixture` 模式，不碰生产 PG），接线由 selftest workflow + 首次真实 promote 日志证明 |
| tech-P1-4（dry_run 是生产放行路径新旁路 / concurrency 占用） | 核销@**J9**：取消 dry_run，不动 `promote-all-prod.yml` 的 job 依赖与 `concurrency: promote-prod` |
| tech-P2-1（A4 变量名 37/17 自相矛盾） | 核销@**A4**：改 `:human_only_17_list`，并在 A4 内写死 17 的来源（v2 实测 yaml 解析：37 有效格 = human_only 17 + machine_db 20） |
| tech-P2-2（中英枚举需词表映射） | 核销@**J6 + D1**：AI 列复用人列中文枚举 `通过/不通过/无法验证`，DB 加同款 CHECK，映射层消失（回写端点做一次性翻译） |
| tech-P2-3（`grep -c` 零命中退出码 1，`set -e` 误判） | 核销@**A2**：断言写法统一为 `test "$(… | grep -c -E … || true)" = "0"` |
| tech-P2-4（Gate B 可前推：5223 在跑且 401） | 核销@**Gate B**：已吸收该实测，Gate B 剩余待办收窄为「公网可达性 + gate 端点鉴权形态」 |
| product-P0-1（人列第三态「无法验证」整块缺失，红线格可被绕过；`passed` 不可达） | 核销@**§两列九组合裁决矩阵** + **J1 重写** + **D1 状态机改造**：9 组合画全、闸判据改「未拿到确定绿则拦」、区分合法/故障 unverifiable、run 状态机新增 `human_complete/adjudicated/stale`（v2 实测 `acceptance.js:88` 三元式与 `acceptance_runs_status_check` 只许 4 值，均属实） |
| product-P0-2（放行闸未绑定构建，旧绿单可放行新构建） | 核销@**A9 + J12 + D5**：gate 断言 `PROMOTE_SHA == run.backend_sha`，PROMOTE_SHA 用与 `promote-backend` 同一解析算法（`promote-all-prod.yml:167,183-184`，v2 实测 `INPUT_SHA` 或 `origin/main` HEAD） |
| product-P1-1（员工无「该干活了」信号） | 核销@**Step 1 挂片 + A13**：侧边栏待办角标（v2 实测 `apps/staff-hub/src/App.tsx:46-48` 确为纯文本 NavLink）+ 仪式发起通知 |
| product-P1-2（决策⑥仪式未落地：无发起人/频率/工时） | 核销@**J16 + §仪式**。附证据修正（不影响 finding 成立）：`explore-report.md:160` 的真机车道红是 CI `account-scan` 车道，S12 由员工手持真机执行，不依赖该车道；但仪式工时确实未评估，按 finding 核销 |
| product-P1-3（裁决结论对员工不可见） | 核销@**新增 Step 6** + **A6 第 4 张截图**（员工身份登录看到裁决人/理由） |
| product-P1-4（A6 分母漏「裁决红」且自相矛盾） | 核销@**A7 重写**：不再手算分母，改「每 run ≤1 bug + ≤1 追查」聚合式，SQL 直接对最终态计数 |
| product-P1-5（规程改版对在跑 run 无处理） | 核销@**J12 + A10**：`acceptance_runs.version` 存 yaml `version`，`detail.spec_sha` 存 yaml 内容 sha256，任一变更 → run 转 `stale`、提交 409 |
| product-P2-1（员工无法预知哪些格自己也验不了） | 记账 **P2-5**（并入 D4 页面小改：device + scenario_required 标记进 yaml 与展示层） |
| product-P2-2（未盘既有 run 状态机） | 已随 product-P0-1 一并核销@**D1 状态机改造**（升格处理） |
| risk-P0-1（Gate A 不 fail-closed，ssh 逃逸宿主） | 核销@**Gate A 四层机械剥夺** + **J3 改判 B** + **A11**：打表器改跑 GitHub 托管 ubuntu runner，不经 `host-executor.js` 的宿主逃逸 |
| risk-P0-2（waive 会豁免 hard 红线格） | 核销@**J15 逃生阀形态**：本期不提供格级 waive；`bypass_two_column_infra` 只在 gate 自判 `infra_error` 时生效，`cells_red` 时忽略输入仍 exit 1（A8 第 4 情形直接断言这条） |
| risk-P0-3（防锚定漏两条已存在出口） | 核销@**§AI 列出口清单（9 条）** + **A2 重写**：裁剪落在 `loadChecks`/`loadRunsWithChecks` 的 SQL 列白名单（默认不 SELECT AI 四列），新增端点自动安全 |
| risk-P1-1（dry_run 绕过 confirm，A7 不断言生产未变） | 核销@**J9**：取消 dry_run，confirm 闸原样保留 |
| risk-P1-2（backend_sha 单一来源，只验格式） | 核销@**J12 + A9**：源① staging 新增 `/api/version`（现 `/api/walking-skeleton/version` 404，v2 实测），源② `deploy-us-vps.yml` 最近成功 run 的 `headSha`；两源不等 → 拒绝建单 |
| risk-P1-3（分流建任务拆掉去重护栏、无熔断） | 核销@**A7 + D4**：聚合式建单保留「同 run_key 无未终态任务」查重（`acceptance.js:100-106`），红格占比 >1/3 触发熔断改开「规程/数据源疑似分叉」P0 |
| risk-P1-4（waive 无可观测无棘轮） | 核销@**A12 + J15**：bypass 次数与 hard 格「裁决绿」次数双计数，近 30 天 >3 次 → gate 直接红 |
| risk-P1-5（误触达真人无恢复 SOP） | 核销@**§出错路径表**新增第 5 行（含红线7 暗号已发出的处置序列） |
| risk-P2-1（`GET /runs/:run_key` 默认态未规定） | 核销@**A2 第 4 条**（默认态=员工态，AI 四列必须缺席；合看态需 `?view=review` + 服务端校验），已从 P2 升格进断言 |
| risk-P2-2（证据含真实 PII 且落 git） | 核销@**Gate A 第④层 + A2 第 9 条**：AI 列产物本期只 POST 进 DB，repo 侧不再 commit `ai-column.json`，截图走 artifact 不进 git |

---

## Gate A · 边界硬约束（fail-closed，能力层剥夺）

**AI 打表器只走 staging 后台网页，不碰真机、不发私信、不触达任何真实抖音/微信账号。**

真实接缝清单（`explore-report.md:136-144`）7 条接缝一条都不碰。v1 的「提示词 / 断言 / 代码闸」三层被 risk#P0-1 击穿——三层里没有一层**剥夺能力**，而 v1 选的 mac_web 执行体恰恰是能力最强的那个（`host-executor.js:9-13,28-33` ssh 逃逸到宿主 `administrator@host.docker.internal`，宿主持有 `~/.credentials/` 与连 xian-rog/xian-pc 的 key）。v2 改为四层，**前两层是机械约束，后两层才是自觉与事后**：

| 层 | 落法 | 机械性 |
|---|---|---|
| ①执行环境剥夺 | 打表器 job 固定 `runs-on: ubuntu-latest`（GitHub 托管），**禁止** `self-hosted` / `android-capable` label。手机池只经 self-hosted 车道可达（`nightly-android-fleet-pc4.yml:36,114`，explore-report.md:159），托管 runner 与手机池不在同一网络，物理上够不着真机 | 机械（workflow 文件可 grep 断言） |
| ②凭据剥夺 | 该 job 的 `secrets` 引用白名单只允许 `STAGING_ACCEPTANCE_EMAIL` / `STAGING_ACCEPTANCE_PASSWORD` / `ACCEPTANCE_API_TOKEN`；**禁止** `TAILSCALE_AUTHKEY` / `HK_VPS_SSH_KEY` / 1Password token。判官侧同理：判定任务跑在 Brain docker 容器内（`executeInDocker`），不走 `executeOnHost` | 机械（smoke 脚本 grep 白名单，A11） |
| ③网络 allowlist | Playwright `page.route('**', …)` 只放行 `staging-autopilot.zenjoymedia.media`，其余 host 一律 abort；`checkCellsMapComplete`（`capture.mjs:61-67`）保留，白名单外格号拒绝执行并写「无法验证」 | 机械（单测 A11-c） |
| ④产物约束 | 证据截图与文本快照走 CI artifact，**不 commit 进 repo**（现 `acceptance-spec/runs/*/ai-column.json` 含真实线索 PII，risk#P2-2）；结论只 POST 进 DB | 机械（`git ls-files` 断言，A2 第 9 条） |
| ⑤事后核对 | 断言 **A4**（17 个 human_only 格恒「无法验证」）+ **A11**，作为兜底不作为主防线 | 事后 |

**S12 全 4 格 + S13-c1/c3 等需安卓真机的 6 格，AI 列恒为「无法验证」，不允许出现「通过」**——这是 Gate A 的设计输出。

## Gate B · 前置探明（开工第一件事，半天内出结论，不过则改道）

放行闸第三证据项的取数通路。v1 的未知项已被 tech#P2-4 前推：本机 5223 **确在监听**且 `/health` 返 401（token 已配、fail-closed 逻辑属实，`acceptance-public-server.js:47-57`）。剩余待探明收窄为两条：

1. 5223 **公网可达性**（GitHub ubuntu runner 能否打通）；
2. gate 端点鉴权形态（复用 `ACCEPTANCE_API_TOKEN` 还是单独只读 token）。

- 结论 **通** → 按 J7-A（5223 加只读 gate 端点，token 走 GH secret）。
- **不通** → J7-B（Brain 定案时反向 push commit status 到 zenithjoy repo），D5 形态随之变化。
- 两条都不通 → 第三证据项降级为人工填写，并升级给主理人重新拍板。

---

## 两列九组合裁决矩阵（决策①③⑥的机械口径）

人列枚举 `通过/不通过/无法验证` 是 DB 强约束（`acceptance_checks_result_check`，v2 实测），AI 列 v2 起复用同一套枚举（J6）。两列各含「未填/未跑」的空态，故实为 4×4，其中空态统一归 **Q0**。

**AI 侧「无法验证」必须再分两类**（写进 `ai_evidence.reason`）：
- **合法无法验证**：`human_only`（17 格，Gate A 设计输出）、`scenario_not_triggered`（6 个 scenario_required 格）
- **故障无法验证**：`page_unreachable` / `login_failed` / `timeout` —— 打表器本该能判却没判，**不得当作绿的通行证**

| 组合 | 人列 | AI 列 | 名称 | 最终态 | 一般格动作 | hard 红线格闸判据 |
|---|---|---|---|---|---|---|
| Q1 | 通过 | 通过 | 双绿 | **绿** | 无 | 放行（唯一无需裁决的绿） |
| Q2 | 通过 | 不通过 | 分歧（AI 红人绿） | 未定 | 必须裁决 | **拦**，除非裁决绿 |
| Q3 | 通过 | 合法无法验证 | 仅人列绿 | **绿** | 无 | 放行（S2-c4/S12-c4 等 human_only 红线格的正常绿路径） |
| Q3′ | 通过 | 故障无法验证 | 人绿·AI 哑火 | 未定 | 重跑打表器；重跑仍哑火→裁决 | **拦** |
| Q4 | 不通过 | 通过 | 分歧（AI 绿人红） | 未定 | 追查任务（优先信人） | **拦**，除非裁决绿 |
| Q5 | 不通过 | 不通过 | 双红 | **红** | bug 任务 | **拦**（裁决绿需写补偿措施并自动开 P0） |
| Q6 | 不通过 | 无法验证 | 人红独判 | **红** | bug 任务 | **拦** |
| Q7 | 无法验证 | 通过 | 人未验·AI 绿 | 未定 | 追查任务（为什么人验不了） | **拦** |
| Q8 | 无法验证 | 不通过 | 人未验·AI 红 | **红** | bug 任务 | **拦** |
| Q9 | 无法验证 | 无法验证 | 双盲 | 未定 | 「补验证手段」任务 | **拦** |
| Q0 | 未填 | 任意 | 不完整 | 未定 | Step 4 不解锁 | **拦**（run 到不了 `human_complete`） |
| Q0′ | 任意 | 未跑 | AI 列缺格 | 按人列单列判：通过→绿，不通过→红，无法验证→未定 | 单独重跑打表器补格 | **拦**（缺格视同未拿到确定绿） |

**闸判据（v1「任一红则拦」→ v2「未拿到确定绿则拦」）**：
> 一格的最终态为**绿**，当且仅当它落在 Q1、Q3，或经主理人裁决 `verdict='绿'`。其余（红、未定、缺格、空态）一律**拦**。
> 8 个 hard 红线格（v2 实测：S2-c4 与 S12-c4 为 human_only，S5-c4/S6-c4/S8-c4/S10-c4/S11-c4/S13-c4 为 machine_db，其中 S5-c4/S10-c4/S13-c4 带 `scenario_required`）不可被任何 `bypass` 豁免；hard 格的唯一逃生阀是**有名有姓的裁决**（记录裁决人/理由/时间，计入棘轮 A12）。

**`passed` 不再是放行判据**：现行 `status = pending>0?'in_review':fail>0?'failed':pass===total?'passed':'in_review'`（`acceptance.js:88`，v2 实测）里，只要有一格「无法验证」，`pass===total` 永假 → `passed` 物理不可达。D1 改为新状态机（见交付物）。

---

## AI 列出口清单（防锚定裁剪的完整靶面）

裁剪**不是逐端点打补丁**，而是在 `loadChecks`（`acceptance.js:151`）/`loadRunsWithChecks`（`:157,164`）的 SQL 层做**列白名单**：AI 四列默认不 SELECT，只有显式 `view='review'` 且服务端校验该 run 已达 `human_complete` 才 SELECT。这样**新增端点默认安全**（对比 v1 只点了 3 个出口，被 risk#P0-3 打穿）。

| # | 出口 | 现状（v2 实测） | 处置 |
|---|---|---|---|
| 1 | 内网 5221 `GET /acceptance/pending` | `:303`→`loadPendingRuns`→`SELECT *` | 列白名单 |
| 2 | 内网 5221 `GET /acceptance/runs?gp_id=` | `:265-274`，不过滤 status，填表期 pending run 带全量 checks | 列白名单 |
| 3 | 内网 5221 `GET /acceptance/runs/:run_key` | `:277-289`→`loadChecks`→`SELECT *` | 列白名单 + 默认态=员工态 |
| 4 | **公网 5223 `GET /acceptance/pending`** | `:332-340`，与内网共用 loader | 列白名单（同一 loader 一次改到位） |
| 5 | 公网 5223 `GET /acceptance/catalog` | `:317-330`，只回 catalog 不含 checks | 登记，无需改 |
| 6 | Staff Hub 反代 `/api/staff/acceptance/*` | `services/acceptance.ts:52` 整数组直出 → `staff.ts:319` 整包展开 | 反代层同步白名单（双保险） |
| 7 | 新增的 gate 只读端点（D5） | 不存在 | 只回 `{run_key, backend_sha, spec_sha, status, gate_verdict, red_cells[]}`，**不回 AI 列原文** |
| 8 | **repo 内 `acceptance-spec/runs/*/ai-column.json`** | 两轮历史产物已在 git 里，员工 clone 即可见 | 本期起不再 commit（Gate A 第④层） |
| 9 | psql 直查 | 员工无 DB 账号（Staff Hub 走飞书白名单身份，`middleware/staff.ts:44`） | 登记为组织约束，不做代码闸 |

---

## Golden Path 步骤

主体：**发版人 / 验收员工 / 主理人**。步骤名写「他感知到什么」，工序细节全部下沉到【挂片】【分支/判定点】。

| 步骤（承诺） | 现状 | 验证等级承诺 | 【挂片】 | 【分支/判定点】 |
|---|---|---|---|---|
| **Step 1** 发版人发起这一轮验收后，员工当天在待办里就看到一张属于这个构建的单子，单头写着它验的是哪个构建、哪一版规程 | **半成** | L2（服务端真验） | run 建单端点幂等(已有，`acceptance.js:183`)／37 有效格从规程展开成行(**缺失**，缺口1.5)／每格 `kind` 来源(**缺失**，yaml 全文零个 kind 字样，J14)／构建号双源对账写进单头(**缺失**，`/api/walking-skeleton/version` v2 实测 404，`backend_sha` 恒 unknown)／规程版本锁 `version`+`spec_sha`(**半成**，`acceptance_runs.version` 列已有但没人写)／侧边栏待办角标(**缺失**，`App.tsx:46-48` 是纯文本 NavLink)／仪式发起通知(**缺失**) | 分支：同构建已有 run → 幂等复用不重开；两源 sha 不等 → **拒绝建单**并告警。判定点 **J5**（格号）／**J10**（na 格）／**J12**（冻结锁）／**J14**（kind）／**J16**（仪式） |
| **Step 2** 员工上班之前，AI 已经把它能在网页上看见的那部分先看过一遍；看不见的它老实说看不见，还说得出为什么看不见 | **半成** | **L3（真环境真验）** | 采证器走真 staging UI + 截图 + `innerText`(**已有且有 2 轮真实产物**，`capture.mjs:32,54-57`)／常驻登录凭据(已有，1Password CS)／自动触发(**缺失**，全仓无 workflow/npm script，`capture.mjs:236` 硬编码 `trigger:'manual'`)／结论回写同一张表(**缺失**，产物落 repo 与 DB 零通路)／合法 vs 故障「无法验证」分类(**缺失**)／Gate A 四层机械约束(**缺失**) | 分支：某格页面打不开 → 记 `page_unreachable`（**故障类**，不享受 Q3 绿通道），不中断整轮。判定点 **J3**（执行体）／**J4**（诚实边界）／**J15**（逃生阀） |
| **Step 3** 员工打开验收页，看到的还是那张熟悉的表；AI 那一列此刻对他根本不存在，翻 F12、换端点、走公网都翻不出来 | **半成** | L2（服务端真验） | 三个页面(**已有**，路由 `App.tsx:66-68`)／分批草稿增量提交(已有)／`submitted_by` 防伪注入(**已有且有测试**，`middleware/staff.ts:44`→`staff.ts:338`)／**服务端列裁剪(完全缺失**，三跳全裸：`acceptance.js:157,164` `SELECT *` → `services/acceptance.ts:52` → `staff.ts:319`)／9 条出口逐条覆盖(**缺失**) | 分支：员工只填一半离开 → 草稿按子集留存（既有）。判定点 **J2**（可见时机）／**J6**（存储形态与裁剪位置） |
| **Step 4** 员工把最后一格交上去的那一刻，两列一起亮出来，哪些一致、哪些打架、哪些两边都没验成，一眼看清 | **缺失** | **L3（真浏览器真页面截图）** | 九组合矩阵合看页(**缺失**，全仓 grep「对比页\|四象限」非 md 零命中)／`human_complete` 解锁态(**缺失**)／AI 缺格降级态(**缺失**)／需真机/需场景的格在填表页提前标出(**缺失**，`device` 列已有已渲染，`scenario_required` 只在 `cells-map.mjs:23-67`) | 分支：AI 列缺格 → Q0′ 按人列单列判，且不得算作 hard 格的绿。判定点 **J1**（放行分母）／**J8**（这页从哪打得开） |
| **Step 5** 打架和没验成的格子主理人当场拍板；拍完这一版验收就有了定论，定论跟着构建号和规程版本一起存档 | **缺失** | L2（服务端真验） | `adjudication` 字段与裁决 API(**缺失**，`\d acceptance_checks` 无此列)／裁决人与理由留痕(**缺失**)／run 状态机 `adjudicated` 与 `gate_verdict`(**缺失**，`acceptance_runs_status_check` v2 实测只许 4 值)／hard 格裁决绿自动开 P0(**缺失**) | 分支：Q5/Q6/Q8 → bug 任务；Q4/Q7 → 追查任务；Q9 → 补验证手段任务；红格占比 >1/3 → 熔断改开「规程分叉」P0。判定点 **J1**／**J15** |
| **Step 6** 员工回到同一页，能看到主理人怎么判的、为什么这么判——尤其是自己判红被推翻的那几格 | **缺失** | L2（服务端真验） | 员工身份的裁决回显视图(**缺失**)／裁决理由对员工可见的权限口径(**缺失**) | 分支：员工对裁决有异议 → 在该格追加 note，进下一轮仪式复盘（不阻塞本轮定案）。判定点 **J2** |
| **Step 7** 发版人点 promote 的时候，如果这一版的表没绿，闸当场拦住他，并且直说卡在哪几格；拿旧单子想放行新构建也一样拦 | **缺失** | **L3（真闸真跑）** | `release-gate` job 三步式结构(**已有且真在用**，5 次真实 dispatch，`promote-all-prod.yml:59-138`)／`sha` 输入与 `DEPLOY_SHA` 解析算法(**已有**，`:167,183-184`)／第三证据项(**缺失**，落点 `:138` 之后)／gate 脚本 + selftest workflow(**缺失**)／棘轮与计数(**缺失**) | 分支：取数失败 = **红**（fail-closed），仅此情形可填 `bypass_two_column_infra`；格红一律不可豁免。判定点 **J7**（取数通路）／**J9**（怎么验闸而不真发版）／**J15**（逃生阀） |
| **Step 8**（出错路径）任何一步塌了，主理人在验收单上就看得见是哪一步塌的，并且能重开一轮而不丢上一轮的留痕 | **缺失** | L2（服务端真验） | run 的 `stale` 状态与 `ai_incomplete` 标记(**缺失**)／同 GP 多轮 run 并存(**当前物理不可能**，`acceptance_checks_check_key_key` 全局 UNIQUE，v2 实测)／跨 run 写隔离(**缺失且是新坑**，`acceptance.js:62-66` `UPDATE … WHERE check_key = $4` 不带 run_id) | 分支：验收期间 staging 重部署或规程改版 → run 标 `stale`，人列提交 409，必须重开新 run。判定点 **J5**／**J12** |

### 出错路径的用户视角（发现 → 恢复）

| 故障 | 用户怎么发现 | 怎么恢复 |
|---|---|---|
| AI 打表器中途挂 | 单头显示「AI 列不完整（已完成 N/20）」 | 员工照常填；缺格按 Q0′ 判；可单独重跑打表器补格 |
| staging 在验收中途被重新部署 | 提交人列时 409，页面提示「本单验的构建已失效」 | 重开新 run（新构建号），旧 run 存档为 `stale`，留痕不删 |
| 规程 yaml 改版 | 同上（`spec_sha` 不匹配） | 同上；改版说明写进新 run 单头 |
| 放行闸取不到双表数据 | promote 时 release-gate 红，summary 写「双表取数失败（infra_error）」 | 修通路后重跑；紧急发版填 `bypass_two_column_infra`（进 summary 大字 + 棘轮计数） |
| 员工与 AI 全格分歧 | 合看页整列变分歧色 | 先怀疑打表器（登录失效整轮空跑），核 AI 证据截图是否为登录页；红格占比 >1/3 自动熔断，不建 37 个任务 |
| **AI 打表器误触达真人（红线7 暗号已发出）** | 收信端账号出现非计划私信 / 抖音风控告警 / 打表器日志出现非 allowlist host | ①立刻停跑该 workflow 并吊销 `STAGING_ACCEPTANCE_*` secret；②在收信端截图取证，本轮 run 直接标 `stale` 作废（暗号已消耗，S12 本轮不可复用，需换新暗号）；③开 P0 任务复盘 Gate A 哪一层被穿；④Bark 告警主理人（不走飞书）；⑤补 A11 的机械断言覆盖被穿的那一层后才允许重新开跑 |

---

## 验收断言（A1-A13，冻结后 AI 不可改）

对齐 PRD `Final E2E`，按 37 格口径与 r1 findings 修正。所有 shell 断言禁用裸 `grep -c`（`|| true` 兜底，tech#P2-3）。

**A1 · 一张表两列（决策①）**
```sql
SELECT check_key, result, submitted_by, ai_verdict, ai_evidence, ai_run_at
FROM acceptance_checks WHERE run_id = :rid AND check_key = 'S3-c1';
```
断言：恰 **1 行**；`result` 与 `ai_verdict` 均非空且同属枚举 `('通过','不通过','无法验证')`；`check_key ~ '^S\d+-c[1-4]$'`；`SELECT count(*) … WHERE run_id=:rid` = **37**。

**A2 · 背靠背（决策②，服务端裁剪；9 条出口逐条）**
人列未齐（run 未达 `human_complete`）时，以下全部成立：
```bash
AI_COLS='ai_verdict|ai_evidence|ai_run_at|adjudication'
test "$(curl -s "$STAFF_HUB/api/staff/acceptance/pending"                | grep -c -E "$AI_COLS" || true)" = "0"   # 出口6 反代
test "$(curl -s "localhost:5221/api/brain/acceptance/pending"            | grep -c -E "$AI_COLS" || true)" = "0"   # 出口1 内网直连
test "$(curl -s "localhost:5221/api/brain/acceptance/runs?gp_id=$GP_ID"  | grep -c -E "$AI_COLS" || true)" = "0"   # 出口2 历史页
test "$(curl -s "localhost:5221/api/brain/acceptance/runs/$RUN_KEY"      | grep -c -E "$AI_COLS" || true)" = "0"   # 出口3 默认态
test "$(curl -s -H "Authorization: Bearer $TOKEN" "$PUBLIC_5223/acceptance/pending" | grep -c -E "$AI_COLS" || true)" = "0"  # 出口4 公网
test "$(curl -s "…/acceptance/runs/$RUN_KEY?view=review" -o /dev/null -w '%{http_code}')" = "403"                   # 合看态被拒
test "$(curl -s "$GATE_ENDPOINT?sha=$SHA" | grep -c -E "$AI_COLS" || true)" = "0"                                   # 出口7 gate 端点不回原文
test "$(cd $ZJ_REPO && git ls-files 'acceptance-spec/runs/*/ai-column.json' | grep -c "$RUN_KEY" || true)" = "0"     # 出口8 产物不进 git
```
人列齐之后，`?view=review` 返 200 且含 AI 四列（同一组 curl 反向再跑一次）。

**A3 · 第二轮不炸 + 跨 run 写隔离（`check_key` migration 的直接证据）**
```sql
SELECT count(*) FROM acceptance_checks WHERE check_key = 'S3-c1';              -- >= 2
SELECT count(DISTINCT run_id) FROM acceptance_checks WHERE check_key = 'S3-c1'; -- >= 2
```
约束已改：存在 `UNIQUE (run_id, check_key)`，不存在全局 `UNIQUE (check_key)`。
**新增隔离断言**：向 run A 提交 `S3-c1='通过'` 后，run B 的 `S3-c1` 仍为 NULL（堵 `acceptance.js:62-66` 的无 run_id UPDATE）。

**A4 · AI 诚实边界（Gate A 的机械化，决策⑤）**
```sql
-- 17 个 human_only 格（yaml 解析得出，非 37）不得出现「通过」
SELECT count(*) FROM acceptance_checks
WHERE run_id=:rid AND check_key IN (:human_only_17_list) AND ai_verdict <> '无法验证';  -- == 0
-- AI 给出确定判定的格数上限 = machine_db 20
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_verdict IN ('通过','不通过');  -- <= 20
-- 每个「无法验证」必须带原因，且原因属枚举
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_verdict='无法验证'
  AND (ai_evidence->>'reason') NOT IN
  ('human_only','scenario_not_triggered','page_unreachable','login_failed','timeout');  -- == 0
```

**A5 · 九组合矩阵机械对表**（product#P0-1 的核心断言）
构造一个测试 run，把 9 种组合各造至少 1 格（含 Q0/Q0′/Q3′），断言：
- 每格 `final_state` 与本文矩阵表逐行一致（服务端计算，psql 读回）；
- `gate_verdict='绿'` 当且仅当 37 格 `final_state` 全绿；任一 hard 格非绿 → `gate_verdict='红'` 且 `red_cells[]` 含该格号；
- hard 格为 Q3′（故障类无法验证）时 **不得**被判绿。

**A6 · 合看页 + 裁决落库 + 员工回显（决策③）**
截图证据 **4 张**：①九组合矩阵全貌（至少含双绿/分歧/双红/仅人列绿四色 + 缺格降级图例）；②一个分歧格展开，左 AI 证据（截图缩略 + 文本片段）右员工 note 并排；③主理人点裁决后的确认态；④**员工身份登录**同一页，看到裁决人与理由（product#P1-3）。加 psql：
```sql
SELECT adjudication->>'verdict', adjudication->>'by', adjudication->>'reason', adjudication->>'at'
FROM acceptance_checks WHERE run_id=:rid AND adjudication IS NOT NULL;  -- 四字段全非空
```

**A7 · 分流建任务（聚合式 + 熔断，决策③ + 记忆 `manual-task-post-anchor-trap`）**
```sql
-- 每 run 至多一个 bug 任务、至多一个追查任务（保留既有单 run 去重护栏）
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='bug';       -- <= 1
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='trace';     -- <= 1
-- anchor 三件套每行非空
SELECT payload->'anchor'->>'journey_id', payload->'anchor'->>'gp_id', payload->'anchor'->>'step_id'
FROM tasks WHERE payload->>'acceptance_run_key'=:run_key;
```
并断言：bug 任务描述含**全部** `final_state='红'` 的格号（SQL 对表，不手算分母）；追查任务描述含全部 Q4/Q7 格号；构造一个「红格占比 >1/3」的 run 时**不建** bug/trace 任务，改建 1 个 P0「规程/数据源疑似分叉」任务。

**A8 · 放行闸第三证据项（决策⑥，闸必须是活的；三段取证，缺一不算）**
- **a) 脚本四情形**：`scripts/release-gate/two-column-gate.sh` 以 `--fixture` 喂构造响应（不碰生产 PG），四条 exit code 断言：未定案 → `exit 1` 且 `::error::` 指名格号；定案且 sha 匹配 → `exit 0`；取数失败 → `exit 1` 且 summary 写 `infra_error`；**hard 格红 + 填了 `bypass_two_column_infra` → 仍 `exit 1`**（risk#P0-2 的直接断言）。
- **b) selftest workflow**：`two-column-gate-selftest.yml`（`workflow_dispatch`，不 needs 任何 promote job）在真 CI 环境跑同一脚本打**真** gate 端点，绿。
- **c) 接线证明**：`grep -c 'two-column-gate.sh' promote-all-prod.yml` ≥ 1，且**首次真实 promote** 的 `release-gate` job 日志里出现「证据③ 双表绿」step 的真实输出（本 GP 的收官条件，堵 `release-gate.mjs` 死代码剧本）。

**A9 · sha 绑定与双源对账（product#P0-2 + risk#P1-2）**
```sql
SELECT detail->>'backend_sha', detail->>'backend_sha_source2', version, detail->>'spec_sha'
FROM acceptance_runs WHERE id=:rid;   -- 均非空，两个 sha 相等且为 40 位
```
- 建单时构造两源不等 → **拒绝建单**（HTTP 4xx + 无新行）；
- gate 断言：`PROMOTE_SHA`（`inputs.sha` 或 `origin/main` HEAD，与 `promote-all-prod.yml:183-184` 同算法）≠ 定案 run 的 `backend_sha` → `exit 1` 且 `::error::` 写明「这个构建没有验收单」；相等才绿。

**A10 · 冻结锁（决策⑥）**
构造 staging 重新部署 → 人列提交 409 且 run 转 `stale`；构造 yaml 改版（`spec_sha` 变）→ 同样 409 + `stale`。curl 状态码 + psql 双证。

**A11 · Gate A 能力剥夺（risk#P0-1 的机械化）**
- a) 打表器 workflow 文件：`runs-on` 恰为 `ubuntu-latest`，全文 `grep -c 'self-hosted\|android-capable'` == 0；
- b) 该 job 引用的 `secrets.*` 集合 ⊆ 白名单三项（smoke 脚本解析 workflow yaml 断言）；
- c) Playwright allowlist 单测：请求非 `staging-autopilot.zenjoymedia.media` 的 host 被 abort（用本地 fixture 页面验证）；
- d) 判官任务 payload 无 `target_environment:'mac_web'`（即不走 `spawn.js:66` 的宿主逃逸）。

**A12 · 逃生阀可观测与棘轮（risk#P1-4）**
```sql
-- 近 30 天 bypass 次数 + hard 格「裁决绿」次数
SELECT count(*) FROM acceptance_runs WHERE detail->>'bypass_used'='true' AND created_at > now()-interval '30 days';
SELECT count(*) FROM acceptance_checks c JOIN acceptance_runs r ON r.id=c.run_id
WHERE c.check_key IN (:hard_8_list) AND c.adjudication->>'verdict'='绿' AND r.created_at > now()-interval '30 days';
```
断言：gate summary 打印两个计数；构造「近 30 天 >3 次」→ gate 直接 `exit 1`（棘轮生效）。

**A13 · 员工待办信号（product#P1-1）**
建单后：`GET /api/staff/acceptance/pending` 返回 count ≥ 1；Staff Hub 侧边栏「验收」右侧出现数字角标（截图为证）；仪式发起通知实际送达（Bark/飞书回执截图）。

---

## 判定点登记表（J1-J16，批准即写 decisions 冻结）

**J1 · ⚠️「双表绿」放行判据的分母**（v2 重写）
- 候选：A 37 格**双列都绿** ／ B 20 machine_db 双绿 + 17 human_only 人列独判 ／ C 只看 8 红线格 ／ **D 37 格「最终态」全绿**（最终态按九组合矩阵计算）
- **REC = D**
- 依据：AI 天花板是 14 确定 + 6 条件 + 17 恒无法验证（`explore-report.md:150-155`），**A 物理不可达**；B/C 把「人列没验成（无法验证）」和「没填」当成默认放行，正是 product#P0-1 指出的绕过口。D 用「最终态」统一口径：绿只来自 Q1、合法 Q3、或裁决绿，其余全拦——严格但可达（人列可全绿，AI 的合法无法验证不算红）。
- 误判后果：选 B/C → 8 个 hard 格里 4 个（S5-c4/S10-c4/S13-c4 场景未触发、S12-c4 真机没做）可以「无法验证」蒙混过关，闸看起来绿其实什么都没验；选 A → 闸恒红，三次之后必被豁免成摆设（`release-gate.mjs` 前车之鉴）。

**J2 · ⚠️ AI 列可见时机**
- 候选：A 逐格提交后该格解锁 ／ B 人列全表提交（run 达 `human_complete`）后统一解锁
- **REC = B**（不变）
- 依据：A 需把裁剪粒度从 run 级降到格级，`loadRunsWithChecks` 的 `SELECT *` 要改成逐格状态机，漏洞面显著扩大；且看到前面格的 AI 判定会污染后面格的独立性（决策②原意）。
- 误判后果：选 A 且 9 条出口漏一处，整轮双列独立性作废且**事后无法察觉**。

**J3 · ⚠️ AI 打表器的执行体**（v2 改判）
- 候选：A mac_web 的 Claude + Playwright ／ **B zenithjoy GitHub 托管 runner 跑 capture，判定另派 Brain docker 内任务** ／ C Brain 内置 curl/psql 直跑
- **REC = B**（v1 是 A，被 risk#P0-1 推翻）
- 依据：决策⑤字面「判据=屏幕所见非查库」作废 C。A 的问题不是能力不够而是**能力过剩**：`spawn.js:66` 判到 `mac_web` 即走 `host-executor.js`，ssh 逃逸宿主 `administrator@host.docker.internal`，宿主持有 `~/.credentials/` 与连 xian-rog/xian-pc 的 key——提示词层管不住 Bash 工具。B 的托管 runner 同样跑真 chromium（zenithjoy 侧 ≥6 个 workflow 已在 `playwright install chromium --with-deps`，`explore-report.md:118`），但物理上够不到手机池（手机池只经 self-hosted `android-capable` 车道），且 secrets 可白名单化 → Gate A 前两层成为机械约束。
- 误判后果：选 A → 「不碰真机」只剩提示词承诺，S12 发私信这类不可逆触达要靠事后 SQL 才发现，那时暗号已经发出去了。

**J4 · ⚠️ 不可自动化格的 AI 列**
- 候选：A 标「无法验证」留空 ／ B 硬跑给低置信判定
- **REC = A**，且 v2 追加：**「无法验证」必须分合法/故障两类**，只有合法类享受 Q3 绿通道
- 依据：`cells-map.mjs:14` 已明规「场景未出现必须判无法验证，不许假绿」。
- 误判后果：不分类 → 打表器登录失效整轮哑火时，37 格全变「无法验证」，配合「人列通过」全部落进 Q3 绿通道，**一轮什么都没验的 run 会被判定案绿**。

**J5 · ⚠️ 格号统一方案**
- 候选：A `check_key` 直存规程格号 `S{n}-c{m}` + 约束改 `UNIQUE (run_id, check_key)` ／ B 保留 `{run_key}:{格号}` 拼接键
- **REC = A**，且 v2 追加必改项：`submitAcceptanceResults` 的查找与 `UPDATE` 全部加 `run_id` 作用域
- 依据：决策①「一份规程一套格号」；B 每次 join 都要字符串切割，格号仍是两套。
- 误判后果：不动 UNIQUE → 第二轮建单立刻 23505（`acceptance_checks_check_key_key`）；**只动 UNIQUE 不动 UPDATE 更糟**——`acceptance.js:62-66` 的 `WHERE check_key = $4` 会把员工这一轮的提交同时写进历史所有 run 的同名格，且数据里看不出来。

**J6 · ⚠️ AI 列的存储形态与裁剪实现位置**
- 候选：A 新增四个真列（`ai_verdict`/`ai_evidence`/`ai_run_at`/`adjudication`）+ SQL 列白名单 ／ B 塞进 `detail` jsonb + 应用层删键
- **REC = A**，且 v2 追加：`ai_verdict` 复用人列中文枚举并加同款 CHECK（消掉词表映射层，tech#P2-2）
- 依据：`detail` 全库 0 条有值确是空壳，但裁剪要的是**默认不泄露**——列白名单 SQL 天然满足「新增列不会自动泄露」，jsonb 要逐子键 delete，新增子键忘删就漏。裁剪必须在 Brain 的 SQL 层（`acceptance.js:151,157,164`），反代层（`services/acceptance.ts:52`）同步白名单作双保险。
- 误判后果：选 B 或只在反代裁 → 直连内网 5221 或走公网 5223 即拿到 AI 列，A2 的第 2/4 条 curl 会当场戳穿。

**J7 · ⚠️ 放行闸第三证据项的取数通路**（Gate B 的结论落点）
- 候选：A GitHub runner curl 公网 5223 的只读 gate 端点（token 走 GH secret） ／ B Brain 定案时反向 push commit status 到 zenithjoy repo ／ C runner 经 Tailscale 连 HK 再转发
- **REC = A**（前提 Gate B 探明公网可达），否则 B
- 依据：A 复用已有 fail-closed 公网 router（`acceptance-public-server.js:47-57`，v2 实测 5223 在跑、`/health` 返 401）；C 要在 runner 上装 Tailscale，跨账号凭据链最长且与 Gate A 的凭据白名单冲突。
- 误判后果：取不到数默认放行 → 闸是装饰；必须 fail-closed（取不到=红），且逃生阀只对 `infra_error` 生效（J15）。

**J8 · ⚠️ 合看页从哪打得开（A6 四张截图的物理前提）**
- 候选：A 本机经 Tailscale 打 Staff Hub staging（`100.86.118.99:8091`） ／ B 临时开公网入口 ／ C 本地起 dev server 连生产 Brain
- **REC = A**（不变）
- 依据：Staff Hub staging **公网不可达**——`deploy/staff-hub/nginx-staging.conf:1-4` 原文「只绑 Tailscale IP，公网不可达」，compose 显式绑 `100.86.118.99:8091/9444`；`/dev` 在本机跑（J13），本机有 Tailscale 通路。
- 误判后果：按公网写 E2E → 连不上，四张截图永远拿不到，最后被降级成「页面代码 review 通过」这种空话验收。

**J9 · ⚠️ 放行闸怎么验证而不真发一次版**（v2 重写）
- 候选：A 给 `promote-all-prod.yml` 加 `dry_run` 输入 ／ B 逻辑抽成独立脚本喂真实数据直跑 ／ C 真跑一次 promote ／ **D = B + selftest workflow + 首次真实 promote 日志三段取证**
- **REC = D**（v1 是 A+B，A 被 tech#P1-4 与 risk#P1-1 双杀）
- 依据：A 等于在唯一的生产放行路径上开一个跳过分支——文件头原文「★只能人手点★ … AI 不自行 promote」，`:59-66` 的 confirm 闸是 release-gate 第一步，dry_run 要么绕过 confirm 要么没意义；且 `concurrency: promote-prod, cancel-in-progress:false`（`:44-46`）会被 dry run 占用，真发版排队。B 单独做则重演 `release-gate.mjs` 死代码剧本，所以补 selftest（证明脚本在 CI 真环境能取到数）与首次真实 promote 日志（证明它真被 release-gate 调用）。
- 误判后果：选 A → 某次 dry run 的绿被误读成「已放行」；选 C → 为验闸做一次不可逆生产发布；只做 B → 脚本活着但没接线。

**J10 · ⚠️ 19 个 na 格是否建行**
- 候选：A 只为 37 有效格建行，na 格由页面从规程渲染成灰格 ／ B 56 格全建行标 `na`
- **REC = A**（不变）
- 依据：`pass_rate` 分母不能被 na 污染（生产现存 run `pass_rate=0.182` 已有这个味道）；A1 的「恰 37 行」依赖此。
- 误判后果：选 B 则「最终态全绿」的分母含 19 个永不参与判定的格，闸语义变糊。

**J11 · ⚠️ 剧场闸（theater_mismatch）冲突的处置**（v2 重写）
- 候选：A 措辞分区（v1 REC） ／ B 改 `harness-judge.js` 加白名单例外 ／ C 整条 GP 挂 `windows_wechat` 真机环境 ／ **D 本 GP 不进 harness 主链**（见 J13）
- **REC = D**；**A 作废，B 明确否决**
- 依据：A 挡不住——闸是大小写不敏感 substring（`harness-judge.js:812`），关键词表含 `android`（`:188`），而规程文件名 `line02-android.yaml`、run_key `line02-android-*` 本身含 android，任何 `Test:`/`[BEHAVIOR]` 行引用规程路径即 FAIL；且 GP 段提取有兜底（`:796` 无标题则扫全文）。B 会把一道正确的闸拆了——闸的语义「轻量环境不许声称真机工作」对本 GP 依然正确，我们只是**不该走那条链**。C 拿不到浏览器且与 Gate A 冲突。
- 误判后果：坚持 A → 合同一提交 `theater_mismatch` FAIL，流水线卡死且看起来像闸误杀，诱导下一个人去改闸。

**J12 · ⚠️ 冻结锁的校验强度**（v2 加强）
- 候选：A 记 `backend_sha`，AI 打表与人列提交都校验 ／ B 只记录不校验
- **REC = A**，v2 追加三条：**①双源对账**（源① staging 新增 `/api/version` 暴露 build sha；源② `deploy-us-vps.yml` 最近成功 run 的 `headSha`，走 `gh api`），**②规程版本锁**（`version` + `spec_sha`），**③闸侧 sha 绑定**（`PROMOTE_SHA == run.backend_sha`）
- 依据：决策⑥「验收站位=staging 冻结切面」。v1 只校验格式，源头仍是被测系统自报（`capture.mjs:73-80`，且该端点 v2 实测 **404**，所以现在恒 unknown）；cecelia 侧已有 SHA 对账范式（`scripts/deploy-local.sh:108-135` + drift-sentinel）可循。run 内冻结之外还有 run 定案→promote 之间的窗口，必须由闸侧绑定补上。
- 误判后果：选 B → 两列判的是不同版本，「双表绿」证明一个从未存在过的切面，且**数据里完全看不出来**；只做 run 内冻结不做闸侧绑定 → 用昨天的绿单放行今天的构建。

**J13 · ⚠️ 本 GP 的实现路径**（v2 新增，是本轮最大结构变化）
- 候选：A 走 harness 主链（签 GP 合同 → `harness_initiative`） ／ **B 拍板后按交付物建多个 `/dev` 任务**（带 `payload.anchor` 三件套）
- **REC = B**
- 依据：两条硬事实叠加。①**跨 repo**：`GP_HARNESS_BASE_REPO` 常量恒为 `cecelia.git`（`golden-path-contract-task.js:1`，全仓唯一写入点 `golden-path-contracts.js:397`），而本 GP 过半交付物落 `zenithjoy-workspace`（打表器 workflow、Staff Hub 页面、反代裁剪、`promote-all-prod.yml`、规程 yaml），harness 主链一个 PR 覆盖不了。②**真浏览器**：`GP_HARNESS_TARGET_ENVIRONMENT` 常量恒为 `local_api`（同文件 `:2`），`spawn.js:66` 只认 `mac_web` 才走宿主——即使把它参数化，①仍未解，且 `mac_web` 已被 J3 因安全理由否决。附带收益：theater 闸只在 `runMechanicalGate`（`harness-judge.js:690`←`routes/harness.js:19`）内生效，不走 harness 即整条闸不在路径上（J11）。
- 误判后果：选 A → 合同签完才发现要么被 theater 闸卡死、要么 PR 改不到 zenithjoy，一轮 GAN 白跑；且会诱发「改闸」或「参数化 env」这类为了走通流水线而动系统的连锁改动。
- **代价与补偿**：`/dev` 路径没有 GAN 对抗与 evaluator 的 L2/L3 findings。补偿=本提案的 A1-A13 冻结断言作为每个 `/dev` 任务 DoD 的 `[BEHAVIOR]` 来源，且最后一个交付物必须跑一次覆盖全部断言的 Final E2E。

**J14 · ⚠️ 每格 `kind` 的来源**（v2 新增）
- 候选：A yaml 每格补显式 `kind` 字段 + schema 设 required ／ B 生成器按规则推断（hard→Invariant、含时限→NFR、human_only→SOP、其余 FR）
- **REC = A**（B 只作过渡期兜底且必须打警告）
- 依据：`ACCEPTANCE_KINDS=['FR','NFR','Invariant','SOP']` 在端点（`acceptance.js:9,191`）与 DB CHECK（`acceptance_checks_kind_check`）双重强校验，而 yaml 全文零个 kind 字样——不补映射首次建单即 400。规程是 SSOT，语义该由规程作者写死，推断规则会把猜错的语义固化进历史数据。
- 误判后果：选 B → 37 格的 kind 是一次性猜测，之后所有按 kind 的统计/巡检都建在猜测上，且改判要动历史行。

**J15 · ⚠️ 逃生阀形态**（v2 新增，替代 v1 的 `waive_two_column`）
- 候选：A 照抄 `waive_nightly`（填理由即无条件 `exit 0`） ／ B 本期不提供任何逃生阀 ／ **C 只对 infra 故障提供 `bypass_two_column_infra`，格红不可豁免，加计数与棘轮**
- **REC = C**
- 依据：A 的实现是无条件跳过整个 step（`promote-all-prod.yml:84-93`），会连 J1 声称不可 waive 的 8 个 hard 格一起豁免（risk#P0-2）；B 则取数通路一坏就彻底堵死发版，必然被人手改 workflow 绕过（更坏）。C 的关键是**机械可区分**：gate 脚本自己判定失败原因是 `infra_error`（端点不可达/超时/鉴权失败）还是 `cells_red`（拿到数据但格未绿），只有前者读 bypass 输入。hard 格的唯一逃生阀是主理人裁决（有名有姓、有理由、进棘轮）。
- 误判后果：选 A → J1-④ 的「不可 waive」是一句空话，红线格形同虚设；无棘轮 → 逃生阀变日常，三次之后闸就是摆设。

**J16 · ⚠️ 验收仪式的发起人、频率与工时**（v2 新增）
- 候选：A 每次 promote 前一轮（发版人发起） ／ B 固定每周一轮 ／ C 员工自助随时发起
- **REC = A**
- 依据：决策⑥「员工验收=发版仪式非日常」字面。发起人=**发版人**（他要点 promote，他负责在前一天发起并通知员工）；频率=**每次 promote 前恰一轮**（同构建幂等复用，`acceptance.js:183` 已支持）；工时预算=**1.0–1.5 人时/轮**（17 个 human_only 格含 S12 真机全程录屏私信约 30–40 分钟 + 20 个 machine_db 格复核 AI 结论约 20 分钟）。真机部分由员工手持设备执行，**不依赖** CI 的 `nightly-android-fleet-pc4` 车道（该车道近 3 晚连续 failure，`explore-report.md:160`，但它验的是 account-scan，与 S12 人工私信不是同一条路）。
- 误判后果：不定仪式 → 「37 格齐才解锁」变成没人负责的阻塞点，第一次卡住就会有人去改解锁条件或走 bypass；不评工时 → 员工把它当额外负担，草率填表，两列独立性名存实亡。

---

## 交付物划分（按依赖排序；实现路径见 J13）

> 命名按内容不按代号（记忆 `feedback_no_knife_jargon_rightsize_decomp`）。每件对应一个 `/dev` 任务，`payload.anchor` 必带 `{journey_id, gp_id, step_id}` 三件套。

**D1 · 数据层地基与状态机**（cecelia，阻塞其余全部）
AI 四列 migration（J6-A，中文枚举 + CHECK）＋ `check_key` 改规程格号 ＋ `UNIQUE (run_id, check_key)`（J5-A）＋ **`submitAcceptanceResults` 全链路加 `run_id` 作用域**（v2 新发现）＋ 规程 yaml → 37 格建单生成器（含 J14 的 kind）＋ `backend_sha` 双源对账与 `spec_sha`/`version` 落库（J12）＋ **run 状态机改造**（`acceptance_runs_status_check` 加 `human_complete`/`adjudicated`/`stale`，`status` 计算改按九组合矩阵算 `final_state` 与 `gate_verdict`，`passed` 退为历史兼容值）。
对应 Step 1 / Step 5 / Step 8；解锁断言 A1 / A3 / A5 / A9 / A10。

**D2 · AI 打表器与 Gate A 机械约束**（zenithjoy 为主，cecelia 加回写端点）
打表器 workflow（`runs-on: ubuntu-latest`，J3-B）＋ Playwright 域名 allowlist ＋ secrets 白名单与 smoke 校验 ＋ staging `GET /api/version` 暴露 build sha（现 404）＋ 判定任务（Brain docker 内，读 artifact 截图判「屏幕所见」）＋ `POST /acceptance/ai-results` 回写端点（含 pass/fail/unverifiable → 中文枚举翻译与 reason 分类）＋ 产物不再 commit 进 repo。
对应 Step 2；解锁断言 A4 / A11。

**D3 · 背靠背裁剪**（cecelia + zenithjoy 反代；依赖 D1 的列存在，可与 D2 并行）
`loadChecks`/`loadRunsWithChecks` SQL 列白名单 + `view` 参数与服务端 `human_complete` 校验 ＋ 9 条出口逐条覆盖（含公网 5223 与 `GET /runs/:run_key` 默认态）＋ 反代层同步不透传。
对应 Step 3；解锁断言 A2。

**D4 · 合看页、裁决、员工回显与分流建单**（zenithjoy 页面 + cecelia 后端；依赖 D1/D2/D3）
九组合矩阵合看页（`apps/staff-hub/src/pages/`，含 device / scenario_required 标记）＋ `adjudication` 裁决 API 与 hard 格裁决绿自动开 P0 ＋ **员工侧裁决回显视图** ＋ 侧边栏待办角标与仪式发起通知 ＋ 聚合式分流建任务（≤1 bug + ≤1 trace、anchor 三件套、红格占比 >1/3 熔断）。
对应 Step 4 / Step 5 / Step 6；解锁断言 A6 / A7 / A13。

**D5 · 放行闸第三证据项**（zenithjoy）
只读 gate 端点（J7-A，落 5223）＋ `scripts/release-gate/two-column-gate.sh`（sha 绑定、`infra_error` vs `cells_red` 机械区分、`bypass_two_column_infra`、棘轮计数）＋ `two-column-gate-selftest.yml` ＋ `promote-all-prod.yml:138` 之后接线。
对应 Step 7；解锁断言 A8 / A12。

**Phase 2（只登记，本提案不展开）**
决策④「连续多轮双绿的格从员工表摘除、标已移交 AI 可抽查」——依赖多轮 run 历史，物理上要等 D1-D5 跑满数轮；Kernel 融合（proposer 合同 BEHAVIOR 锚格、sprint evaluator 的 L2/L3 findings 产「新格候选」进待审池、格覆盖闸）；其余 GP 的 acceptance-spec yaml 编写（本轮只做 line02-android 一条样板）。

---

## P2 记账（不阻塞，进账本留给实现期）

| # | 事项 | 证据 |
|---|---|---|
| P2-1 | 七环对账巡检棘轮击穿：`RATCHET_PATH` 容器内解析不到 json → 静默 fallback `hard_flaw_max:0` → 生产 `ratchet_breached=true` 恒真且只 console.warn 无人消费 | `explore-report.md:100`，`seven-ring-audit.js:16,183` |
| P2-2 | `harness-evaluator` skill 三处版本分叉：cecelia 内 1.35.1 / SSOT 1.33.0 / dist 快照 1.32.2 且不含人形协议段 | `explore-report.md:113,188` |
| P2-3 | 员工验收网页部署仍是手工 scp，CI 只保证 repo 内一致、不保证服务器那份 = repo 那份（也是 risk#P1-3 里「员工看的规程与库里分叉」的根因） | `explore-report.md:76`，`cli.mjs:47` |
| P2-4 | Staff Hub 详情页拉全量 pending 再前端 `find`，已有的 `GET /runs/:run_key` 端点闲置（D3 改造后应切过去） | `explore-report.md:45`，`AcceptanceDetailPage.tsx:36` |
| P2-5 | 填表页未标出「需真机 / 需场景」的格，员工无法预知哪些格自己也验不了；`device` 列已渲染，`scenario_required` 只在 `cells-map.mjs:23-67`，未进 yaml（← product#P2-1，D4 顺手做） | `AcceptanceDetailPage.tsx` 已渲染 `c.device` |
| P2-6 | cecelia 侧 `promote-all-prod.yml` 与 `scripts/release-gate.mjs` 均为事实死代码，建议明确废弃或接线 | `explore-report.md:97,101` |
| P2-7 | `line02-android-collect-realmachine-smoke.sh:49` 的 `awk` 只抓第一台设备，多机型矩阵能力缺失 | `explore-report.md:163` |
| P2-8 | evaluator `android_realmachine` 分支半成：skill 有派发逻辑但 Brain 侧 `ANDROID_REALMACHINE_WORKFLOW` 零命中，目标 workflow 两 repo 都不存在，真派必 FAIL | `explore-report.md:162` |
| P2-9 | harness 主链的 `base_repo` / `target_environment` 均为不可覆盖常量，任何跨 repo 或需真浏览器的 GP 都走不通（本 GP 靠 J13 绕开，但下一条同类 GP 会再撞一次） | `golden-path-contract-task.js:1-2`，唯一消费点 `golden-path-contracts.js:397-398`（v2 实测） |
| P2-10 | theater 闸 GP 段提取兜底：`sprint-prd.md` 无 `## Golden Path` 标题则扫全文，且 `###` 子标题不终止段落 | `harness-judge.js:796`（← tech#P1-2） |
