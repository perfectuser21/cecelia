# 发版验收一体两面——F2 步2 加厚「一张表两列背靠背合着看」Golden Path v4

提案人：Cecelia（AI）。v4 = 对 solo 复审 r3（`.harness/verdicts/gp-r3-solo.json`）的逐条修订轮：**0 P0 / 3 P1 全部核销，0 REFUTE，5 P2 记账（累计 20 条）**。r2 的 9 条 P0/P1 台账留痕在 `proposal-v3.md`，本版不重抄。

- **归位**：工厂 · F2 部署闭环（journey `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`）· 步2「部署被证明没坏」· 动作=**加厚**（非新路）
- **GP_ID**：`7790f728-f490-4243-b166-03f3250a0938`（golden_paths，candidate）
- **法源**：决策 `fdeb48aa` 六条（一字为法，本提案不得改写其语义）；④「移交节奏」Phase 2+ 只登记
- **现状依据**：`.harness/explore-report.md` + v2 实测 + 本轮为核销 r2 findings 新增的直接读码/解析（新增部分逐条标「v3 实测」）

---

## 0. 相对 v3 的结构性变化

| # | 变化 | 回应 |
|---|---|---|
| 1 | **候选 C 的两个隐含前提转成显式前提，并各配一条机械闸**：①**同租户前提**——单头保留「测试用客户账号」字段并落 `acceptance_runs.detail`（补进 Step 2 挂片枚举与 D4 迁移清单，v3 两处都漏了），建单时服务端校验它 ∈ AI 采证账号可见租户集合，不等 → 拒绝建单；Step 3 采证开跑先自检租户一致，不一致 → 整轮 `ai_incomplete` 告警，**不许静默把 11 格判成「无法验证」**。新增断言 **A16** | → r3-P1-1① |
| 2 | **时限两格（S7-c2/S9-c2）按 fail-closed 先摘出 AI 可判集合**：AI 可判上限 20→**18**，`verifiable_by` 基线改 `human_only`（human_only 16→18、machine_db 20→18、故障类 14→12、哑火分母 20→18 阈值 10→9）；新增 **§AI 可判集合口径切换表** 把全部受影响数字与位置集中登记，Gate B 第4条实测「页面是否显示创建/终态时间戳」通过后**整表一次性切回 20/16**，写成条件式而非留两套散落数字 | → r3-P1-1② |
| 3 | **Q0′ 缺格统一 fail-closed**：最终态由「按人列单列判」改为**未定**，与闸判据「缺格一律拦」同向，A5 两条断言不再二义 | → r3-P1-2 |
| 4 | **哑火判据补第三条件堵「只回写 hard 格躲哑火」**：`ai_verdict IS NULL` 的**缺格数 > 0** 即 run 标 `ai_incomplete`，闸对 `ai_incomplete` 的处置 = 拦（走 `ai_run_infra_error` 路径，不建 bug/trace、不进熔断）；A4④ 同步补断言 | → r3-P1-2 |
| 5 | **复盘窗口写死在开新轮之前（修法一，不开已定案轮例外）**：Step 7 分支加前置「上一轮复盘闭环（`detail.review_closed_at` 落库）后才允许开下一轮」，时序表 T4 行补前提，Step 1 分支加「上一轮复盘未闭环 → 拒绝建单 409」，新增断言 **A15**。防锚定强度优先，不给已定案轮的 `adjudication` 开跨轮可见例外 | → r3-P1-3 |
| 6 | P2 记账扩至 20 条（新增 P2-16 共享 repo 并发部署穿透 / P2-17 5223 双前提回落 / P2-18 下线=解挂路由不删码 / P2-19 三 token fail-closed 启动判据 / P2-20 ②顺序无机械闸），其中 P2-17 的回落分支同步补进 Gate B 第1条处置 | → r3-P2-1..5 |

> v3 相对 v2 的变化（格数 37→36、Gate A 带内通道剥夺、三 token 分权、双源换活 workflow 等 11 项）见 `proposal-v3.md` §0 与 §R2 核销台账，本版不重抄。

---

## R3 核销台账

> 处置只有两种：**核销@节名**（提案已改）或 **REFUTED+证据**。本轮 **3 条 P1 全部核销，0 条 REFUTE**——三条我逐条复核，全部属实，其中 P1-1 的两个前提我确认 v3 正文与 D4 清单确实各漏一处（不是措辞问题，是字段真的没登记）。

| id | 处置 |
|---|---|
| r3-P1-1（候选 C 的两个未登记前提：同租户可见性 / 时限格事后可测性） | **核销@J17 前提两条 + Step 2 挂片 + Step 3 挂片与分支 + D1/D4 + Gate B 第4/5条 + §口径切换表 + A16**。①同租户：finding 指出的两处遗漏属实——v3 的 Step 2 挂片枚举 `lib.mjs:292-299` 时只列了 手机型号/客户端编号/本轮任务编号/本轮暗号，漏掉同一段里的**测试用客户账号**（`lib.mjs:297`，`data-f=tenant`），D4 的 detail 迁移清单照抄了这份漏项。修法不止「补字段」：光落库不校验仍会在首轮撞上「AI 看空列表 → 11 格全无法验证 → 全归故障类 → 触发哑火 → 首轮即死」，故补建单期服务端校验 + 采证期自检两道闸（A16）。②时限格：`capture.mjs:168-185` 确从自己触发起轮询计时属实，C 之下这套计法物理失效；按 fail-closed **先摘除**（口径 18），页面时间戳可读性由 Gate B 第4条实测，通过再整表切回 20 |
| r3-P1-2（Q0′ 最终态与闸判据正面矛盾，缺格是静默放行口） | **核销@九组合表 Q0′ 行改「未定」 + §熔断与哑火判据 第三条件 + A4④ + A5 + 出错路径表**。finding 的两条修复方向我**两条都取**而不是二选一：Q0′ 最终态改「未定」消除 A5 的二义，同时哑火判据补「缺格数 > 0 → `ai_incomplete`」——只做前者的话，AI 仍可对 28 个非 hard 格集体不提交，全轮拿一堆「未定」把闸拦死却不留任何「AI 打表器坏了」的痕迹，故障看起来像是员工的锅；补上后者才让「AI 少回写」这件事本身被识别为 infra 故障并单开 P0 |
| r3-P1-3（跨轮闸与 Step 7 复盘、时序表 T4 互斥） | **核销@Step 7 分支重写 + Step 1 分支 + 时序表 T4 + J2 判据③ + J16 仪式前置 + A15**。取**修法一**（复盘窗口限定在开新轮之前），不开已定案轮例外：复盘是仪式内环节而非异步长尾，开例外等于让「上一轮同格的 AI 判定与裁决理由」在本轮填表期常态可见，防锚定强度立刻打折；且例外方案要论证「裁决文本不携带本轮 AI 判定信息」——裁决理由几乎必然引用 AI 证据，这个论证做不成。机械落点：`detail.review_closed_at` 非空才允许同 gp 开新 run |

---

## Gate A · 边界硬约束（fail-closed，能力层剥夺）

**AI 打表器只走 staging 后台网页，只读观察，一根火都不点：不碰真机、不发起采集、不发私信、不触达任何真实抖音/微信账号。**

v2 的四层被 r2-P0-2 击穿：四层剥的全是**带外**能力（宿主 ssh 逃逸、真机车道 label），而采证器的**带内**能力原样保留——`capture.mjs:152-163` 真的填关键词点「开始采集」，该动作经 `POST /api/acquisition/collect/start` 落 `acquisition_collect_tasks(agent_id)`，由绑在常驻验收租户下的真安卓 agent 领走用真抖音小号执行（凭据注释原文「绑真机租户，4台安卓在线」，`capture.mjs:13-15`）。allowlist 放行 `staging-autopilot.zenjoymedia.media` 恰恰放行的就是这条指挥通道本身。v3 把「零点火」提升为第①层，且它是**唯一一层需要动采证器代码**的：

| 层 | 落法 | 机械性 |
|---|---|---|
| **①带内通道剥夺（v3 新增，最重要）** | 采证器删除「发起采集」交互；`cells-map.mjs` 的 `action` 枚举去掉 `trigger_collect` 与 `signup_flow`，只剩 **`observe`** 一值，schema/单测强制。**受影响格数写死：`trigger_collect` 恰 1 格 = S6-c3**（v3 实测 `cells-map.mjs` 全表 20 格：signup_flow 1 / trigger_collect 1 / observe 18）。S6-c3 改为观察员工本轮已发起的任务记录（任务编号来自 run 单头，见 J17-C）。**v4 补**：基线口径下时限两格（S7-c2/S9-c2）从 `cells-map.mjs` 移出（改由人列独判），采证器覆盖格 20→**18**；Gate B 第4条通过后按 §口径切换表 加回并改成读时间戳 | 机械（`action` 枚举单测 + 采证器全文 `grep -c '开始采集\|collect/start'` == 0，A11-e） |
| ②执行环境剥夺 | 打表器 job 固定 `runs-on: ubuntu-latest`（GitHub 托管），**禁止** `self-hosted` / `android-capable` label。手机池只经 self-hosted 车道可达（`nightly-android-fleet-pc4.yml:36,114`），托管 runner 够不着真机 | 机械（workflow 文件可 grep 断言，A11-a） |
| ③凭据剥夺（v3 重写） | 该 job 的 `secrets` 白名单 = `STAGING_ACCEPTANCE_EMAIL` / `STAGING_ACCEPTANCE_PASSWORD` / **`ACCEPTANCE_AI_TOKEN`**（新，只能写 AI 四列）。**`ACCEPTANCE_API_TOKEN` 移出白名单**（r2-P0-3：它能写人列并伪造 `submitted_by`）；**禁止** `TAILSCALE_AUTHKEY` / `HK_VPS_SSH_KEY` / 1Password token。判定任务跑 Brain docker 内（`executeInDocker`），不走 `executeOnHost` | 机械（smoke 解析 workflow yaml 断言白名单，A11-b） |
| ④网络 allowlist | Playwright `page.route('**', …)` 只放行 `staging-autopilot.zenjoymedia.media`，其余 host abort；`checkCellsMapComplete`（`capture.mjs:61-67`）保留，白名单外格号拒绝执行并写「无法验证」 | 机械（单测 A11-c） |
| ⑤产物约束 | 证据截图与文本快照走 CI artifact，**不 commit 进 repo**（现 `acceptance-spec/runs/*/ai-column.json` 含真实线索 PII）；结论只 POST 进 DB | 机械（`git ls-files` 断言，A2 出口8） |
| ⑥事后核对 | 断言 **A4**（16 个 human_only 格恒「无法验证」）+ **A11**，兜底不作主防线 | 事后 |

**S12 全 4 格 + S13-c1/c3 等需安卓真机的格，AI 列恒为「无法验证」，不允许出现「通过」**——这是 Gate A 的设计输出。

## Gate B · 前置探明（开工第一件事，半天内出结论，不过则改道）

1. 5223 **公网可达性**（GitHub ubuntu runner 能否打通 gate 只读端点**与 AI 回写端点**）。**v4 补（← P2-17）**：5223 同时是闸取数与 AI 回写的可达性前提，两侧回落必须分开写——闸侧不通走 J7-B（Brain 定案时反向 push commit status）；**回写侧不通则 AI 列无处落库，两列制当轮只剩一列**，回落 = AI 回写改走「artifact + Brain 侧 docker 内判定任务读 artifact 后经内网 5221 落库」（判定任务本来就在 Brain docker 内，见 J3-B），仍**不得**把 runner 换成 self-hosted。本机实测 `https://brain-acceptance.zenjoymedia.media/acceptance/catalog` 返 401（隧道活着、鉴权墙在），大概率通得过。
2. gate 端点鉴权形态 → 已由 J19 定案为**独立只读 token**（`ACCEPTANCE_GATE_TOKEN`），此条转为「确认 Brain 生产容器能注入第三个 env」，并按 P2-19 确认三把钥匙**任一缺失只降级为该端点不挂载**、不得让整个 listener 起不来。
3. （← P2-5）**托管 runner 上真跑一次 capture 登录**：网络可达性有先例（`deploy-dashboard-staging.yml:37` 的 ubuntu-latest job 已在打公网 staging），但先例全是 `curl`，没有「托管 runner 数据中心 IP 上跑 headless chromium 完成 better-auth 登录」的实证（`deploy-lib.sh:505-513` 有 better-auth invalid origin 前科）。开工首日真跑一次，**不通则登记回落方案，且回落不得落回 self-hosted 真机车道**（会推翻 Gate A 第②层）。
4. **（v4 新增，← r3-P1-1②）时限两格的事后可测性**：在 staging 采集任务列表/详情页与判定结果页上，肉眼确认**是否同时显示「创建时间」与「进入终态时间」「判定出结果时间」**（S7-c2 判据「5 分钟内进入终态」、S9-c2 判据「3 分钟内出判定结果」）。C 之下 AI 在员工操作流结束约 40 分钟后才到场，`capture.mjs:168-185` 那套「自己触发起轮询计时」（`wait_budget_ms` 300000/180000）物理不可用，只能读页面时间戳算差值。**通** → 两格回 `machine_db`，采证器改读时间戳，按 §口径切换表整表切回 20/16；**不通** → 两格维持基线 `human_only`（口径 18/18），由员工在现场操作流里自己掐表判定。
5. **（v4 新增，← r3-P1-1①）AI 采证账号与本轮客户账号的同租户可见性**：用 `ai-acceptance@zenithjoy.test` 登录 staging，确认它能看到**员工用本轮测试授权码绑机后**产生的设备/任务/私信记录（实测参照 `acceptance-spec/runs/20260804-login-round/run-summary.json` 的 `machines_online=7`，说明该账号确实挂在一个有设备的租户下，但那不等于挂在员工本轮用的租户下）。**通** → 把该租户写死为「验收专用租户」，建单页的「测试用客户账号」做成从该租户下拉选择（A16）；**不通** → 本 GP 停在这里升级给主理人：要么给验收开一个 AI 与员工共用的常驻租户，要么 J17 退回候选 B 重新拍板（因为 C 的 18 格可判量正是建立在「AI 看得见员工本轮造的数据」上）。

- 1/2/3/4/5 **全通** → 按 J7-A + 口径切回 20/16。**1 闸侧不通** → J7-B；**1 回写侧不通** → 第 1 条的 artifact 回落。**3 不通** → 升级给主理人重新拍板 J17（AI 列取证路径本身没了）。**4 不通** → 口径维持 18/18，不阻塞开工。**5 不通** → **阻塞**，升级主理人。

---

## 两列九组合裁决矩阵（决策①③⑥的机械口径）

人列枚举 `通过/不通过/无法验证` 是 DB 强约束（`369_acceptance_tables.sql:25`，v3 实测），AI 列复用同一套枚举（J6）。两列各含「未填/未跑」的空态，故实为 4×4，空态统一归 **Q0**。**矩阵仍是三态——「不适用」不是终态而是「不建行」**（J10/J18）。

### 「无法验证」的机械分类（判据 = 格的静态属性，不是 AI 自报）

**下表按 v4 基线口径（18/18）写；Gate B 第4条通过后按 §口径切换表 整表切回 20/16。**

| 分类 | 判据（**服务端按 yaml 静态属性算**，AI 自报 reason 只作补充说明） | 享受 Q3 绿通道 |
|---|---|---|
| **合法 · human_only** | 该格 yaml `verifiable_by == 'human_only'`（基线 **18** 格 = v3 的 16 格 + 时限两格 S7-c2/S9-c2） | 是 |
| **合法 · scenario_not_triggered** | 该格 yaml `scenario_required == true`（6 格：S4-c2/S4-c3/S5-c3/S5-c4/S10-c4/S13-c4，v3 实测），且 AI 证据里无该场景 | 是 |
| **故障** | 其余全部——即 `machine_db` 且非 `scenario_required` 的格（基线 **12** 格）的任何「无法验证」，无论 AI 写什么 reason | **否** |

**机械化落点**（堵 r2-P1-3 的洗白路径）：`POST /acceptance/ai-results` 服务端校验——AI 提交 `reason='human_only'` 而该格 yaml 不是 human_only → **400 拒收**；`reason='scenario_not_triggered'` 而该格无 `scenario_required` → **400 拒收**。故障类 reason（`page_unreachable`/`login_failed`/`timeout`）任何格都可提交，但一律不进绿通道。

### AI 可判集合口径切换表（v4 新增，← r3-P1-1②）

**为什么要切换而不是直接写死 20**：v3 的「AI 常态确定判定 20 格」里含 S7-c2「5 分钟内进入终态」与 S9-c2「3 分钟内出判定结果」两个**时限格**，它们在 v3 之前是靠采证器自己点火后轮询计时得出的（`cells-map.mjs:37-40,49-52` 的 `wait_budget_ms` 300000/180000，`capture.mjs:168-185` 从自己触发起轮询）。候选 C 让 AI 在员工操作流结束**约 40 分钟后**才到场，这套计法物理失效，AI 只能读页面上的时间戳算差值——**而页面是否同时显示创建时间与终态时间未探明**。按 fail-closed，未探明即先摘除。

| 口径 | 触发条件 | human_only | machine_db | 故障类（machine_db 非 scenario_required） | AI 确定判定上限 | 哑火分母/阈值 |
|---|---|---|---|---|---|---|
| **基线（v4 默认）** | Gate B 第4条未跑或不通 | **18** | **18** | **12** | **18** | 18 / ≥9 |
| **切回** | Gate B 第4条实测通过 | 16 | 20 | 14 | 20 | 20 / ≥10 |

**切换是一次性整表操作，受影响的位置全部登记在此，改口径必须同批改完**：

| # | 位置 | 基线值 → 切回值 |
|---|---|---|
| 1 | 规程 yaml：S7-c2 / S9-c2 的 `verifiable_by` | `human_only` → `machine_db` |
| 2 | §无法验证的机械分类表 三行格数 | 18 / 6 / 12 → 16 / 6 / 14 |
| 3 | §熔断与哑火判据 条件二的分母与阈值 | 18 格中故障类 ≥9 → 20 格中 ≥10 |
| 4 | A4① 的 `:human_only_list` 与 A4② 的上限 | 18 格 / `<= 18` → 16 格 / `<= 20` |
| 5 | J17 对照表「AI 常态确定判定格数」C 列 | 18 → 20 |
| 6 | D2 采证器：两格的取数方式 | 不采（`human_only` 恒判无法验证） → 读页面创建/终态时间戳算差值 |
| 7 | 出错路径表「AI 列不完整」文案分母 | 恒为 **36**（AI 须对全部建行格回写，不随口径变） |

> **两个口径下 36 格总数、8 个 hard 格、6 个 scenario_required 格、J1-D 的分母都不变**——切换只在 human_only ↔ machine_db 之间搬两格，不影响闸的语义。
> **摘除不等于放弃这两格**：它们仍在 36 格分母里，只是改由员工在现场操作流里掐表判定（人列独判，AI 列恒「无法验证-human_only」走 Q3 绿通道）。红线本身没丢。

### 九组合表

| 组合 | 人列 | AI 列 | 名称 | 最终态 | 一般格动作 | hard 红线格闸判据 |
|---|---|---|---|---|---|---|
| Q1 | 通过 | 通过 | 双绿 | **绿** | 无 | 放行（唯一无需裁决的绿） |
| Q2 | 通过 | 不通过 | 分歧（AI 红人绿） | 未定 | 必须裁决 | **拦**，除非裁决绿 |
| Q3 | 通过 | 合法无法验证 | 仅人列绿 | **绿** | 无 | 放行（human_only / 场景未触发的正常绿路径） |
| Q3′ | 通过 | 故障无法验证 | 人绿·AI 哑火 | 未定 | 重跑打表器；重跑仍哑火→裁决 | **拦** |
| Q4 | 不通过 | 通过 | 分歧（AI 绿人红） | 未定 | 追查任务（优先信人） | **拦**，除非裁决绿 |
| Q5 | 不通过 | 不通过 | 双红 | **红** | bug 任务 | **拦**（裁决绿需写补偿措施并自动开 P0） |
| Q6 | 不通过 | 无法验证 | 人红独判 | **红** | bug 任务 | **拦** |
| Q7 | 无法验证 | 通过 | 人未验·AI 绿 | 未定 | 追查任务（为什么人验不了） | **拦** |
| Q8 | 无法验证 | 不通过 | 人未验·AI 红 | **红** | bug 任务 | **拦** |
| Q9 | 无法验证 | 无法验证 | 双盲 | 未定 | 「补验证手段」任务 | **拦** |
| Q0 | 未填 | 任意 | 不完整 | 未定 | Step 5 不解锁 | **拦**（run 到不了 `human_complete`） |
| Q0′ | 任意 | 未跑 | AI 列缺格 | **未定**（v4 改，← r3-P1-2） | 单独重跑打表器补格；且**整轮**标 `ai_incomplete`（见哑火判据条件三） | **拦**（缺格视同未拿到确定绿） |

> **v4 为什么把 Q0′ 从「按人列单列判」改成「未定」（← r3-P1-2）**：v3 的 Q0′ 行与紧接着的闸判据（「缺格一律拦」）正面矛盾，A5 又同时断言「`final_state` 与矩阵逐行一致」和「`gate_verdict` 绿当且仅当 36 格全绿」，实现者必须二选一；选宽松读法就是一个**静默放行口**——缺格行 `ai_verdict` 为 NULL，既不落进「确定判定 == 0」也不落进「故障类无法验证 ≥ 阈值」，于是 AI 只要回写 8 个 hard 格加少数几格、其余干脆不提交，就既躲开哑火识别、又让那些格靠员工一列判绿，两列制在非 hard 格上整体失效且事后看不出来。改「未定」后闸口径唯一；再配哑火判据条件三，「AI 少回写」这件事本身也被识别成 infra 故障。

**闸判据**：
> 一格的最终态为**绿**，当且仅当它落在 Q1、Q3，或经主理人裁决 `verdict='绿'`。其余（红、未定、缺格、空态）一律**拦**。
> **分母 = 36 个建行格**（J10）。8 个 hard 红线格（S2-c4/S5-c4/S6-c4/S8-c4/S10-c4/S11-c4/S12-c4/S13-c4，v3 实测全部落在步骤 1-13，不受 J10 改动影响）不可被任何 `bypass` 豁免；hard 格唯一逃生阀是**有名有姓的裁决**（记裁决人/理由/时间，计入棘轮 A12）。

**`passed` 不再是放行判据**：现行 `status = pending>0?'in_review':fail>0?'failed':pass===total?'passed':'in_review'`（`acceptance.js:88`）里只要有一格「无法验证」，`pass===total` 永假 → `passed` 物理不可达。D1 改为新状态机。

### 熔断与哑火判据（v4 补条件三，← r3-P1-2）

**AI 必须对全部 36 个建行格回写**（human_only 格回写「无法验证」+ `reason='human_only'`，见 A4①），所以「某格 `ai_verdict IS NULL`」= 打表器没跑到这格，是**故障信号**，不是正常态。

| 情形 | 机械判据（三条**任一**成立即哑火） | 处置 |
|---|---|---|
| **AI 整轮哑火** | **①** 本轮 AI「确定判定」（`ai_verdict ∈ (通过,不通过)`）格数 **== 0**；**②** 基线 18 个 machine_db 格中**故障类**无法验证 **≥ 9**（半数，切回口径为 20 格中 ≥10）；**③（v4 新增）** 本轮 **缺格数 > 0**（`SELECT count(*) … WHERE run_id=:rid AND ai_verdict IS NULL` ≠ 0） | run 标 `ai_incomplete` + `ai_status='dumb'`；**不建** bug/trace 任务、**不进**熔断；单开 1 个 P0「AI 打表器整轮哑火」（描述含缺格格号清单）；**闸对 `ai_incomplete` 一律拦**（走 `ai_run_infra_error` 路径，与「格红」机械可区分，见 J15）|
| **熔断（规程/数据源疑似分叉）** | 在 AI 未哑火的前提下，**非绿格（final_state ∈ {红, 未定}）占 36 的比例 > 1/3** | 不建 36 个散任务，改开 1 个 P0「规程/数据源疑似分叉」 |
| **常规分流** | 未哑火且未熔断 | 每 run ≤1 bug 任务 + ≤1 追查任务（A7） |

> **条件三为什么定在「>0」而不是「> N」**：任何 N>0 的门槛都留出一个「少回写 N 格且不被发现」的窗口，而这 N 格恰好可以是攻击者/坏掉的采证器挑出来的那几格（缺格行靠人列单列判是 r3-P1-2 点出的原路径）。回写全 36 格对 AI 侧零额外成本（human_only 格本来就要回写「无法验证」），门槛定 0 不会误伤。
> **补跑路径**：`ai_incomplete` 不是终态——单独重跑打表器补齐缺格后重算，缺格数归 0 且条件①② 不成立即摘掉 `ai_incomplete`，闸重新可绿。

---

## AI 列可见性时序表（v3 新增，← r2-P1-4）

裁剪**不是逐端点打补丁**，而是在 `loadChecks`（`acceptance.js:151`）/`loadRunsWithChecks`（`:155-171`）的 SQL 层做**列白名单**：AI 四列（`ai_verdict`/`ai_evidence`/`ai_run_at`/`adjudication`）默认不 SELECT。

**裁剪判据（写死，堵 r2-P1-4 的三者互斥）**：

1. **逐行判定，不是响应级**——一行是否带 AI 四列，看**该行所属 run** 的状态（`loadRunsWithChecks` 是多 run 响应，响应级判据无解）。
2. **gp 级防跨轮锚定闸**——若该 `gp_id` 下存在**任一**未达 `human_complete` 的 run（= 本轮填表进行中），则该 gp 的**全部轮次**（含已定案的历史轮）AI 四列与 `adjudication` 一并隐藏。J5-A 把 `check_key` 改成规程格号后，S3-c1 每轮同名，不加这条闸则员工在本轮填表期能从「验收历史」页看到上一轮同格的 AI 判定与裁决理由，锚定照旧成立。
3. **合看态**需显式 `?view=review` 且服务端校验该 run 已达 `human_complete`（Staff Hub 员工身份亦可，见 Step 7）。
4. **（v4 新增，← r3-P1-3）复盘窗口 = T4 到下一轮 T0 之间，且开新轮以复盘闭环为前置**——同 gp 的**最近一个** `adjudicated` run 若 `detail.review_closed_at` 为空，则**拒绝**为该 gp 建新 run（HTTP 409，提示「上一轮复盘未闭环」）。这条不是新增的可见性规则，而是**保证判据 2 与 Step 7 不打架的时间安排**：判据 2 一旦生效（新轮开出来），历史轮裁决理由就看不见了，所以复盘必须在那之前做完。

| 时刻 | run 状态 | 员工看得到 AI 四列 / adjudication？ | 依据 |
|---|---|---|---|
| T0 建单 | `pending` | 否 | 判据 2 |
| T1 员工操作流 + 填表期 | `pending`/`in_review` | 否（含全部历史轮） | 判据 2 —— 决策② 防锚定的**唯一**硬窗口 |
| T2 最后一格提交 | `human_complete` | **是**（本轮 + 历史轮同时解锁） | 判据 1+3 |
| T3 主理人裁决中 | `human_complete` | 是（AI 列可见，adjudication 逐格随裁决落库而出现） | 判据 1 |
| T4 定案 → 复盘窗口 | `adjudicated` | **是——前提：该 gp 下不存在未达 `human_complete` 的 run**（v4 补，判据 2 是 gp 级闸，对已定案轮同样生效）。此窗口从定案起，到该 gp 下一轮建单为止；判据 4 保证窗口不会被下一轮抢先关掉 | Step 7 = 决策③ 的要求 + 判据 2/4 |

> **冲突消解（v4 收口）**：决策③ 要求员工在裁决后看得到裁决理由（Step 7），而防锚定只须约束「**本轮人列提交前**」这一段（T1）。v2 的 A2 把 `adjudication` 无条件列进禁止集，才与 Step 7 打架；v3 用时序表把两者分到 T1 / T2+ 两段，消解了**同一轮**内的冲突；但 v3 的 gp 级跨轮闸让同一个冲突在**跨轮维度**重新长出来——下一轮一开，上一轮的裁决理由当场消失，而 Step 7 的分支恰恰写着「异议进下一轮仪式复盘」（r3-P1-3）。v4 取**修法一**：把复盘窗口写死在开新轮之前，并用建单期 409 强制（判据 4 + A15）。
> **为什么不给已定案轮的 `adjudication` 开跨轮可见例外**：裁决理由几乎必然引用 AI 证据（「AI 截图显示任务已终态，故推翻人列的不通过」），要论证它「不携带本轮 AI 判定信息」做不成；而格号跨轮同名（J5-A），上一轮同格的裁决理由对本轮就是直接锚定。防锚定强度优先。

### AI 列出口清单（防锚定裁剪的完整靶面）

| # | 出口 | 现状（实测） | 处置 |
|---|---|---|---|
| 1 | 内网 5221 `GET /acceptance/pending` | `:303`→`loadPendingRuns`→`SELECT *` | 列白名单 |
| 2 | 内网 5221 `GET /acceptance/runs?gp_id=` | `:264-274`，不过滤 status，一次返回该 GP 全部 run 全量 checks（v3 实测） | 列白名单 + **gp 级闸**（判据 2） |
| 3 | 内网 5221 `GET /acceptance/runs/:run_key` | `:277-289`→`loadChecks`→`SELECT *` | 列白名单 + 默认态=员工态 |
| 4 | 公网 5223 `GET /acceptance/pending` | `:332-340`，与内网共用 loader | **本期下线**（J19，Notion Worker 已停摆无消费者） |
| 5 | 公网 5223 `GET /acceptance/catalog` | `:317-330`，只回 catalog 不含 checks | 保留，登记，无需改 |
| 6 | Staff Hub 反代 `/api/staff/acceptance/*` | `services/acceptance.ts:52` 整数组直出 → `staff.ts:319` 整包展开 | 反代层同步白名单（双保险） |
| 7 | 新增的 gate 只读端点（D5） | 不存在 | 只回 `{run_key, backend_sha, frontend_sha, spec_sha, status, gate_verdict, red_cells[]}`，**不回 AI 列原文**；独立 `ACCEPTANCE_GATE_TOKEN` |
| 8 | repo 内 `acceptance-spec/runs/*/ai-column.json` | 两轮历史产物已在 git 里，员工 clone 即可见 | 本期起不再 commit（Gate A 第⑤层） |
| 9 | psql 直查 | 员工无 DB 账号（Staff Hub 走飞书白名单身份，`middleware/staff.ts:44`） | 登记为组织约束，不做代码闸 |

---

## Golden Path 步骤

主体：**发版人 / 验收员工 / 主理人**。步骤名写「他感知到什么」，工序细节全部下沉到【挂片】【分支/判定点】。v3 把 v2 的 Step 2 拆成「员工操作流」与「AI 采证」两步（← J17-C），共 9 步。

| 步骤（承诺） | 现状 | 验证等级承诺 | 【挂片】 | 【分支/判定点】 |
|---|---|---|---|---|
| **Step 1** 发版人发起这一轮验收后，员工当天在待办里就看到一张属于这个构建的单子，单头写着它验的是哪个构建（前后端各一个 sha）、哪一版规程 | **半成** | L2（服务端真验） | run 建单端点幂等(已有，`acceptance.js:183`)／**36** 有效格从规程展开成行(**缺失**)／每格 `kind` 来源(**缺失**，yaml 全文零个 kind 字样，J14)／`backend_sha` + `frontend_sha` 双源对账写进单头(**缺失**；后端源② `deploy-staging-hk.yml:42` 已 pin `github.sha` **可直接用**，前端 `deploy-dashboard-staging.yml:57` 仍 `reset --hard origin/main` **需改 pin**，且前端全仓无 build sha 标记)／规程版本锁 `version`+`spec_sha`(**半成**，`acceptance_runs.version` 列已有但没人写)／侧边栏待办角标(**缺失**，`App.tsx:46-48` 是纯文本 NavLink)／仪式发起通知(**缺失**) | 分支：同构建已有 run → 幂等复用不重开；任一源两两不等 → **拒绝建单**并告警；**（v4 新增 ← r3-P1-3）同 gp 最近一个 `adjudicated` run 的 `detail.review_closed_at` 为空 → 拒绝建单 409「上一轮复盘未闭环」**；**（v4 新增 ← r3-P1-1①）单头「测试用客户账号」不属于 AI 采证账号可见租户集合 → 拒绝建单**。判定点 **J5**（格号）／**J10**（排除集）／**J12**（冻结锁与双源）／**J14**（kind）／**J16**（仪式）／**J2 判据4**（复盘窗口）／**J17 前提①**（同租户） |
| **Step 2**（v3 新增）员工先把这一轮的现场跑完——真机装绑、发起采集、走到私信——单头上留下这一轮用的是哪个客户账号、任务编号和暗号，后面所有证据都对得上这一轮 | **半成** | **L3（真机真验）** | 规程 op 序列(**已有**，yaml 14 步 op 字段)／现役网页的单头字段(**已有**，`lib.mjs:292-299` 有 测试日期/测试人/**测试用客户账号**(`:297`，`data-f=tenant`)/手机型号/客户端编号/本轮采集任务编号/本轮暗号)／这些字段落进 `acceptance_runs.detail`(**缺失**)／**「测试用客户账号」= 验收专用租户的机械校验**(**缺失**，v4 新增 ← r3-P1-1①)／录屏与截图证据规范(**已有**，`lib.mjs:370-372`) | 分支：员工现场跑不通（真机掉线/装不上）→ 本轮直接标 `stale` 重开，不进 AI 采证；**（v4 新增）员工用了非验收专用租户的授权码 → 建单期即被拒（A16），不允许跑到 Step 3 才发现**。判定点 **J17**（仪式两段式、点火边界与两条前提）／**J16**（工时） |
| **Step 3** 员工坐下来判之前，AI 已经把它能在网页上看见的那部分先看过一遍；它一根火都不点，看不见的老实说看不见，还说得出为什么看不见 | **半成** | **L3（真环境真验）** | 采证器走真 staging UI + 截图 + `innerText`(**已有且有 2 轮真实产物**，`capture.mjs:32,54-57`)／常驻登录凭据(已有，1Password CS)／自动触发(**缺失**，全仓无 workflow/npm script，`capture.mjs:236` 硬编码 `trigger:'manual'`)／**删除「发起采集」交互，`action` 枚举收敛为单值 `observe`**(**缺失**，现 `capture.mjs:152-163` 真点「开始采集」)／按单头任务编号定位本轮任务(**缺失**)／结论回写 `POST /acceptance/ai-results`(**缺失**，产物落 repo 与 DB 零通路)／reason 与静态属性的服务端校验(**缺失**)／**开跑前自检登录租户 == 单头「测试用客户账号」**(**缺失**，v4 新增 ← r3-P1-1①)／**时限两格按口径取数**(基线不采；Gate B 第4条通过后改读页面创建/终态时间戳算差值，见 §口径切换表)／**对全部 36 建行格回写、零缺格**(**缺失**，v4 新增 ← r3-P1-2)／Gate A 六层(**缺失**) | 分支：某格页面打不开 → 记 `page_unreachable`（**故障类**，不享受 Q3 绿通道），不中断整轮；**（v4 新增）登录租户与单头不一致 → 整轮直接标 `ai_incomplete` 并告警退出，禁止继续跑成一堆「无法验证」**（否则 11 个依赖本轮采集数据的格会被判成故障类、触发哑火，看起来像打表器坏了，实则是租户配错，两种故障必须可区分）。判定点 **J3**（执行体）／**J4**（诚实边界）／**J17**（点火边界与前提）／**J19**（回写凭据） |
| **Step 4** 员工打开验收页，看到的还是那张熟悉的表；AI 那一列此刻对他根本不存在，翻 F12、换端点、走公网、翻上一轮的历史单都翻不出来 | **半成** | L2（服务端真验） | 三个页面(**已有**，路由 `App.tsx:66-68`)／分批草稿增量提交(已有)／`submitted_by` 防伪注入(**已有且有测试**，`middleware/staff.ts:44`→`staff.ts:338`)／**服务端列裁剪(完全缺失**，三跳全裸：`acceptance.js:155-171` `SELECT *` → `services/acceptance.ts:52` → `staff.ts:319`)／**gp 级跨轮闸**(**缺失**，`验收历史` 入口已存在 `App.tsx:49-51`)／9 条出口逐条覆盖(**缺失**)／第三态措辞统一为「无法验证」(**Staff Hub 已是**，`AcceptanceDetailPage.tsx:141-143`；**现役 generated HTML 仍是「不适用」**，`lib.mjs:430`) | 分支：员工只填一半离开 → 草稿按子集留存（既有）。判定点 **J2**（可见时机与时序表）／**J6**（存储形态与裁剪位置）／**J18**（现役网页处置） |
| **Step 5** 员工把最后一格交上去的那一刻，两列一起亮出来，哪些一致、哪些打架、哪些两边都没验成，一眼看清 | **缺失** | **L3（真浏览器真页面截图）** | 九组合矩阵合看页(**缺失**，全仓 grep「对比页\|四象限」非 md 零命中)／`human_complete` 解锁态(**缺失**)／AI 缺格降级态(**缺失**)／需真机/需场景的格在填表页提前标出(**缺失**，`device` 列已有已渲染，`scenario_required` 只在 `cells-map.mjs:23-67` 未进 yaml)／fixedNa 步骤渲染为灰带「固定不适用（本版未做）」(**缺失**) | 分支：AI 列缺格 → **Q0′ 恒判「未定」并拦**（v4 改，← r3-P1-2；缺格不因人列通过而变绿），合看页把缺格标成「AI 未回写」并显示整轮 `ai_incomplete` 横幅与补跑入口。判定点 **J1**（放行分母）／**J8**（这页从哪打得开） |
| **Step 6** 打架和没验成的格子主理人当场拍板；拍完这一版验收就有了定论，定论跟着两个构建号和规程版本一起存档 | **缺失** | L2（服务端真验） | `adjudication` 字段与裁决 API(**缺失**，`\d acceptance_checks` 无此列)／裁决人与理由留痕(**缺失**)／run 状态机 `adjudicated` 与 `gate_verdict`(**缺失**，`369_acceptance_tables.sql:11` 只许 4 值)／hard 格裁决绿自动开 P0(**缺失**) | 分支：Q5/Q6/Q8 → bug 任务；Q4/Q7 → 追查任务；Q9 → 补验证手段任务；非绿格占比 >1/3 → 熔断；AI 整轮哑火 → 走 `ai_run_infra_error` 不进熔断。判定点 **J1**／**J15** |
| **Step 7** 员工回到同一页，能看到主理人怎么判的、为什么这么判——尤其是自己判红被推翻的那几格；有话要说就在这一轮结束前说完，说完这一轮才算真的关掉 | **缺失** | L2（服务端真验） | 员工身份的裁决回显视图(**缺失**)／裁决理由对员工可见的权限口径(**缺失**，时序表 T2 起开放)／**复盘闭环标记 `detail.review_closed_at` 与「复盘完成」按钮**(**缺失**，v4 新增 ← r3-P1-3)／**开新轮前置校验**(**缺失**，落在 Step 1 建单端点) | 分支：员工对裁决有异议 → **在本轮定案后、下一轮开单前**的复盘窗口里在该格追加 note，并由发起人点「复盘完成」写 `review_closed_at`（不阻塞本轮定案，但**阻塞下一轮开单**——判据 4，未闭环则建单 409）。**（v4 改，← r3-P1-3）复盘不再挂到「下一轮仪式」上**：下一轮一开，gp 级闸就把上一轮 AI 四列与 `adjudication` 一并关掉，挂过去等于挂到看不见的地方。判定点 **J2**（判据 4）／**J16**（仪式前置） |
| **Step 8** 发版人点 promote 的时候，如果这一版的表没绿，闸当场拦住他，并且直说卡在哪几格；拿旧单子想放行新构建、或者只换了前端没换后端，也一样拦 | **缺失** | **L3（真闸真跑）** | `release-gate` job 三步式结构(**已有且真在用**，5 次真实 dispatch，`promote-all-prod.yml:59-138`)／后端 `sha` 输入与 `DEPLOY_SHA` 解析(**已有**，`:164-184`)／**前端 `promote-dashboard` 读 `inputs.sha`**(**缺失**，`:206-230` 全段无 INPUT_SHA，且 `reset --hard origin/main` 会把 backend 刚 pin 的同一个 repo 复位)／第三证据项(**缺失**，落点 `:138` 之后)／gate 脚本 + selftest workflow(**缺失**)／棘轮与计数(**缺失**) | 分支：取数失败 = **红**（fail-closed），仅此情形可填 `bypass_two_column_infra`；格红一律不可豁免。判定点 **J7**（取数通路）／**J9**（怎么验闸而不真发版）／**J12**（sha 绑定）／**J15**（逃生阀） |
| **Step 9**（出错路径）任何一步塌了，主理人在验收单上就看得见是哪一步塌的，并且能重开一轮而不丢上一轮的留痕 | **缺失** | L2（服务端真验） | run 的 `stale` 状态与 `ai_incomplete` 标记(**缺失**)／同 GP 多轮 run 并存(**当前物理不可能**，`acceptance_checks_check_key_key` 全局 UNIQUE)／跨 run 写隔离(**缺失且是新坑**，`acceptance.js:62-66` `UPDATE … WHERE check_key = $4` 不带 run_id) | 分支：验收期间 staging 重部署或规程改版 → run 标 `stale`，人列提交 409，必须重开新 run。判定点 **J5**／**J12** |

### 出错路径的用户视角（发现 → 恢复）

| 故障 | 用户怎么发现 | 怎么恢复 |
|---|---|---|
| AI 打表器中途挂 | 单头显示「AI 列不完整（已完成 N/36）」+ 缺格格号清单 + 自动开的 P0 | 员工照常填（人列不受影响）；**缺格按 Q0′ = 未定，闸拦**；整轮标 `ai_incomplete`（哑火条件三）；单独重跑打表器补齐后自动摘标 |
| **AI 采证账号与本轮客户账号不同租户**（v4 新增） | 建单期即被拒（A16），提示「测试用客户账号不属于验收专用租户」；若绕过建单校验则 Step 3 自检时整轮 `ai_incomplete` 并告警 | 改用验收专用租户的授权码重新绑机并重开 run；**不允许**让 AI 带着看不见的租户跑完一轮判一堆「无法验证」 |
| **AI 打表器整轮哑火**（登录失效/staging 全站不可达） | 单头显示「AI 列本轮无效（确定判定 0 格）」+ 自动开的 P0 任务 | 修通路后重跑采证；**不进**熔断、不建 bug/trace；闸一律拦到 AI 列有效或主理人逐格裁决 |
| staging 在验收中途被重新部署 | 提交人列时 409，页面提示「本单验的构建已失效」 | 重开新 run（新 sha 二元组），旧 run 存档为 `stale`，留痕不删 |
| 规程 yaml 改版 | 同上（`spec_sha` 不匹配） | 同上；改版说明写进新 run 单头 |
| 放行闸取不到双表数据 | promote 时 release-gate 红，summary 写「双表取数失败（infra_error）」 | 修通路后重跑；紧急发版填 `bypass_two_column_infra`（进 summary 大字 + 棘轮计数） |
| 员工与 AI 大面积分歧 | 合看页整列变分歧色 | 先怀疑打表器（核 AI 证据截图是否为登录页）；非绿格占比 >1/3 自动熔断，改开「规程/数据源疑似分叉」P0 |
| **AI 打表器误触达真人（红线7 暗号已发出）** | 收信端账号出现非计划私信 / 抖音风控告警 / 打表器日志出现非 allowlist host 或 `collect/start` 调用 | ①立刻停跑该 workflow 并吊销 `STAGING_ACCEPTANCE_*` + `ACCEPTANCE_AI_TOKEN`；②在收信端截图取证，本轮 run 直接标 `stale` 作废（暗号已消耗，S12 本轮不可复用，需换新暗号）；③开 P0 复盘 Gate A 哪一层被穿；④Bark 告警主理人（不走飞书）；⑤补 A11 的机械断言覆盖被穿的那一层后才允许重新开跑 |

---

## 验收断言（A1-A16，冻结后 AI 不可改）

对齐 PRD `Final E2E`，按 **36 格**口径与 r2/r3 findings 修正。所有 shell 断言禁用裸 `grep -c`（`|| true` 兜底）。涉及「AI 可判格数」的断言一律按 §口径切换表从 yaml 解析取数，**不硬编码 18 或 20**。

**A1 · 一张表两列（决策①）**
```sql
SELECT check_key, result, submitted_by, ai_verdict, ai_evidence, ai_run_at
FROM acceptance_checks WHERE run_id = :rid AND check_key = 'S3-c1';
```
断言：恰 **1 行**；`result` 与 `ai_verdict` 均非空且同属枚举 `('通过','不通过','无法验证')`；`check_key ~ '^S\d+-c[1-4]$'`；`SELECT count(*) … WHERE run_id=:rid` = **36**；`SELECT count(*) … WHERE run_id=:rid AND check_key LIKE 'S14-%'` = **0**。

**A2 · 背靠背（决策②，服务端裁剪；读侧 9 出口 + 写侧 3 条）**
读侧——该 gp 下存在未达 `human_complete` 的 run 时，以下全部成立：
```bash
AI_COLS='ai_verdict|ai_evidence|ai_run_at|adjudication'
test "$(curl -s "$STAFF_HUB/api/staff/acceptance/pending"                | grep -c -E "$AI_COLS" || true)" = "0"   # 出口6 反代
test "$(curl -s "localhost:5221/api/brain/acceptance/pending"            | grep -c -E "$AI_COLS" || true)" = "0"   # 出口1 内网直连
test "$(curl -s "localhost:5221/api/brain/acceptance/runs?gp_id=$GP_ID"  | grep -c -E "$AI_COLS" || true)" = "0"   # 出口2 含全部历史轮（gp级闸）
test "$(curl -s "localhost:5221/api/brain/acceptance/runs/$RUN_KEY"      | grep -c -E "$AI_COLS" || true)" = "0"   # 出口3 默认态
test "$(curl -s "…/acceptance/runs/$RUN_KEY?view=review" -o /dev/null -w '%{http_code}')" = "403"                   # 合看态被拒
test "$(curl -s -H "Authorization: Bearer $GATE_TOKEN" "$GATE_ENDPOINT?sha=$SHA" | grep -c -E "$AI_COLS" || true)" = "0"  # 出口7 gate 不回原文
test "$(cd $ZJ_REPO && git ls-files 'acceptance-spec/runs/*/ai-column.json' | grep -c "$RUN_KEY" || true)" = "0"     # 出口8 产物不进 git
```
**反向断言**（消解 r2-P1-4 的三者互斥）：该 gp 下**无**未达 `human_complete` 的 run 时，出口2 与出口3 的 `?view=review` 返 200 **且含** AI 四列（同一组 curl 反向再跑一次）——Step 7 与 A3 由此可同时成立。

写侧（v3 新增，← r2-P0-3）：
```bash
# 出口10：AI token 打人列写端点 → 4xx（该端点本期已下线，断言 404/401 皆可，不得 2xx）
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $AI_TOKEN" \
     "$PUBLIC_5223/acceptance/results" -d '{"results":[{"check_key":"S3-c1","result":"通过"}]}')" != "200"
# 出口11：AI token 打 ai-results 且 body 夹带人列字段 → result/submitted_by 必须原样不变
curl -s -X POST -H "Authorization: Bearer $AI_TOKEN" "$PUBLIC_5223/acceptance/ai-results" \
     -d '{"results":[{"check_key":"S3-c1","ai_verdict":"通过","result":"通过","submitted_by":"员工甲"}]}'
# psql 复核：该格 result 仍为 NULL，submitted_by 仍为 NULL
# 出口12：gate token 打任何 POST → 401
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $GATE_TOKEN" \
     "$PUBLIC_5223/acceptance/ai-results" -d '{}')" = "401"
```

**A3 · 第二轮不炸 + 跨 run 写隔离**
```sql
SELECT count(*) FROM acceptance_checks WHERE check_key = 'S3-c1';              -- >= 2
SELECT count(DISTINCT run_id) FROM acceptance_checks WHERE check_key = 'S3-c1'; -- >= 2
```
约束已改：存在 `UNIQUE (run_id, check_key)`，不存在全局 `UNIQUE (check_key)`。
**隔离断言**：向 run A 提交 `S3-c1='通过'` 后，run B 的 `S3-c1` 仍为 NULL（堵 `acceptance.js:62-66` 的无 run_id UPDATE）。
> 本断言走 psql 直查，不经 API，故与 A2 的读侧裁剪不冲突。

**A4 · AI 诚实边界（Gate A 的机械化，决策⑤；绑静态属性 + v4 补零缺格）**
> 下列 `:human_only_list` 与「确定判定上限」按 §口径切换表取值：**基线 18 格 / 上限 18**，Gate B 第4条通过后切 16 格 / 上限 20。断言脚本从 yaml 解析取数，不硬编码数字。
```sql
-- ① human_only 格（yaml 解析得出）不得出现「通过」，且必须有回写
SELECT count(*) FROM acceptance_checks
WHERE run_id=:rid AND check_key IN (:human_only_list) AND (ai_verdict IS NULL OR ai_verdict <> '无法验证');  -- == 0
-- ② AI 给出确定判定的格数上限 = machine_db 格数（基线 18）
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_verdict IN ('通过','不通过');  -- <= 18
-- ③ reason 与格的静态属性绑定（不是 AI 自报说了算）
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_evidence->>'reason'='human_only'
  AND check_key NOT IN (:human_only_list);                 -- == 0
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_evidence->>'reason'='scenario_not_triggered'
  AND check_key NOT IN (:scenario_required_6_list);        -- == 0
-- ④ 整轮哑火识别 · 条件① 确定判定为 0（堵「count=0 恒满足上限」）
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_verdict IN ('通过','不通过');  -- == 0 时
-- 断言 acceptance_runs.detail->>'ai_status' = 'dumb' 且 gate_verdict='红'
-- ⑤ 整轮哑火识别 · 条件③ 零缺格（v4 新增，← r3-P1-2）
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_verdict IS NULL;   -- 正常轮 == 0
-- 构造轮：造一个「只回写 8 个 hard 格 + 2 格、其余 26 格不提交」的 run，
-- 断言 detail->>'ai_status'='dumb' 且 run 标 ai_incomplete 且 gate_verdict='红'
-- 且那 26 格的 final_state 全为「未定」（不得因人列通过而变绿）
```
并断言：向 `POST /acceptance/ai-results` 提交「非 human_only 格 + reason='human_only'」→ **HTTP 400**（服务端强校验，不落库）。

**A5 · 九组合矩阵机械对表**
构造一个测试 run，把 9 种组合各造至少 1 格（含 Q0/Q0′/Q3′），断言：
- 每格 `final_state` 与本文矩阵表逐行一致（服务端计算，psql 读回）；
- `gate_verdict='绿'` 当且仅当 **36** 格 `final_state` 全绿；任一 hard 格非绿 → `gate_verdict='红'` 且 `red_cells[]` 含该格号；
- hard 格为 Q3′（故障类无法验证）时**不得**被判绿；
- **（v4 新增，← r3-P1-2）Q0′ 格的 `final_state` 恒为「未定」，与人列取值无关**——同一格分别构造「人列通过 + AI 缺格」「人列不通过 + AI 缺格」「人列无法验证 + AI 缺格」三种，三次读回都必须是「未定」，不得出现绿或红。本条与闸判据「缺格一律拦」是同一口径的两面，实现者无二选一空间。

**A6 · 合看页 + 裁决落库 + 员工回显（决策③）**
截图证据 **4 张**：①九组合矩阵全貌（至少含双绿/分歧/双红/仅人列绿四色 + **缺格「未定」图例**（v4 改，缺格不再是降级而是拦） + 第14步灰带）；②一个分歧格展开，左 AI 证据右员工 note 并排；③主理人点裁决后的确认态；④**员工身份登录**同一页，看到裁决人与理由。加 psql：
```sql
SELECT adjudication->>'verdict', adjudication->>'by', adjudication->>'reason', adjudication->>'at'
FROM acceptance_checks WHERE run_id=:rid AND adjudication IS NOT NULL;  -- 四字段全非空
```

**A7 · 分流建任务（聚合式 + 熔断 + 哑火分流；v3 重写）**
```sql
-- 每 run 至多一个 bug 任务、至多一个追查任务
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='bug';       -- <= 1
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='trace';     -- <= 1
-- anchor 三件套每行非空
SELECT payload->'anchor'->>'journey_id', payload->'anchor'->>'gp_id', payload->'anchor'->>'step_id'
FROM tasks WHERE payload->>'acceptance_run_key'=:run_key;
```
并断言：bug 任务描述含**全部** `final_state='红'` 的格号（SQL 对表，不手算分母）；追查任务描述含全部 Q4/Q7 格号；构造「非绿格占比 >1/3」的 run → **不建** bug/trace，改建 1 个 P0「规程/数据源疑似分叉」；构造「AI 确定判定 0 格」的 run → **不建** bug/trace、**不建**分叉 P0，改建 1 个 P0「AI 打表器整轮哑火」。
> **查重谓词需加 bucket 维度**：既有谓词是「同 run_key 无未终态任务」且不区分 bucket（`acceptance.js:100-106`），照抄则第二个桶永远建不出来（← P2-3）。

**A8 · 放行闸第三证据项（决策⑥；三段取证，缺一不算）**
- **a) 脚本四情形**：`scripts/release-gate/two-column-gate.sh` 以 `--fixture` 喂构造响应（不碰生产 PG），四条 exit code 断言：未定案 → `exit 1` 且 `::error::` 指名格号；定案且两个 sha 均匹配 → `exit 0`；取数失败 → `exit 1` 且 summary 写 `infra_error`；**hard 格红 + 填了 `bypass_two_column_infra` → 仍 `exit 1`**。
- **b) selftest workflow**：`two-column-gate-selftest.yml`（`workflow_dispatch`，不 needs 任何 promote job）在真 CI 环境跑同一脚本打**真** gate 端点，绿。
- **c) 接线证明**：`grep -c 'two-column-gate.sh' promote-all-prod.yml` ≥ 1，且**首次真实 promote** 的 `release-gate` job 日志里出现「证据③ 双表绿」step 的真实输出（本 GP 的收官条件）。

**A9 · sha 绑定与双源对账（v3 补前端侧）**
```sql
SELECT detail->>'backend_sha',  detail->>'backend_sha_src2',
       detail->>'frontend_sha', detail->>'frontend_sha_src2',
       version, detail->>'spec_sha'
FROM acceptance_runs WHERE id=:rid;   -- 六项均非空；两组 sha 各自组内相等且为 40 位
```
- 源①（被测系统自报）：后端 `GET /api/version` 的 `build.sha`；前端 staging 页面的 build sha 标记（新增，见 D2）。
- 源②（构建侧 GitHub API）：后端 `deploy-staging-hk.yml` 最近成功 run 的 `headSha`（v3 实测该 workflow `:42` `DEPLOY_SHA=${{ github.sha }}`、`:80` 注入容器 `BUILD_SHA`，故 headSha ≡ 实际部署 sha）；前端 `deploy-dashboard-staging.yml` 最近成功 run 的 `headSha`（**前提：该 workflow `:57` 由 `reset --hard origin/main` 改为 pin `github.sha`，否则两源可合法不等**）。
- 建单时任一组两源不等 → **拒绝建单**（HTTP 4xx + 无新行）。
- gate 断言：`PROMOTE_SHA`（`inputs.sha` 或 `origin/main` HEAD，与 `promote-all-prod.yml:183-184` 同算法）必须**同时**等于定案 run 的 `backend_sha` 与 `frontend_sha`，任一不等 → `exit 1` 且 `::error::` 写明「这个构建没有验收单」。
- **`promote-dashboard` 必须消费 `inputs.sha`**（现 `:206-230` 全段无 INPUT_SHA），否则闸绑死后端而前端仍按执行时 main HEAD 上产，两列验的网页与上产的网页不是一份。

**A10 · 冻结锁（决策⑥）**
构造 staging 重新部署 → 人列提交 409 且 run 转 `stale`；构造 yaml 改版（`spec_sha` 变）→ 同样 409 + `stale`。curl 状态码 + psql 双证。

**A11 · Gate A 能力剥夺（v3 增 e 条）**
- a) 打表器 workflow：`runs-on` 恰为 `ubuntu-latest`，全文 `grep -c 'self-hosted\|android-capable'` == 0；
- b) 该 job 引用的 `secrets.*` 集合 ⊆ 白名单三项且**不含** `ACCEPTANCE_API_TOKEN`（smoke 解析 workflow yaml 断言）；
- c) Playwright allowlist 单测：非 `staging-autopilot.zenjoymedia.media` 的 host 被 abort；
- d) 判官任务 payload 无 `target_environment:'mac_web'`（不走 `spawn.js:66` 宿主逃逸）；
- **e) 零点火（v3 新增）**：`cells-map.mjs` 的 `action` 取值集合恰为 `{'observe'}`（单测遍历 CELLS_MAP 断言）；采证器全文 `grep -c '开始采集\|collect/start\|trigger_collect'` == 0。

**A12 · 逃生阀可观测与棘轮**
```sql
SELECT count(*) FROM acceptance_runs WHERE detail->>'bypass_used'='true' AND created_at > now()-interval '30 days';
SELECT count(*) FROM acceptance_checks c JOIN acceptance_runs r ON r.id=c.run_id
WHERE c.check_key IN (:hard_8_list) AND c.adjudication->>'verdict'='绿' AND r.created_at > now()-interval '30 days';
```
断言：gate summary 打印两个计数；构造「近 30 天 >3 次」→ gate 直接 `exit 1`（棘轮生效）。

**A13 · 员工待办信号**
建单后：`GET /api/staff/acceptance/pending` 返回 count ≥ 1；Staff Hub 侧边栏「验收」右侧出现数字角标（截图为证）；仪式发起通知实际送达（Bark 回执截图）。

**A14 · fixedNa 与红线13（v3 新增，← r2-P0-1 / r2-P1-5）**
```sql
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND check_key LIKE 'S14-%';  -- == 0
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid;                             -- == 36
```
并断言：
- 建单生成器对任何 `fixedNa:true` 的步骤零建行——喂一份构造 yaml，把 S7 也标 `fixedNa:true`（S7 有效格 = c1/c2 共 2 个，v3 实测），建行数必须从 **36 降到 34**，且结果里不含任何 `S7-*`；
- 合看页把第 14 步渲染成不可填灰带，文案含「固定不适用（本版未做）」（截图为证）；
- run 的结论文案恒含「本轮结论只覆盖前13步」——与现役网页 `lib.mjs:381` 原文一致（红线13 的承载物）；
- 员工填表页三态按钮恰为 `通过/不通过/无法验证`，**不存在「不适用」按钮**（DOM 断言）。

**A15 · 复盘窗口与开新轮互斥（v4 新增，← r3-P1-3）**
```bash
# ① 上一轮已定案但未闭环复盘 → 该 gp 建新 run 被拒
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "localhost:5221/api/brain/acceptance/runs" \
     -H 'Content-Type: application/json' -d "{\"gp_id\":\"$GP_ID\",\"backend_sha\":\"$NEW_SHA\",…}")" = "409"
# ② 写入闭环标记后同一请求返 2xx
curl -s -X PATCH "localhost:5221/api/brain/acceptance/runs/$PREV_RUN_KEY/review-closed" -d '{}'
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "localhost:5221/api/brain/acceptance/runs" … )" = "200"
```
```sql
-- ③ 闭环标记有留痕（谁在什么时候关的）
SELECT detail->>'review_closed_at', detail->>'review_closed_by'
FROM acceptance_runs WHERE run_key=:prev_run_key;   -- 两项非空
```
并断言（可见性闭合）：在**复盘窗口内**（上一轮 `adjudicated`、该 gp 无未达 `human_complete` 的 run），员工身份打 `GET /acceptance/runs/$PREV_RUN_KEY?view=review` 返 **200 且含** `adjudication`；**下一轮建单之后**同一请求的 AI 四列与 `adjudication` **一并消失**（A2 读侧断言复用）——两条一起证明「复盘窗口真实存在且确实会被下一轮关掉」，这正是判据 4 存在的理由。

**A16 · AI 采证账号与本轮客户账号同租户（v4 新增，← r3-P1-1①）**
```sql
-- ① 单头字段真的落库了（v3 的 D4 清单漏项）
SELECT detail->>'tenant_account', detail->>'device_model', detail->>'client_no',
       detail->>'collect_task_no', detail->>'passphrase'
FROM acceptance_runs WHERE id=:rid;    -- 五项均非空
```
```bash
# ② 建单期机械校验：填一个不属于验收专用租户的客户账号 → 拒绝建单，且无新行
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "localhost:5221/api/brain/acceptance/runs" \
     -d '{"gp_id":"'$GP_ID'","detail":{"tenant_account":"someone-else@example.com"},…}')" != "200"
# ③ 采证期自检：把采证器的登录账号换成另一租户的号跑一轮 → 整轮 ai_incomplete 且不产生任何「无法验证」回写
# psql 复核：detail->>'ai_status'='dumb'、ai_incomplete=true、count(ai_verdict IS NOT NULL)==0
```
并断言（Gate B 第5条的实证留痕）：一轮真实 run 里，员工用验收专用租户授权码绑机后，AI 采证的 `run-summary.json` 里 `machines_online` ≥ 1 **且**其中含员工本轮绑的那台机型号（与单头 `device_model` 对得上）——这是「AI 真的看得见员工造的数据」的唯一直接证据，也是候选 C 那 18/20 格可判量的地基。

---

## 判定点登记表（J1-J19，批准即写 decisions 冻结）

**J1 · ⚠️「双表绿」放行判据的分母**（v3 改数）
- 候选：A 36 格**双列都绿** ／ B machine_db 格双绿 + human_only 格人列独判 ／ C 只看 8 红线格 ／ **D 36 格「最终态」全绿**（两类格数按 §口径切换表，基线 18/18）
- **REC = D**（分母由 37 改 36，见 J10）
- 依据：AI 天花板是有限确定判定 + human_only 格（基线 18）恒无法验证，**A 物理不可达**；B/C 把「人列没验成」和「没填」当成默认放行，正是 product#P0-1 的绕过口。D 用「最终态」统一口径：绿只来自 Q1、合法 Q3、或裁决绿。v2 的 D 之所以仍恒不可达，是因为分母里混进了 S14-c1 这个**恒不可判**的格（r2-P0-1）——J10 修掉分母后，D 才真正可达。
- 误判后果：选 B/C → 8 个 hard 格里 4 个可以「无法验证」蒙混过关；选 A → 闸恒红，三次之后必被豁免成摆设。

**J2 · ⚠️ AI 列可见时机**（v3 追加跨轮闸）
- 候选：A 逐格提交后该格解锁 ／ **B 人列全表提交（run 达 `human_complete`）后统一解锁**
- **REC = B**，v3 追加两条 + **v4 追加第四条**：**①裁剪判据 = 逐行按该行所属 run 的状态**（`loadRunsWithChecks` 是多 run 响应，响应级判据无解）；**②gp 级跨轮闸**——同 gp 存在未达 `human_complete` 的 run 时，该 gp 全部轮次 AI 列 + `adjudication` 一并隐藏；③合看态需显式 `?view=review`；**④（v4 新增 ← r3-P1-3）复盘窗口前置**——同 gp 最近一个 `adjudicated` run 的 `detail.review_closed_at` 为空时，**拒绝为该 gp 建新 run（409）**。
- 依据：`check_key` 改规程格号后每轮同名（J5-A），而「验收历史」入口已存在（`App.tsx:49-51` → `services/acceptance.ts:64-67` → `routes/acceptance.js:264-274` 全量返回）；不加 gp 级闸，员工本轮填表期就能看到上一轮同格的 AI 判定，锚定照旧成立。防锚定只须约束 T1（本轮人列提交前）这一段，故与 Step 7（决策③ 要求员工看得到裁决）不冲突——时序见§可见性时序表。判据② 与 Step 7 在**跨轮**维度仍会互斥（下一轮一开，上一轮裁决理由当场消失，r3-P1-3），判据④ 是这条互斥的解：把复盘挤进「定案后、开新轮前」这个窗口，并用建单期 409 保证窗口不被抢先关掉。
- **v4 明确不取的方案**：给「已定案轮的 `adjudication` 文本」开跨轮可见例外。理由是它要论证「裁决文本不携带本轮 AI 判定信息」，而裁决理由几乎必然引用 AI 证据；格号又跨轮同名，上一轮同格的裁决理由对本轮就是直接锚定。若主理人认为复盘的异步长尾属性必须保留，可把这条例外作为呈批项重开——但默认按判据④ 写死。
- 误判后果：选 A 且 9 条出口漏一处 → 整轮双列独立性作废且事后无法察觉；不加 gp 级闸 → 从第二轮起防锚定形同虚设；**加了 gp 级闸却不加判据④ → 员工的异议永远来不及说：他一回头，上一轮的裁决理由已经因为新轮开单而消失，Step 7 的承诺变成一句空话**。

**J3 · ⚠️ AI 打表器的执行体**
- 候选：A mac_web 的 Claude + Playwright ／ **B zenithjoy GitHub 托管 runner 跑 capture，判定另派 Brain docker 内任务** ／ C Brain 内置 curl/psql 直跑
- **REC = B**（不变）
- 依据：决策⑤ 字面「判据=屏幕所见非查库」作废 C。A 的问题是**能力过剩**：`spawn.js:66` 判到 `mac_web` 即走 `host-executor.js` ssh 逃逸宿主。B 的托管 runner 同样跑真 chromium，但物理上够不到手机池，且 secrets 可白名单化。
- 误判后果：选 A →「不碰真机」只剩提示词承诺。
- **v3 附注**：B 只解决**带外**逃逸；带内（经 staging 后台指挥真机）由 J17 解决，两者缺一不可。

**J4 · ⚠️ 不可自动化格的 AI 列**（v3 改判据来源）
- 候选：A 标「无法验证」留空 ／ B 硬跑给低置信判定
- **REC = A**，v3 追加：「无法验证」的**合法/故障分类由格的静态属性判定**（yaml `verifiable_by` / `scenario_required`），AI 自报 `reason` 只作补充说明，且服务端对不匹配的 reason 直接 400。
- 依据：`cells-map.mjs:14` 已明规「场景未出现必须判无法验证，不许假绿」。v2 把分类落在 AI 自填的 `ai_evidence.reason` 上，等于让被考核者自己定考卷（r2-P1-3）——`machine_db` 且非 `scenario_required` 的格（基线 **12** 格，切回口径 14 格，见 §口径切换表），合法 reason 集合为空集，任何「无法验证」一律故障类。
- **v4 追加（← r3-P1-2）**：「不回写」也是一种自报——AI 不提交某格，等于绕开了这张分类表。故 AI 必须对全部 36 建行格回写，缺格数 > 0 即整轮 `ai_incomplete`（哑火条件三），缺格行 `final_state` 恒「未定」（Q0′）。
- 误判后果：不绑静态属性 → 打表器登录失效整轮哑火时把 reason 写成 `human_only` 就从 Q3′ 滑进 Q3 绿通道，一轮什么都没验的 run 被判定案绿；**绑了静态属性但允许缺格 → 同一个绕过口换个形状回来：不写 reason，直接不交这一格**。

**J5 · ⚠️ 格号统一方案**
- 候选：**A `check_key` 直存规程格号 `S{n}-c{m}` + 约束改 `UNIQUE (run_id, check_key)`** ／ B 保留 `{run_key}:{格号}` 拼接键
- **REC = A**，必改项：`submitAcceptanceResults` 的查找与 `UPDATE` 全部加 `run_id` 作用域
- 依据：决策①「一份规程一套格号」；B 每次 join 都要字符串切割。
- 误判后果：不动 UNIQUE → 第二轮建单立刻 23505；**只动 UNIQUE 不动 UPDATE 更糟**——`acceptance.js:62-66` 的 `WHERE check_key = $4` 会把这一轮的提交同时写进历史所有 run 的同名格，且数据里看不出来。

**J6 · ⚠️ AI 列的存储形态与裁剪实现位置**
- 候选：**A 新增四个真列 + SQL 列白名单** ／ B 塞进 `detail` jsonb + 应用层删键
- **REC = A**，`ai_verdict` 复用人列中文枚举并加同款 CHECK
- 依据：裁剪要的是**默认不泄露**——列白名单 SQL 天然满足「新增列不会自动泄露」；jsonb 要逐子键 delete，新增子键忘删就漏。裁剪必须在 Brain 的 SQL 层（`acceptance.js:151,155-171`），反代层同步白名单作双保险。
- 误判后果：选 B 或只在反代裁 → 直连内网 5221 即拿到 AI 列。

**J7 · ⚠️ 放行闸第三证据项的取数通路**
- 候选：**A GitHub runner curl 公网 5223 的只读 gate 端点** ／ B Brain 定案时反向 push commit status ／ C runner 经 Tailscale 连 HK
- **REC = A**（前提 Gate B 探明公网可达），否则 B
- 依据：A 复用已有 fail-closed 公网 router（`acceptance-public-server.js:47-57`，5223 在跑、`/health` 返 401）；C 要在 runner 上装 Tailscale，凭据链最长且与 Gate A 白名单冲突。
- 误判后果：取不到数默认放行 → 闸是装饰；必须 fail-closed，逃生阀只对 `infra_error` 生效（J15）。

**J8 · ⚠️ 合看页从哪打得开**
- 候选：**A 本机经 Tailscale 打 Staff Hub staging（`100.86.118.99:8091`）** ／ B 临时开公网入口 ／ C 本地 dev server 连生产 Brain
- **REC = A**（不变）
- 依据：Staff Hub staging **公网不可达**——`deploy/staff-hub/nginx-staging.conf:1-4` 原文「只绑 Tailscale IP，公网不可达」；`/dev` 在本机跑（J13），本机有 Tailscale 通路。
- 误判后果：按公网写 E2E → 四张截图永远拿不到，最后降级成「页面代码 review 通过」这种空话验收。

**J9 · ⚠️ 放行闸怎么验证而不真发一次版**
- 候选：A 加 `dry_run` 输入 ／ B 逻辑抽成独立脚本 ／ C 真跑一次 promote ／ **D = B + selftest workflow + 首次真实 promote 日志三段取证**
- **REC = D**
- 依据：A 等于在唯一的生产放行路径上开跳过分支，且 `concurrency: promote-prod, cancel-in-progress:false` 会被占用；B 单独做则重演 `release-gate.mjs` 死代码剧本。
- 误判后果：选 A → dry run 的绿被误读成「已放行」；选 C → 为验闸做一次不可逆生产发布；只做 B → 脚本活着但没接线。

**J10 · ⚠️ 建行格的排除集**（v3 重写，是本轮最重要的修正）
- 候选：A 只排除 `na:true`（v2 REC，**已被 r2-P0-1 证伪**）／ **B 排除 `na:true` ∪ `fixedNa:true` 步骤下的全部格** ／ C 全 56 格建行标 `na` ／ D 保留 S14-c1 但给矩阵加第四态「不适用」
- **REC = B**，建行 **36** 格
- 依据（v3 实测，三重）：①**法源自己的数字**——决策① 原文「一份规程**52**格」，而 yaml 解析 步骤 1-13 全格数 = 13×4 = **52**（精确相等），加上第 14 步四格才是 56，即法条本身就把 fixedNa 步整步排除在计数外；52 − 16（步骤 1-13 内的 na 格）= **36**。②**规程原文**：S14 `fixedNa: true`、`op:'不用操作——这个版本没做这个功能'`、`ev: []`，c2/c3/c4 标 `na:true`，c1 判据原文「固定不适用」——作者留下 c1 不是要人判它，是要挂红线13 这句话。③**现役网页已经这么做**：`lib.mjs:439` 对 fixedNa 步的 c1 渲染成不可填的「固定：不适用」，员工物理上点不了。
- 排除 D 的理由：加第四态要动 DB CHECK、Staff Hub select、九组合矩阵（三态→四态，组合数 9→16）、闸判据四处，而「不适用」在其余 36 格里没有任何合法用例（真不适用的格 yaml 已标 na）——为一格加一态，等于给员工多一个可以在红线格上点的绿色出口。
- **红线13 的承载物**（不能因为不建行就丢）：①生成器对 fixedNa 步零建行（`fixedNa` 已在 `line02-android.schema.json:27`，可机械依赖）；②合看页把第 14 步渲染成灰带「固定不适用（本版未做）」；③run 结论文案恒含「本轮结论只覆盖前13步」，与现役网页 `lib.mjs:381` 原文一致。三条合起来 = A14。
- 误判后果：选 A（v2 现状）→ S14-c1 在 Staff Hub 里必须三选一，而三条路全落拦（选「不通过」→Q5/Q6→红；选「通过」→违背红线13；选「无法验证」→Q9 双盲→拦），闸恒红，复刻 J1 给候选 A 判死刑的同一个死结，且 v2 取消了格级 waive 连退路都没有。选 C → 分母含 19 个永不参与判定的格，闸语义变糊。选 D → 红线格上多一个绿色出口。

**J11 · ⚠️ 剧场闸（theater_mismatch）冲突的处置**
- 候选：A 措辞分区 ／ B 改 `harness-judge.js` 加白名单例外 ／ C 挂 `windows_wechat` 真机环境 ／ **D 本 GP 不进 harness 主链**（见 J13）
- **REC = D**；**A 作废，B 明确否决**
- 依据：A 挡不住——闸是大小写不敏感 substring（`harness-judge.js:812`），关键词表含 `android`（`:188`），而规程文件名 `line02-android.yaml`、run_key `line02-android-*` 本身含 android。B 会把一道正确的闸拆了。C 拿不到浏览器且与 Gate A 冲突。
- **v3 措辞修正**（← P2-1）：`runMechanicalGate` 经 `runJudgeGate` 暴露，除 `routes/harness.js:19` 外还有 `orchestrator/run.js:128` 与 `scripts/harness-judge-cli.mjs:83` 两处接线；**三处均属 harness 链**，故「走 `/dev` 则整条闸不在路径上」的结论不变。
- 误判后果：坚持 A → 合同一提交 `theater_mismatch` FAIL，诱导下一个人去改闸。

**J12 · ⚠️ 冻结锁的校验强度**（v3 换源 + 补前端）
- 候选：**A 记 sha 并双向校验** ／ B 只记录不校验
- **REC = A**，v3 定案四条：
  - **①双源对账（换活 workflow）**：后端源① = staging `GET /api/version` 的 `build.sha`，源② = **`deploy-staging-hk.yml`** 最近成功 run 的 `headSha`。**v2 用的 `deploy-us-vps.yml` 已停用**（v3 实测：文件名已改「已弃用——staging 已迁 HK」，`:21-23` on 只剩 `workflow_dispatch`，最近成功停在 2026-07-14）——照 v2 落地则两源恒不等，A9「两源不等 → 拒绝建单」会让本 GP 永远建不出第一张单（r2-P1-1）。
  - **②前端同样双源**：源① = staging 前端 build sha 标记（**需新增**，全仓 `VITE_BUILD_SHA/buildSha` 在 `apps/dashboard` 零命中），源② = `deploy-dashboard-staging.yml` 最近成功 run 的 `headSha`，**且该 workflow `:57` 需由 `reset --hard origin/main` 改为 pin `github.sha`**（后端 `:42` 已是 `github.sha`，前端不是 → 不改则前端两源可合法不等，重蹈 r2-P1-1 的坑）。
  - **③规程版本锁**：`version` + `spec_sha`（yaml 内容 sha256），任一变更 → run 转 `stale`。
  - **④闸侧双 sha 绑定**：`PROMOTE_SHA` 必须同时等于 `backend_sha` 与 `frontend_sha`，且 **`promote-dashboard` 改读 `inputs.sha`**（现 `:206-230` 无 INPUT_SHA，`reset --hard origin/main`，还会把 `promote-backend` 刚 pin 的同一个 `/opt/zenithjoy/repo` 复位）。
- 依据：决策⑥「验收站位=staging 冻结切面」。两列判的绝大多数格是在 staging **网页**上看出来的，只绑后端 sha 等于没绑（r2-P1-2）。
- 误判后果：源选错 → 首次建单即被自己的 fail-closed 拦死；只绑后端 → 上产的前端是 promote 那一刻的 main HEAD，与验收单毫无关系；只做 run 内冻结不做闸侧绑定 → 用昨天的绿单放行今天的构建。

**J13 · ⚠️ 本 GP 的实现路径**
- 候选：A 走 harness 主链 ／ **B 拍板后按交付物建多个 `/dev` 任务**（带 `payload.anchor` 三件套）
- **REC = B**
- 依据：①**跨 repo**：`GP_HARNESS_BASE_REPO` 常量恒为 `cecelia.git`（`golden-path-contract-task.js:1`），而本 GP 过半交付物落 `zenithjoy-workspace`；②**真浏览器**：`GP_HARNESS_TARGET_ENVIRONMENT` 常量恒为 `local_api`（同文件 `:2`），且 `mac_web` 已被 J3 因安全理由否决。
- 误判后果：选 A → 合同签完才发现要么被 theater 闸卡死、要么 PR 改不到 zenithjoy。
- **代价与补偿**：`/dev` 路径没有 GAN 对抗与 evaluator 的 L2/L3 findings。补偿 = 本提案的 A1-A14 冻结断言作为每个 `/dev` 任务 DoD 的 `[BEHAVIOR]` 来源，且最后一个交付物必须跑一次覆盖全部断言的 Final E2E。

**J14 · ⚠️ 每格 `kind` 的来源**
- 候选：**A yaml 每格补显式 `kind` 字段 + schema 设 required** ／ B 生成器按规则推断
- **REC = A**（B 只作过渡期兜底且必须打警告）
- 依据：`ACCEPTANCE_KINDS=['FR','NFR','Invariant','SOP']` 在端点（`acceptance.js:9,191`）与 DB CHECK 双重强校验，而 yaml 全文零个 kind 字样——不补映射首次建单即 400。规程是 SSOT，语义该由规程作者写死。
- 误判后果：选 B → 36 格的 kind 是一次性猜测，之后所有按 kind 的统计/巡检都建在猜测上。

**J15 · ⚠️ 逃生阀形态**
- 候选：A 照抄 `waive_nightly` ／ B 本期不提供任何逃生阀 ／ **C 只对 infra 故障提供 `bypass_two_column_infra`，格红不可豁免，加计数与棘轮**
- **REC = C**
- 依据：A 的实现是无条件跳过整个 step（`promote-all-prod.yml:84-93`），会连 8 个 hard 格一起豁免；B 则取数通路一坏就彻底堵死发版，必然被人手改 workflow 绕过。C 的关键是**机械可区分**：gate 脚本自判失败原因是 `infra_error` 还是 `cells_red`，只有前者读 bypass 输入。
- 误判后果：选 A → 红线格形同虚设；无棘轮 → 逃生阀变日常。
- **v3 附注（← P2-4，本期只记账不实现）**：A12 的棘轮到顶（近 30 天 >3 次）后当前没有登记的升级路径，若取数通路持续故障，发版被彻底堵死——正是本条用来否决候选 B 的同一论证。建议实现期在棘轮到顶后接一条有名有姓的出口（主理人在 Brain 写一条 `decision` 才放行），已进 P2 记账 P2-4。

**J16 · ⚠️ 验收仪式的发起人、频率与工时**（v3 随 J17 改两段式 + 补冻结约束）
- 候选：**A 每次 promote 前一轮（发版人发起）** ／ B 固定每周一轮 ／ C 员工自助随时发起
- **REC = A**
- 依据：决策⑥「员工验收=发版仪式非日常」字面。发起人 = **发版人**；频率 = **每次 promote 前恰一轮**（同构建幂等复用，`acceptance.js:183` 已支持）。
- **v4 补（← r3-P1-3）仪式的两个开轮前置**（发起人在发起前必须满足，否则建单 409）：**①上一轮复盘已闭环**（`detail.review_closed_at` 非空，Step 7 的复盘窗口 = 上一轮定案到本轮开单之间，约 15 分钟，计入仪式工时）；**②本轮的「测试用客户账号」= 验收专用租户**（J17 前提①）。两条都在建单端点机械校验，不靠发起人自觉。
- **v3 改：工时与跨度按两段式重算**——① 员工现场操作流（Step 2）约 40 分钟（含 S12 真机全程录屏私信）；② AI 采证（Step 3）约 40 分钟，**员工可离开**；③ 员工填表判定（Step 4）约 30 分钟；④ 主理人裁决约 15 分钟。**员工工时 1.2–1.5 人时/轮不变，但仪式跨度从「一坐到底」变成约 2 小时两段**，发版人排期须按此。
- **v3 补（← P2-6）：验收窗口的冻结约束**——`deploy-staging-hk.yml:14-20` 在 `apps/api/**` 有 push 到 main 就自动部署，近 14 天该路径 22 次提交。发起人在发起本轮前须在团队频道公告「验收窗口 T，期间 `apps/api/**` 与 `apps/dashboard/**` 暂停合并」；未公告而窗口内发生部署 → run 按 A10 转 `stale` 重开（含重跑一次 AI 采证）。**本期只做「组织约束 + stale 兜底」，不做机械冻结**（机械冻结要动 CI 合并闸，超出本 GP 范围），此代价明示登记。
- 误判后果：不定仪式 →「36 格齐才解锁」变成没人负责的阻塞点；不评工时 → 员工草率填表；不登记冻结约束 → 反复 409 + 整轮重开，员工把两列制当成负担。

**J17 · ⚠️ AI 采证的点火边界与仪式时序**（v3 新增，← r2-P0-2，**本轮最需要主理人拍板的一条**）
- 背景（v3 实测）：`cells-map.mjs` 的 `action` 三值里 `trigger_collect` **恰 1 格 = S6-c3**，`capture.mjs:152-163` 真的填关键词点「开始采集」；该动作经 `POST /api/acquisition/collect/start` 落 `acquisition_collect_tasks(agent_id)`，由绑在常驻验收租户下的**真安卓 agent 用真抖音小号**领走执行（凭据注释原文「绑真机租户，4台安卓在线」）。这是决策⑤「AI 扮员工走 UI」与 Gate A「不碰真机」的真实矛盾点，措辞掩盖不了。
- 候选：
  - **A · AI 完全先行 + 零点火**：AI 在员工任何动作之前跑，凡依赖本轮采集数据的格一律「无法验证-需真实采集」。
  - **B · 允许点火，但限专用验收租户 + 专用小号**：保留 `trigger_collect`，把风险收在一个隔离租户里。
  - **C · 两段式仪式：员工先跑操作流 → AI 先行采证（零点火，按单头任务编号定位本轮任务）→ 员工填表判定**。
- **REC = C**
- **v4 新增：C 的两条显式前提（← r3-P1-1，v3 把它们当成了不言自明的背景）**
  - **前提① 同租户可见性**——C 的全部可判量建立在「AI 采证账号看得见员工本轮造的数据」上，而采证器的可见范围完全由它登录的账号/租户决定（`login.mjs:1-11` 原文：每轮新注册 → 租户下零设备 → 链路格全部只能标无法验证；实测 `run-summary.json` 里 `account=ai-acceptance@zenithjoy.test`、`machines_online=7`，说明它挂在一个有设备的租户下，**但那不等于挂在员工本轮用的租户下**）。员工在 Step 2 用「本轮发的测试授权码」绑机，现役网页把它记在单头**「测试用客户账号」**（`lib.mjs:297`，`data-f=tenant`）——v3 的 Step 2 挂片枚举与 D4 迁移清单**恰恰都漏了这一格**。落法：该字段落 `acceptance_runs.detail`，建单期校验 ∈ AI 采证账号可见租户集合（不等则拒绝建单），采证开跑前再自检一次（不等则整轮 `ai_incomplete` 告警退出）；Gate B 第5条首日实测，**不通则本 GP 阻塞升级主理人**。
  - **前提② 时限格事后可测性**——S7-c2「5 分钟内进入终态」与 S9-c2「3 分钟内出判定结果」现在靠采证器自己点火后轮询计时（`cells-map.mjs:37-40,49-52` `wait_budget_ms` 300000/180000，`capture.mjs:168-185` 从自己触发起轮询）。C 之下 AI 在员工操作流结束约 40 分钟后才到场，这套计法物理失效，只能读页面时间戳——**页面是否同时显示创建时间与终态时间未探明**。按 fail-closed 先把两格摘出 AI 可判集合（口径 18），Gate B 第4条实测通过后按 §口径切换表整表切回 20。
- 依据：
  - **A 与 C 的安全边界完全相同**（AI 都是零点火），差别只在 AI 跑的时刻；但 **A 的完备性代价极大**：v3 实测 20 个 machine_db 格里，**11 格**的判据原文依赖本轮采集数据（S6-c3/S7-c1/S7-c2/S8-c1/S8-c3/S8-c4/S9-c1/S9-c2/S10-c1/S11-c1/S11-c3），**6 格**是 `scenario_required`（S4-c2/S4-c3/S5-c3/S5-c4/S10-c4/S13-c4，无场景时本就合法无法验证），剩下 **3 格**（S1-c3/S6-c4/S11-c4）才是常态可判——即 **A 会把 AI 的常态确定判定压到 3/36 格**，两列制退化成摆设，而闸判据（J1-D）依赖 AI 列有实质内容才有对抗价值。**注**：那 11 格里含时限两格，故前提② 未探明时 C 的可判量是 **18** 而非 20；A 的 3 格不含时限格，不随口径变。
  - **C 不违反决策②**：决策② 的字面是「员工填表时绝不可见 AI 判定，AI 列后台先行完成」——约束的是「**先于填表**」，C 里 AI 采证发生在 Step 2（操作）之后、Step 4（填表）之前，字面成立。员工的「发起采集」本来就是规程 S6 的 `op`（原文「在预发环境用本轮关键词发起一个采集任务」），是**员工授权的人工动作**，不是 AI 的点火。
  - **C 不削弱防锚定**：AI 读的是 staging 页面状态，读不到人列（人列此时还没填；且 AI 的 `ACCEPTANCE_AI_TOKEN` 按 J19 物理上读不到 checks）。
- **候选 B 呈主理人拍板（不由 AI 单方决定）**——两条路的真实边界：
  | | A/C（零点火） | B（允许点火，专用租户+专用小号） |
  |---|---|---|
  | AI 常态确定判定格数 | C：**18 格**（基线；Gate B 第4条通过后 20）；A：3 格 | 20 格 |
  | 真机/真账号风险 | 零 | 每轮多一次真实抖音采集：小号风控/封号、目标视频作者被真实触达、手机池占用 |
  | 仪式跨度 | C：约 2 小时两段 | 一坐到底约 1.5 小时 |
  | 需新增资产 | 无 | 专用验收租户 + 专用小号（需采购/养号）+ 与生产小号池的隔离验证 |
- 误判后果：选 B 而不做租户/小号隔离 → 每轮验收都在真实抖音上打一次采集，风控与触达风险按轮累加，且 Gate A「不触达任何真实抖音账号」变成空话；选 A → AI 列只剩 3 格有内容，闸判据的对抗价值归零，几个月后必被当作噪音关掉；选 C 而不把「员工操作流」显式拆成独立步骤 → 员工会边跑边填，AI 采证时人列已部分落库，防锚定窗口失守；**选 C 而不落前提①（v4）→ 首轮就死：AI 登录的租户看不见员工本轮绑的机，11 个依赖本轮采集数据的格全判「无法验证」，按静态属性它们是故障类，直接撞上哑火条件② 与条件③，run 标 `ai_incomplete`、闸一律拦——形状与 r2-P1-1「首次建单即被自己的 fail-closed 拦死」一模一样，而现场排查会先怀疑打表器坏了，实则是租户配错**；选 C 而不落前提②（v4）→ 时限两格每轮都被 AI 判成故障类无法验证，两个 Q3′ 常驻拦闸，最后必被人手改成「合法」而把整张分类表的可信度一起搭进去。

**J18 · ⚠️ 现役员工验收网页的处置**（v3 新增，← r2-P1-5）
- 背景（v3 实测）：员工现在实际填的是 `acceptance-spec/generated/line02-android.html`（`cli.mjs:32-47` generate 产出，手工 scp 到 hk-vps 文档中心）。它是一张**完整可填**的表：有测试日期/测试人/复核人/手机型号/本轮暗号等表头字段（`lib.mjs:292-299`）、每格三选一、步骤红绿灯自动汇总。它的第三态是**「不适用」**（`lib.mjs:430` `STATE_LABEL`），而 Staff Hub 与 DB CHECK 是**「无法验证」**——两词语义相反（不适用=本来就不该验；无法验证=该验但验不了），而九组合矩阵的 Q3/Q6/Q7/Q8/Q9 全建在「人列无法验证」上。决策①「一张表」在员工侧没有收口。
- 候选：A 现状不动（两张表并存）／ **B 收编：generate 改产只读「判据说明书」，填表唯一入口 = Staff Hub** ／ C 反向收编（保留网页填表，Staff Hub 只做合看）
- **REC = B**
- 依据：决策①「数据层一张表」+ 决策 `efa578b8` ⑤「QA 验收留在 Staff Hub 直连 Brain」+ 决策 `078b314a`「动作走直连面」三条同向。C 会把两列合看、裁决、闸取数全部建在一张 scp 上去的静态 html 上（且 P2-3 已记：服务器那份不保证 = repo 那份）。B 的具体改动：`lib.mjs` 去掉三态按钮与 localStorage 勾选，保留判据全文/证据规范/红线说明/第14步灰带，页头加一行「填表请到 Staff Hub 验收页」并给链接。
- 具体收口三件事：①三态措辞统一为 `通过/不通过/无法验证`，「不适用」退出可填态（na 格与 fixedNa 步渲染为不可填灰格）；②表头字段（手机型号/客户端编号/本轮任务编号/本轮暗号）迁进 Staff Hub 建单页与 `acceptance_runs.detail`（Step 2 的挂片）；③结论文案「前13步全部打通」由 A14 承载。
- 误判后果：选 A → 员工被训练的第三态与矩阵地基的第三态语义相反，填表时把「该验但验不了」点成「不适用」，闸按 Q3 放行，两列制在员工侧从第一天起就是错的；且 S14-c1 在现役表里锁死不可填、在 Staff Hub 里必须三选一（r2-P0-1 的同一个根）。

**J19 · ⚠️ 公网 5223 的凭据分权与端点收口**（v3 新增，← r2-P0-3）
- 背景（v3 实测）：`acceptance-public-server.js:32` 是 `app.use(createBearerAuth(token))` 单 token 守**全** router，它守的端点含 `POST /acceptance/results`（`routes/acceptance.js:342`）→ `submitAcceptanceResults` 写**人列** `result`，且 `submitted_by` 直取 `r.submitted_by`（`:62-66`，公网/内网路由都不注入身份，只有 Staff Hub 反代那条路才注入 `staffIdentity`，`staff.ts:338`）。v2 的 Gate A 第②层把 `ACCEPTANCE_API_TOKEN` 列进打表器白名单并称之为「机械剥夺」——实际是把能把 36 格人列全写成「通过」并署名成员工的那把钥匙交给了 AI，决策②「两列背靠背独立」在能力层不成立。
- 候选：A 保留单 token，靠提示词/断言约束 ／ B 单 token + 按 token 做端点白名单 ／ **C 三 token 分权 + 公网人列写端点下线**
- **REC = C**
- 落法：`createBearerAuth` 从 app 级下沉到路由级，三把钥匙各管各的——
  | token | 可达端点 | 持有者 |
  |---|---|---|
  | `ACCEPTANCE_AI_TOKEN`（新） | **只** `POST /acceptance/ai-results`（只吃 `ai_verdict`/`ai_evidence`/`ai_run_at`，服务端**忽略**请求体里的 `result`/`submitted_by`/`adjudication`；并校验 reason 与静态属性，见 J4） | 打表器 job（GH secret） |
  | `ACCEPTANCE_GATE_TOKEN`（新） | **只** `GET /acceptance/gate`（只回闸判据，不回 AI 列原文） | promote workflow（GH secret） |
  | `ACCEPTANCE_API_TOKEN`（既有） | `GET /acceptance/catalog` | 保留给 catalog 消费者；**移出打表器白名单** |
- **公网 `POST /acceptance/results` 与 `GET /acceptance/pending` 本期下线**（不是加防护）。依据：这两个端点的设计消费者是 Notion Worker（`docs/current/acceptance-endpoint-deploy.md`「Worker 侧」章节），而 Notion Worker 已于 07-31 停摆（决策 `fc7b5dc0`），并被决策 `efa578b8` ⑤「QA 验收留在 Staff Hub 直连 Brain」与 `078b314a`「禁止机器读回 Notion」二次确认；Staff Hub 反代实测走**内网** 5221（`services/acceptance.ts:11-12` `http://host.docker.internal:5221`），不经 5223。**下线前置动作**：D3 开工时先核一次 5223 近 30 天访问日志/Cloudflare analytics，若发现非本 GP 的活跃调用方，改走候选 B 并回报主理人。
**v4 明确下线的实现形态（← r3-P2-3/P2-18）**：决策 `fc7b5dc0` 原文是「5223 公网端点与 cloudflared 路由转**休眠**（保留代码与配置备将来外部集成）」，故「下线」= **不挂载该路由 / 解挂 cloudflared 路由**，**不删码**；A2 出口10 断言「AI token 打人列写端点非 2xx」在 404/401 两种形态下都成立，不依赖删码。
**v4 补（← r3-P2-4/P2-19）**：`createBearerAuth` 下沉到路由级后，三把钥匙**任一缺失只降级为该端点不挂载 + 启动日志告警**，不得让 `createBearerAuth(undefined)` 在建 app 时 throw 把整个 listener 拖挂（现状 `acceptance-public-server.js:12-25` 就是这个形状）。
- 误判后果：选 A/B 而保留 AI 侧持有人列写权 → 决策② 在能力层永远不成立，且「AI 伪造员工判定」这种事**数据里看不出来**（`submitted_by` 就是员工名）；不下线公网人列写端点 → 一把泄露的 token 就能把任意一轮验收单全写成绿并放行生产。

---

## 交付物划分（按依赖排序；实现路径见 J13）

> 命名按内容不按代号。每件对应一个 `/dev` 任务，`payload.anchor` 必带 `{journey_id, gp_id, step_id}` 三件套。

**D1 · 数据层地基与状态机**（cecelia，阻塞其余全部）
AI 四列 migration（J6-A，中文枚举 + CHECK）＋ `check_key` 改规程格号 ＋ `UNIQUE (run_id, check_key)`（J5-A）＋ `submitAcceptanceResults` 全链路加 `run_id` 作用域 ＋ **规程 yaml → 36 格建单生成器**（J10-B 的排除集：`na:true` ∪ `fixedNa` 步骤全格；含 J14 的 kind；`scenario_required` 与 `verifiable_by` 从 `cells-map.mjs` 迁进 yaml 成为静态属性，**其中 S7-c2/S9-c2 按 §口径切换表 基线标 `human_only`**）＋ `backend_sha`/`frontend_sha` 双源对账与 `spec_sha`/`version` 落库（J12）＋ **run 状态机改造**（`369_acceptance_tables.sql:11` 的 CHECK 加 `human_complete`/`adjudicated`/`stale`，`status` 计算改按九组合矩阵算 `final_state` 与 `gate_verdict`，**Q0′ 缺格恒判「未定」**，`detail.ai_status` 记哑火并实现三条件判据含**缺格数 > 0**，`passed` 退为历史兼容值）＋ **建单期两条前置校验**（v4：同 gp 上一轮 `detail.review_closed_at` 非空；单头 `tenant_account` ∈ 验收专用租户）＋ `detail.review_closed_at`/`review_closed_by` 写入端点。
对应 Step 1 / Step 6 / Step 7 / Step 9；解锁断言 A1 / A3 / A5 / A9 / A10 / A14 / A15 / A16。

**D2 · AI 打表器零点火化与 Gate A 机械约束**（zenithjoy 为主，cecelia 加回写端点）
**采证器删除「发起采集」交互、`action` 枚举收敛为单值 `observe`、改按 run 单头的本轮任务编号定位任务**（J17-C，Gate A 第①层）＋ 打表器 workflow（`runs-on: ubuntu-latest`，J3-B）＋ Playwright 域名 allowlist ＋ secrets 白名单与 smoke 校验（**不含 `ACCEPTANCE_API_TOKEN`**）＋ staging 后端 `GET /api/version` 暴露已有 build-info（**措辞修正 ← P2-2**：`apps/api/src/app.ts:109,115` 已有根路径 `/version`，公网 404 是因为隧道只把 `/api/*` 路由到 API；本项 = 把已有 build-info 挂到 `/api` 前缀，并确认 staging 部署链真的注入了 `BUILD_SHA`——`deploy-staging-hk.yml:80` 已注入）＋ **staging 前端新增 build sha 标记**（`VITE_BUILD_SHA` 注入 + 页面可读，全仓现零命中）＋ **`deploy-dashboard-staging.yml:57` 改 pin `github.sha`** ＋ 判定任务（Brain docker 内，读 artifact 截图判「屏幕所见」）＋ `POST /acceptance/ai-results` 回写端点（J19 的 AI token；reason 与静态属性的服务端强校验，不匹配 400）＋ **采证开跑前的租户自检**（登录租户 ≠ 单头 `tenant_account` → 整轮 `ai_incomplete` 告警退出，不产生任何「无法验证」回写）＋ **对全部 36 建行格回写、零缺格**（human_only 格回写「无法验证」+ reason）＋ **时限两格按口径处理**（基线不采；Gate B 第4条通过后改读页面创建/终态时间戳算差值，并把 yaml 两格切回 `machine_db`）＋ 产物不再 commit 进 repo。
对应 Step 3；解锁断言 A4 / A11 / A16③。

**D3 · 背靠背裁剪与凭据分权**（cecelia + zenithjoy 反代；依赖 D1 的列存在，可与 D2 并行）
`loadChecks`/`loadRunsWithChecks` SQL 列白名单 ＋ `view` 参数与服务端 `human_complete` 校验 ＋ **gp 级跨轮闸**（J2 判据②）＋ 9 条读侧出口逐条覆盖 ＋ 反代层同步不透传 ＋ **`createBearerAuth` 下沉到路由级、三 token 分权、公网 `POST /acceptance/results` 与 `GET /acceptance/pending` 下线**（J19，含下线前的访问日志核查）。
对应 Step 4；解锁断言 A2（读侧 + 写侧）。

**D4 · 合看页、裁决、员工回显、员工表收编与分流建单**（zenithjoy 页面 + cecelia 后端；依赖 D1/D2/D3）
九组合矩阵合看页（`apps/staff-hub/src/pages/`，含 device / `scenario_required` 标记 + 第14步灰带）＋ `adjudication` 裁决 API 与 hard 格裁决绿自动开 P0 ＋ 员工侧裁决回显视图 ＋ 侧边栏待办角标与仪式发起通知 ＋ **建单页承接现役网页的表头字段**（**测试用客户账号**(`lib.mjs:297`，v4 补——v3 清单漏项，做成从验收专用租户下拉选择)/手机型号/客户端编号/本轮任务编号/本轮暗号 → `acceptance_runs.detail`）＋ **员工侧「复盘完成」按钮与 `review_closed_at` 写入**（v4，← r3-P1-3）＋ **`lib.mjs` 收编：generate 改产只读判据说明书，去掉三态按钮，第三态措辞统一**（J18-B）＋ 聚合式分流建任务（≤1 bug + ≤1 trace、**查重谓词加 `acceptance_bucket` 维度**、anchor 三件套、非绿格占比 >1/3 熔断、AI 整轮哑火走独立 P0）。
对应 Step 2 / Step 5 / Step 6 / Step 7；解锁断言 A6 / A7 / A13 / A14 / A15 / A16①。

**D5 · 放行闸第三证据项**（zenithjoy）
只读 gate 端点（J7-A，落 5223，J19 的 gate token）＋ `scripts/release-gate/two-column-gate.sh`（**双 sha 绑定**、`infra_error` vs `cells_red` 机械区分、`bypass_two_column_infra`、棘轮计数）＋ `two-column-gate-selftest.yml` ＋ `promote-all-prod.yml:138` 之后接线 ＋ **`promote-dashboard` 改读 `inputs.sha`**（J12-④）。
对应 Step 8；解锁断言 A8 / A12。

**Phase 2（只登记，本提案不展开）**
决策④「连续多轮双绿的格从员工表摘除、标已移交 AI 可抽查」——依赖多轮 run 历史；Kernel 融合（proposer 合同 BEHAVIOR 锚格、sprint evaluator 的 L2/L3 findings 产「新格候选」进待审池、格覆盖闸）；其余 GP 的 acceptance-spec yaml 编写（本轮只做 line02-android 一条样板）。

---

## P2 记账（不阻塞，进账本留给实现期）

| # | 事项 | 证据 |
|---|---|---|
| P2-1 | 「theater 闸唯一调用方 `routes/harness.js:19`」措辞不准（结论仍成立）：另有 `orchestrator/run.js:128` 与 `scripts/harness-judge-cli.mjs:83` 两处，**三处均属 harness 链** | `harness-judge.js:690,924,933`；`routes/harness.js:19,2100`；`orchestrator/run.js:128`（← r2-P2-1，已同步修正 J11 措辞） |
| P2-2 | D2 的「staging 新增 `GET /api/version`」实为把已有 build-info 挂到 `/api` 前缀：`app.ts:109,115` 已有根路径 `/version`，公网 404 是隧道只路由 `/api/*` | `apps/api/src/build-info.ts:11-13`；实测 `/api/health` 返 API 自己的 NOT_FOUND JSON（← r2-P2-2，已同步修正 D2 措辞） |
| P2-3 | A7 查重谓词需加 `acceptance_bucket` 维度：既有谓词「同 run_key 无未终态任务」不区分 bucket，照抄则第二个桶永远建不出来 | `acceptance.js:99-106`（← r2-P2-3，已同步写进 A7 与 D4） |
| P2-4 | bypass 棘轮到顶后无升级路径，重演 J15 否决候选 B 的理由；建议接一条有名有姓的出口（主理人在 Brain 写 `decision` 才放行） | proposal A12 / J15（← r2-P2-4，已在 J15 附注登记） |
| P2-5 | 托管 runner 跑 Playwright 登录 Cloudflare 前置的 staging 未探明（先例全是 curl，无 headless chromium 完成 better-auth 登录的实证） | `deploy-dashboard-staging.yml:37,103-106`；`deploy-lib.sh:505-513` better-auth invalid origin 前科（← r2-P2-5，**已前推进 Gate B 第 3 条**） |
| P2-6 | 验收窗口与 staging push-main 自动部署冲突（近 14 天 `apps/api/**` 22 次提交），本期只做组织约束 + `stale` 兜底，不做机械冻结 | `deploy-staging-hk.yml:14-20`（← r2-P2-6，已在 J16 登记约束与代价） |
| P2-7 | 现行 release-gate 证据① 查 `deploy-us-vps.yml` 最近一次结论，而该 workflow 最近成功停在 2026-07-14，此后再没跑过——这条断言事实上恒绿（既有缺陷，非本提案引入） | `promote-all-prod.yml:68-80`（← r2-P2-7，接第三证据项时顺带修正） |
| P2-8 | 七环对账巡检棘轮击穿：`RATCHET_PATH` 容器内解析不到 json → 静默 fallback `hard_flaw_max:0` → 生产 `ratchet_breached=true` 恒真且只 console.warn 无人消费 | `explore-report.md:100`，`seven-ring-audit.js:16,183` |
| P2-9 | `harness-evaluator` skill 三处版本分叉：cecelia 内 1.35.1 / SSOT 1.33.0 / dist 快照 1.32.2 且不含人形协议段 | `explore-report.md:113,188` |
| P2-10 | 员工验收网页部署仍是手工 scp，CI 只保证 repo 内一致、不保证服务器那份 = repo 那份（J18-B 收编后风险降级但未消除） | `explore-report.md:76`，`cli.mjs:47` |
| P2-11 | Staff Hub 详情页拉全量 pending 再前端 `find`，已有的 `GET /runs/:run_key` 端点闲置（D3 改造后应切过去） | `explore-report.md:45`，`AcceptanceDetailPage.tsx:36` |
| P2-12 | cecelia 侧 `promote-all-prod.yml` 与 `scripts/release-gate.mjs` 均为事实死代码，建议明确废弃或接线 | `explore-report.md:97,101` |
| P2-13 | `line02-android-collect-realmachine-smoke.sh:49` 的 `awk` 只抓第一台设备，多机型矩阵能力缺失 | `explore-report.md:163` |
| P2-14 | evaluator `android_realmachine` 分支半成：skill 有派发逻辑但 Brain 侧 `ANDROID_REALMACHINE_WORKFLOW` 零命中，目标 workflow 两 repo 都不存在，真派必 FAIL | `explore-report.md:162` |
| P2-15 | harness 主链的 `base_repo` / `target_environment` 均为不可覆盖常量，任何跨 repo 或需真浏览器的 GP 都走不通（本 GP 靠 J13 绕开，下一条同类 GP 会再撞一次） | `golden-path-contract-task.js:1-2`，唯一消费点 `golden-path-contracts.js:397-398` |
| **P2-16**（← r3-P2-1） | 双 sha 绑定仍可被并发部署穿透：staging 后端、staging 前端、生产 promote **三条** workflow 共用 HK 同一个 `/opt/zenithjoy/repo`（v3 只抓到 promote 内部两条）。任一 staging 部署落在 promote 的 `reset` 与 `docker build` 之间，生产就会用另一棵树构建，而闸只断言 `PROMOTE_SHA` == 验收单 sha，断言仍绿。J16 的「验收窗口内暂停合并」组织约束部分缓解；实现期建议改用 `git worktree` 或按 sha 建独立构建目录 | `deploy-staging-hk.yml:57,61`；`deploy-dashboard-staging.yml:51,57`；`promote-all-prod.yml:181-190,222-229` |
| **P2-17**（← r3-P2-2） | 5223 是 AI 回写与闸取数的**共同**前提，v3 的 Gate B「1 不通」回落只覆盖闸这一侧；回写侧不通则采证结论无处落库、两列制当轮只剩一列。**已在 Gate B 第1条补写回写侧回落**（artifact + Brain docker 内判定任务经内网 5221 落库），此处记账留痕。本机实测公网 `/acceptance/catalog` 返 401（隧道活着、鉴权墙在） | `acceptance-public-server.js:46-58`；A2 出口11；实测公网 401 |
| **P2-18**（← r3-P2-3） | 「公网人列写端点下线」的**实现形态**要与决策 `fc7b5dc0` 原文对齐：原文是「5223 公网端点与 cloudflared 路由转**休眠**（保留代码与配置备将来外部集成）」，故下线应实现为**解挂路由 / 不挂载该 router，不删码**。下线依据（唯一消费者 Notion Worker 已停摆）经 r3 独立复核属实 | 决策 `fc7b5dc0` 原文；`packages/workflows/notion-acceptance-worker/README.md:11,35`；`docs/current/acceptance-endpoint-deploy.md`「Worker 侧」 |
| **P2-19**（← r3-P2-4） | 三 token 分权后 5223 listener 的 **fail-closed 启动判据**需同步改造：`startAcceptancePublicServer` 只判 `ACCEPTANCE_API_TOKEN` 存在与否，而 `createBearerAuth` 在 token 为空时直接 `throw` → 只注入两把钥匙就会在建 app 时抛错，整个 listener 起不来（连 catalog 都没了），失败形态从「少一个端点」放大成「公网面全挂」。落地时**三把钥匙各自缺失应降级为该端点不挂载 + 启动日志告警**；已进 Gate B 第2条确认项 | `acceptance-public-server.js:12-25,46-52`；J19 落法表 |
| **P2-20**（← r3-P2-5） | 决策② 后半句「AI 列后台**先行完成**」的顺序**无机械闸**，只靠 Step 2/3/4 的步骤拆分。之所以不阻塞：两列独立性由 J19 的 token 分权物理保证（AI token 只写 ai-results、读不到 checks；Staff Hub staging 只绑 Tailscale 公网不可达；5223 读端点下线），顺序颠倒不造成反向锚定，损失的只是仪式次序。实现期建议顺手加一条「run 未记录 `ai_run_at` 时人列提交 409」 | J17 误判后果；J19 token 表；`deploy/staff-hub/nginx-staging.conf:1` |
| P2-16 | theater 闸 GP 段提取兜底：`sprint-prd.md` 无 `## Golden Path` 标题则扫全文，且 `###` 子标题不终止段落 | `harness-judge.js:796` |
