# 发版验收一体两面——F2 步2 加厚「一张表两列背靠背合着看」Golden Path v3

提案人：Cecelia（AI）。v3 = 对 solo 复审 r2（`.harness/verdicts/gp-r2-solo.json`）的逐条修订轮：**3 P0 / 6 P1 全部核销，0 REFUTE，7 P2 记账**。

- **归位**：工厂 · F2 部署闭环（journey `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`）· 步2「部署被证明没坏」· 动作=**加厚**（非新路）
- **GP_ID**：`7790f728-f490-4243-b166-03f3250a0938`（golden_paths，candidate）
- **法源**：决策 `fdeb48aa` 六条（一字为法，本提案不得改写其语义）；④「移交节奏」Phase 2+ 只登记
- **现状依据**：`.harness/explore-report.md` + v2 实测 + 本轮为核销 r2 findings 新增的直接读码/解析（新增部分逐条标「v3 实测」）

---

## 0. 相对 v2 的结构性变化

| # | 变化 | 回应 |
|---|---|---|
| 1 | **格数口径从 37 改 36**：J10 的排除集由 `na:true` 扩为 `na:true ∪ fixedNa 步骤下的全部格`，S14-c1 不建行。依据是**法源自己的数字**——决策① 原文「一份规程**52**格」= 步骤 1-13 × 4 = 52（v3 实测精确相等），第 14 步整步不在法条计数内。全文 37→36、human_only 17→16、machine_db 20 不变、hard 8 不变 | → r2-P0-1 |
| 2 | **红线13 改用「零建行 + 固定结论文案」承载**，不引入第四态：矩阵仍是三态，新增 **A14** 断言（fixedNa 步骤零行 + run 结论恒含「本轮结论只覆盖前13步」） | → r2-P0-1 |
| 3 | **Gate A 补「带内通道」一层，AI 采证零点火**：`action:'trigger_collect'` 唯一一格（S6-c3，v3 实测）不再由 AI 点火；仪式改**两段式**（员工先跑操作流 → AI 先行采证 → 员工填表判定），新判定点 **J17**（REC=C，候选 B 呈主理人拍板） | → r2-P0-2 |
| 4 | **写侧击穿封堵：三 token 分权 + 公网人列写端点下线**。`createBearerAuth` 从 app 级下沉到路由级；新增 `POST /acceptance/ai-results`（只吃 AI 列、独立 token）与 `GET /acceptance/gate`（只读、独立 token）；A2 补写侧三条断言。新判定点 **J19** | → r2-P0-3 |
| 5 | **双源对账换活 workflow**：源② 后端改 `deploy-staging-hk.yml`（v3 实测 `DEPLOY_SHA=${{ github.sha }}`，headSha 与实际部署 sha 严格相等），前端 `deploy-dashboard-staging.yml` | → r2-P1-1 |
| 6 | **sha 绑定补前端侧**：run 记 `backend_sha` + `frontend_sha` 二元组；`promote-dashboard` 改读 `inputs.sha`；`deploy-dashboard-staging` 改 pin `github.sha`；staging 前端新增 build sha 标记（现全仓零命中） | → r2-P1-2 |
| 7 | **「合法 vs 故障 无法验证」改由格的静态属性判定**，AI 自报 reason 只作补充：回写端点服务端校验 reason 与 yaml `verifiable_by` / `scenario_required` 匹配，不匹配 400；A4 补整轮哑火识别 | → r2-P1-3 |
| 8 | **跨轮锚定处理 + A2 出口2 时序写死**：裁剪判据 = 逐行按该行所属 run；同 gp 存在填表中 run 时，该 gp **全部**历史轮 AI 列一并隐藏；A2 出口2 改成带前置条件的双向断言，与 Step 7、A3 消解冲突 | → r2-P1-4 |
| 9 | **员工表第三态统一为「无法验证」**，「不适用」退出可填态；现役 generated HTML 的处置定案（新判定点 **J18**：收编为只读判据说明书，填表唯一入口=Staff Hub） | → r2-P1-5 |
| 10 | **熔断分母改「非绿格占比」+ AI 整轮哑火走独立 infra 路径**（不进熔断、不建 bug/trace、单开 P0） | → r2-P1-6 |
| 11 | 步骤表由 8 步扩为 9 步（拆出「员工操作流」独立成步），承诺式命名不变 | 随 #3 |

---

## R2 核销台账

> 处置只有两种：**核销@节名**（提案已改）或 **REFUTED+证据**。本轮 **9 条 P0/P1 全部核销，0 条 REFUTE**——我逐条自行读码复核，9 条全部属实，其中 2 条我另找到更强证据（见备注）。

| id | 处置 |
|---|---|
| r2-P0-1（S14-c1 fixedNa 死结，J1-D 恒不可达） | **核销@J10 重写 + J1 重写 + A1/A14**。备注：finding 给的两条方向里，**排除集修正**（而非加第四态）才对，证据来自法源自身——决策① 原文「一份规程**52**格」，而 v3 实测 步骤1-13 全格数 = 13×4 = **52**、加上第14步四格才是 56，即法条本身就把 fixedNa 步整步排除。排除后建行 36 = 52 − 16（步骤1-13 内的 na 格）。红线13 不丢：改由「生成器对 fixedNa 步零建行 + 合看页灰带 + run 结论文案恒含『本轮结论只覆盖前13步』」承载（A14）|
| r2-P0-2（Gate A 假核销，带内通道下发真机采集） | **核销@Gate A 第①层「带内通道剥夺」 + J17 + Step 2/3 拆分 + A11-e**。v3 实测：`cells-map.mjs` 里 `action:'trigger_collect'` **恰 1 格 = S6-c3**；`signup_flow` 1 格（S1-c3，且登录模式下不执行，`capture.mjs:110-126`）；其余 18 格 `observe`。处置按 fail-closed 取零点火，但 REC 不是 controller 划的候选 A 而是**候选 C**（两段式仪式），理由与格数代价写在 J17（A 会把 AI 常态确定判定压到 **3 格**，实测清单在 J17） |
| r2-P0-3（ACCEPTANCE_API_TOKEN 能写人列并伪造 submitted_by） | **核销@J19 + Gate A 第②层重写 + D3 + A2 出口10/11/12**。v3 实测复核：`acceptance-public-server.js:32` 单 token 守全 router 属实；`routes/acceptance.js:342` 公网挂 `POST /acceptance/results`、`:62-66` `submitted_by` 直取 `r.submitted_by` 属实。**另找到更强处置依据**：公网 5223 这套端点的设计消费者是 Notion Worker（`docs/current/acceptance-endpoint-deploy.md`「Worker 侧」），而 Notion Worker 已于 07-31 停摆（决策 `fc7b5dc0`，并被决策 `efa578b8` ⑤「QA 验收留在 Staff Hub 直连 Brain」与 `078b314a`「禁止机器读回 Notion」二次确认）；Staff Hub 反代实测走内网 5221（`services/acceptance.ts:11-12`）。故本期直接**下线**公网人列写端点，而不是给它加防护 |
| r2-P1-1（源② deploy-us-vps.yml 已停用 3 周，两源恒不等） | **核销@J12 重写 + A9**。v3 实测复核：`deploy-us-vps.yml:21-23` on 只剩 `workflow_dispatch` + 文件名已改「已弃用——staging 已迁 HK」；活的是 `deploy-staging-hk.yml:14-20`（push main on `apps/api/**`）。**另找到加强点**：该 workflow `:42` `DEPLOY_SHA: ${{ github.sha }}` 并 `:80` `BUILD_SHA="$DEPLOY_SHA"` 注入容器——所以源② 的 headSha 与实际部署 sha **严格相等**，不存在 TOCTOU；源① 直接读容器自报 build sha 即可 |
| r2-P1-2（sha 绑定只闭合后端，promote-dashboard 不读 inputs.sha） | **核销@J12 三项追加 + A9 重写 + D2/D5**。v3 实测复核：`promote-all-prod.yml:206-230` 全段无 INPUT_SHA、`reset --hard origin/main` 属实；**另发现两处次生问题一并纳入**：①`promote-dashboard` 复位的是 `promote-backend` 刚 pin 到 DEPLOY_SHA 的**同一个** `/opt/zenithjoy/repo`；②`deploy-dashboard-staging.yml:57` 同样 `reset --hard origin/main` 而非 pin `github.sha`，导致前端源② headSha 与实际部署 sha 可能不等（后端无此问题）；③全仓 `VITE_BUILD_SHA/BUILD_SHA/buildSha` 在 `apps/dashboard` 零命中，前端 sha 当前**物理不可观测** |
| r2-P1-3（合法/故障 unverifiable 由 AI 自报，A4 未绑静态属性） | **核销@§无法验证的机械分类表 + A4 重写 + D2 回写端点服务端校验**。判据改为格的静态属性（yaml `verifiable_by` / `scenario_required`），AI 自报 reason 降级为补充说明；`machine_db` 且非 `scenario_required` 的格，合法 reason 集合为**空集**，任何「无法验证」一律归故障类。A4 补第④条整轮哑火识别（确定判定数 = 0 → `ai_status='dumb'`） |
| r2-P1-4（跨轮锚定无人处理，A2 出口2 与 Step 7/A3 三者互斥） | **核销@J2 追加 + §可见性时序表 + A2 出口2 改写 + A3 说明**。裁剪判据写死为「逐行按该行所属 run 的状态」，另加 gp 级闸：同 gp 存在未达 `human_complete` 的 run 时，该 gp 全部轮次 AI 四列 + adjudication 一并隐藏。v3 实测复核：`routes/acceptance.js:264-274` → `loadRunsWithChecks(:155-171)` `SELECT *` 全量返回属实 |
| r2-P1-5（两张表并存且第三态语义相反） | **核销@J18 + D4 + A14**。v3 实测复核：`lib.mjs:430` `STATE_LABEL={ok:'通过',no:'不通过',na:'不适用'}`、`:439` fixedNa 的 c1 渲染成不可填的「固定：不适用」、`:381` 结论文案原文属实；对比 `AcceptanceDetailPage.tsx:141-143` 三态为 通过/不通过/无法验证。定案：可填态统一 `通过/不通过/无法验证`，「不适用」不再是可填值（na 格与 fixedNa 步渲染为不可填灰格）；generated HTML 收编为**只读判据说明书**，填表唯一入口 = Staff Hub |
| r2-P1-6（熔断分母错位，AI 整轮哑火不触发熔断） | **核销@§熔断与哑火判据 + A7 重写**。熔断分母改「非绿格（红 + 未定）占 36 的比例 > 1/3」；AI 整轮哑火单独走 `ai_run_infra_error` 路径：不建 bug/trace、不进熔断、单开 1 个 P0「AI 打表器整轮哑火」，run 标 `ai_incomplete`，闸一律拦 |

---

## Gate A · 边界硬约束（fail-closed，能力层剥夺）

**AI 打表器只走 staging 后台网页，只读观察，一根火都不点：不碰真机、不发起采集、不发私信、不触达任何真实抖音/微信账号。**

v2 的四层被 r2-P0-2 击穿：四层剥的全是**带外**能力（宿主 ssh 逃逸、真机车道 label），而采证器的**带内**能力原样保留——`capture.mjs:152-163` 真的填关键词点「开始采集」，该动作经 `POST /api/acquisition/collect/start` 落 `acquisition_collect_tasks(agent_id)`，由绑在常驻验收租户下的真安卓 agent 领走用真抖音小号执行（凭据注释原文「绑真机租户，4台安卓在线」，`capture.mjs:13-15`）。allowlist 放行 `staging-autopilot.zenjoymedia.media` 恰恰放行的就是这条指挥通道本身。v3 把「零点火」提升为第①层，且它是**唯一一层需要动采证器代码**的：

| 层 | 落法 | 机械性 |
|---|---|---|
| **①带内通道剥夺（v3 新增，最重要）** | 采证器删除「发起采集」交互；`cells-map.mjs` 的 `action` 枚举去掉 `trigger_collect` 与 `signup_flow`，只剩 **`observe`** 一值，schema/单测强制。**受影响格数写死：`trigger_collect` 恰 1 格 = S6-c3**（v3 实测全表 20 格：signup_flow 1 / trigger_collect 1 / observe 18）。S6-c3 改为观察员工本轮已发起的任务记录（任务编号来自 run 单头，见 J17-C） | 机械（`action` 枚举单测 + 采证器全文 `grep -c '开始采集\|collect/start'` == 0，A11-e） |
| ②执行环境剥夺 | 打表器 job 固定 `runs-on: ubuntu-latest`（GitHub 托管），**禁止** `self-hosted` / `android-capable` label。手机池只经 self-hosted 车道可达（`nightly-android-fleet-pc4.yml:36,114`），托管 runner 够不着真机 | 机械（workflow 文件可 grep 断言，A11-a） |
| ③凭据剥夺（v3 重写） | 该 job 的 `secrets` 白名单 = `STAGING_ACCEPTANCE_EMAIL` / `STAGING_ACCEPTANCE_PASSWORD` / **`ACCEPTANCE_AI_TOKEN`**（新，只能写 AI 四列）。**`ACCEPTANCE_API_TOKEN` 移出白名单**（r2-P0-3：它能写人列并伪造 `submitted_by`）；**禁止** `TAILSCALE_AUTHKEY` / `HK_VPS_SSH_KEY` / 1Password token。判定任务跑 Brain docker 内（`executeInDocker`），不走 `executeOnHost` | 机械（smoke 解析 workflow yaml 断言白名单，A11-b） |
| ④网络 allowlist | Playwright `page.route('**', …)` 只放行 `staging-autopilot.zenjoymedia.media`，其余 host abort；`checkCellsMapComplete`（`capture.mjs:61-67`）保留，白名单外格号拒绝执行并写「无法验证」 | 机械（单测 A11-c） |
| ⑤产物约束 | 证据截图与文本快照走 CI artifact，**不 commit 进 repo**（现 `acceptance-spec/runs/*/ai-column.json` 含真实线索 PII）；结论只 POST 进 DB | 机械（`git ls-files` 断言，A2 出口8） |
| ⑥事后核对 | 断言 **A4**（16 个 human_only 格恒「无法验证」）+ **A11**，兜底不作主防线 | 事后 |

**S12 全 4 格 + S13-c1/c3 等需安卓真机的格，AI 列恒为「无法验证」，不允许出现「通过」**——这是 Gate A 的设计输出。

## Gate B · 前置探明（开工第一件事，半天内出结论，不过则改道）

1. 5223 **公网可达性**（GitHub ubuntu runner 能否打通 gate 只读端点）。
2. gate 端点鉴权形态 → 已由 J19 定案为**独立只读 token**（`ACCEPTANCE_GATE_TOKEN`），此条转为「确认 Brain 生产容器能注入第三个 env」。
3. **（v3 新增，← P2-5）托管 runner 上真跑一次 capture 登录**：网络可达性有先例（`deploy-dashboard-staging.yml:37` 的 ubuntu-latest job 已在打公网 staging），但先例全是 `curl`，没有「托管 runner 数据中心 IP 上跑 headless chromium 完成 better-auth 登录」的实证（`deploy-lib.sh:505-513` 有 better-auth invalid origin 前科）。开工首日真跑一次，**不通则登记回落方案，且回落不得落回 self-hosted 真机车道**（会推翻 Gate A 第②层）。

- 1/3 **通** → 按 J7-A。**1 不通** → J7-B（Brain 定案时反向 push commit status）。**3 不通** → 升级给主理人重新拍板 J17（因为 AI 列取证路径本身没了）。

---

## 两列九组合裁决矩阵（决策①③⑥的机械口径）

人列枚举 `通过/不通过/无法验证` 是 DB 强约束（`369_acceptance_tables.sql:25`，v3 实测），AI 列复用同一套枚举（J6）。两列各含「未填/未跑」的空态，故实为 4×4，空态统一归 **Q0**。**矩阵仍是三态——「不适用」不是终态而是「不建行」**（J10/J18）。

### 「无法验证」的机械分类（v3：判据 = 格的静态属性，不是 AI 自报）

| 分类 | 判据（**服务端按 yaml 静态属性算**，AI 自报 reason 只作补充说明） | 享受 Q3 绿通道 |
|---|---|---|
| **合法 · human_only** | 该格 yaml `verifiable_by == 'human_only'`（16 格） | 是 |
| **合法 · scenario_not_triggered** | 该格 yaml `scenario_required == true`（6 格：S4-c2/S4-c3/S5-c3/S5-c4/S10-c4/S13-c4，v3 实测），且 AI 证据里无该场景 | 是 |
| **故障** | 其余全部——即 `machine_db` 且非 `scenario_required` 的格（**14 格**）的任何「无法验证」，无论 AI 写什么 reason | **否** |

**机械化落点**（堵 r2-P1-3 的洗白路径）：`POST /acceptance/ai-results` 服务端校验——AI 提交 `reason='human_only'` 而该格 yaml 不是 human_only → **400 拒收**；`reason='scenario_not_triggered'` 而该格无 `scenario_required` → **400 拒收**。故障类 reason（`page_unreachable`/`login_failed`/`timeout`）任何格都可提交，但一律不进绿通道。

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
| Q0′ | 任意 | 未跑 | AI 列缺格 | 按人列单列判：通过→绿，不通过→红，无法验证→未定 | 单独重跑打表器补格 | **拦**（缺格视同未拿到确定绿） |

**闸判据**：
> 一格的最终态为**绿**，当且仅当它落在 Q1、Q3，或经主理人裁决 `verdict='绿'`。其余（红、未定、缺格、空态）一律**拦**。
> **分母 = 36 个建行格**（J10）。8 个 hard 红线格（S2-c4/S5-c4/S6-c4/S8-c4/S10-c4/S11-c4/S12-c4/S13-c4，v3 实测全部落在步骤 1-13，不受 J10 改动影响）不可被任何 `bypass` 豁免；hard 格唯一逃生阀是**有名有姓的裁决**（记裁决人/理由/时间，计入棘轮 A12）。

**`passed` 不再是放行判据**：现行 `status = pending>0?'in_review':fail>0?'failed':pass===total?'passed':'in_review'`（`acceptance.js:88`）里只要有一格「无法验证」，`pass===total` 永假 → `passed` 物理不可达。D1 改为新状态机。

### 熔断与哑火判据（v3 重写，← r2-P1-6）

| 情形 | 机械判据 | 处置 |
|---|---|---|
| **AI 整轮哑火** | 本轮 AI「确定判定」（`ai_verdict ∈ (通过,不通过)`）格数 **== 0**，或 20 个 machine_db 格中**故障类**无法验证 ≥ 10（半数） | run 标 `ai_incomplete` + `ai_status='dumb'`；**不建** bug/trace 任务、**不进**熔断；单开 1 个 P0「AI 打表器整轮哑火」；闸一律拦（拿不到确定绿）|
| **熔断（规程/数据源疑似分叉）** | 在 AI 未哑火的前提下，**非绿格（final_state ∈ {红, 未定}）占 36 的比例 > 1/3** | 不建 37 个散任务，改开 1 个 P0「规程/数据源疑似分叉」 |
| **常规分流** | 未哑火且未熔断 | 每 run ≤1 bug 任务 + ≤1 追查任务（A7） |

---

## AI 列可见性时序表（v3 新增，← r2-P1-4）

裁剪**不是逐端点打补丁**，而是在 `loadChecks`（`acceptance.js:151`）/`loadRunsWithChecks`（`:155-171`）的 SQL 层做**列白名单**：AI 四列（`ai_verdict`/`ai_evidence`/`ai_run_at`/`adjudication`）默认不 SELECT。

**裁剪判据（写死，堵 r2-P1-4 的三者互斥）**：

1. **逐行判定，不是响应级**——一行是否带 AI 四列，看**该行所属 run** 的状态（`loadRunsWithChecks` 是多 run 响应，响应级判据无解）。
2. **gp 级防跨轮锚定闸**——若该 `gp_id` 下存在**任一**未达 `human_complete` 的 run（= 本轮填表进行中），则该 gp 的**全部轮次**（含已定案的历史轮）AI 四列与 `adjudication` 一并隐藏。J5-A 把 `check_key` 改成规程格号后，S3-c1 每轮同名，不加这条闸则员工在本轮填表期能从「验收历史」页看到上一轮同格的 AI 判定与裁决理由，锚定照旧成立。
3. **合看态**需显式 `?view=review` 且服务端校验该 run 已达 `human_complete`（Staff Hub 员工身份亦可，见 Step 7）。

| 时刻 | run 状态 | 员工看得到 AI 四列 / adjudication？ | 依据 |
|---|---|---|---|
| T0 建单 | `pending` | 否 | 判据 2 |
| T1 员工操作流 + 填表期 | `pending`/`in_review` | 否（含全部历史轮） | 判据 2 —— 决策② 防锚定的**唯一**硬窗口 |
| T2 最后一格提交 | `human_complete` | **是**（本轮 + 历史轮同时解锁） | 判据 1+3 |
| T3 主理人裁决中 | `human_complete` | 是（AI 列可见，adjudication 逐格随裁决落库而出现） | 判据 1 |
| T4 定案 | `adjudicated` | 是 | Step 7 = 决策③ 的要求 |

> **冲突消解**：决策③ 要求员工在裁决后看得到裁决理由（Step 7），而防锚定只须约束「**本轮人列提交前**」这一段（T1）。v2 的 A2 把 `adjudication` 无条件列进禁止集，才与 Step 7 打架；v3 用时序表把两者分到 T1 / T2+ 两段，互不重叠。

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
| **Step 1** 发版人发起这一轮验收后，员工当天在待办里就看到一张属于这个构建的单子，单头写着它验的是哪个构建（前后端各一个 sha）、哪一版规程 | **半成** | L2（服务端真验） | run 建单端点幂等(已有，`acceptance.js:183`)／**36** 有效格从规程展开成行(**缺失**)／每格 `kind` 来源(**缺失**，yaml 全文零个 kind 字样，J14)／`backend_sha` + `frontend_sha` 双源对账写进单头(**缺失**；后端源② `deploy-staging-hk.yml:42` 已 pin `github.sha` **可直接用**，前端 `deploy-dashboard-staging.yml:57` 仍 `reset --hard origin/main` **需改 pin**，且前端全仓无 build sha 标记)／规程版本锁 `version`+`spec_sha`(**半成**，`acceptance_runs.version` 列已有但没人写)／侧边栏待办角标(**缺失**，`App.tsx:46-48` 是纯文本 NavLink)／仪式发起通知(**缺失**) | 分支：同构建已有 run → 幂等复用不重开；任一源两两不等 → **拒绝建单**并告警。判定点 **J5**（格号）／**J10**（排除集）／**J12**（冻结锁与双源）／**J14**（kind）／**J16**（仪式） |
| **Step 2**（v3 新增）员工先把这一轮的现场跑完——真机装绑、发起采集、走到私信——单头上留下这一轮的任务编号和暗号，后面所有证据都对得上这一轮 | **半成** | **L3（真机真验）** | 规程 op 序列(**已有**，yaml 14 步 op 字段)／现役网页的单头字段(**已有**，`lib.mjs:292-299` 有 测试日期/测试人/手机型号/客户端编号/本轮采集任务编号/本轮暗号)／这些字段落进 `acceptance_runs.detail`(**缺失**)／录屏与截图证据规范(**已有**，`lib.mjs:370-372`) | 分支：员工现场跑不通（真机掉线/装不上）→ 本轮直接标 `stale` 重开，不进 AI 采证。判定点 **J17**（仪式两段式与点火边界）／**J16**（工时） |
| **Step 3** 员工坐下来判之前，AI 已经把它能在网页上看见的那部分先看过一遍；它一根火都不点，看不见的老实说看不见，还说得出为什么看不见 | **半成** | **L3（真环境真验）** | 采证器走真 staging UI + 截图 + `innerText`(**已有且有 2 轮真实产物**，`capture.mjs:32,54-57`)／常驻登录凭据(已有，1Password CS)／自动触发(**缺失**，全仓无 workflow/npm script，`capture.mjs:236` 硬编码 `trigger:'manual'`)／**删除「发起采集」交互，`action` 枚举收敛为单值 `observe`**(**缺失**，现 `capture.mjs:152-163` 真点「开始采集」)／按单头任务编号定位本轮任务(**缺失**)／结论回写 `POST /acceptance/ai-results`(**缺失**，产物落 repo 与 DB 零通路)／reason 与静态属性的服务端校验(**缺失**)／Gate A 六层(**缺失**) | 分支：某格页面打不开 → 记 `page_unreachable`（**故障类**，不享受 Q3 绿通道），不中断整轮。判定点 **J3**（执行体）／**J4**（诚实边界）／**J17**（点火边界）／**J19**（回写凭据） |
| **Step 4** 员工打开验收页，看到的还是那张熟悉的表；AI 那一列此刻对他根本不存在，翻 F12、换端点、走公网、翻上一轮的历史单都翻不出来 | **半成** | L2（服务端真验） | 三个页面(**已有**，路由 `App.tsx:66-68`)／分批草稿增量提交(已有)／`submitted_by` 防伪注入(**已有且有测试**，`middleware/staff.ts:44`→`staff.ts:338`)／**服务端列裁剪(完全缺失**，三跳全裸：`acceptance.js:155-171` `SELECT *` → `services/acceptance.ts:52` → `staff.ts:319`)／**gp 级跨轮闸**(**缺失**，`验收历史` 入口已存在 `App.tsx:49-51`)／9 条出口逐条覆盖(**缺失**)／第三态措辞统一为「无法验证」(**Staff Hub 已是**，`AcceptanceDetailPage.tsx:141-143`；**现役 generated HTML 仍是「不适用」**，`lib.mjs:430`) | 分支：员工只填一半离开 → 草稿按子集留存（既有）。判定点 **J2**（可见时机与时序表）／**J6**（存储形态与裁剪位置）／**J18**（现役网页处置） |
| **Step 5** 员工把最后一格交上去的那一刻，两列一起亮出来，哪些一致、哪些打架、哪些两边都没验成，一眼看清 | **缺失** | **L3（真浏览器真页面截图）** | 九组合矩阵合看页(**缺失**，全仓 grep「对比页\|四象限」非 md 零命中)／`human_complete` 解锁态(**缺失**)／AI 缺格降级态(**缺失**)／需真机/需场景的格在填表页提前标出(**缺失**，`device` 列已有已渲染，`scenario_required` 只在 `cells-map.mjs:23-67` 未进 yaml)／fixedNa 步骤渲染为灰带「固定不适用（本版未做）」(**缺失**) | 分支：AI 列缺格 → Q0′ 按人列单列判，且不得算作 hard 格的绿。判定点 **J1**（放行分母）／**J8**（这页从哪打得开） |
| **Step 6** 打架和没验成的格子主理人当场拍板；拍完这一版验收就有了定论，定论跟着两个构建号和规程版本一起存档 | **缺失** | L2（服务端真验） | `adjudication` 字段与裁决 API(**缺失**，`\d acceptance_checks` 无此列)／裁决人与理由留痕(**缺失**)／run 状态机 `adjudicated` 与 `gate_verdict`(**缺失**，`369_acceptance_tables.sql:11` 只许 4 值)／hard 格裁决绿自动开 P0(**缺失**) | 分支：Q5/Q6/Q8 → bug 任务；Q4/Q7 → 追查任务；Q9 → 补验证手段任务；非绿格占比 >1/3 → 熔断；AI 整轮哑火 → 走 `ai_run_infra_error` 不进熔断。判定点 **J1**／**J15** |
| **Step 7** 员工回到同一页，能看到主理人怎么判的、为什么这么判——尤其是自己判红被推翻的那几格 | **缺失** | L2（服务端真验） | 员工身份的裁决回显视图(**缺失**)／裁决理由对员工可见的权限口径(**缺失**，时序表 T2 起开放) | 分支：员工对裁决有异议 → 在该格追加 note，进下一轮仪式复盘（不阻塞本轮定案）。判定点 **J2** |
| **Step 8** 发版人点 promote 的时候，如果这一版的表没绿，闸当场拦住他，并且直说卡在哪几格；拿旧单子想放行新构建、或者只换了前端没换后端，也一样拦 | **缺失** | **L3（真闸真跑）** | `release-gate` job 三步式结构(**已有且真在用**，5 次真实 dispatch，`promote-all-prod.yml:59-138`)／后端 `sha` 输入与 `DEPLOY_SHA` 解析(**已有**，`:164-184`)／**前端 `promote-dashboard` 读 `inputs.sha`**(**缺失**，`:206-230` 全段无 INPUT_SHA，且 `reset --hard origin/main` 会把 backend 刚 pin 的同一个 repo 复位)／第三证据项(**缺失**，落点 `:138` 之后)／gate 脚本 + selftest workflow(**缺失**)／棘轮与计数(**缺失**) | 分支：取数失败 = **红**（fail-closed），仅此情形可填 `bypass_two_column_infra`；格红一律不可豁免。判定点 **J7**（取数通路）／**J9**（怎么验闸而不真发版）／**J12**（sha 绑定）／**J15**（逃生阀） |
| **Step 9**（出错路径）任何一步塌了，主理人在验收单上就看得见是哪一步塌的，并且能重开一轮而不丢上一轮的留痕 | **缺失** | L2（服务端真验） | run 的 `stale` 状态与 `ai_incomplete` 标记(**缺失**)／同 GP 多轮 run 并存(**当前物理不可能**，`acceptance_checks_check_key_key` 全局 UNIQUE)／跨 run 写隔离(**缺失且是新坑**，`acceptance.js:62-66` `UPDATE … WHERE check_key = $4` 不带 run_id) | 分支：验收期间 staging 重部署或规程改版 → run 标 `stale`，人列提交 409，必须重开新 run。判定点 **J5**／**J12** |

### 出错路径的用户视角（发现 → 恢复）

| 故障 | 用户怎么发现 | 怎么恢复 |
|---|---|---|
| AI 打表器中途挂 | 单头显示「AI 列不完整（已完成 N/20）」 | 员工照常填；缺格按 Q0′ 判；可单独重跑打表器补格 |
| **AI 打表器整轮哑火**（登录失效/staging 全站不可达） | 单头显示「AI 列本轮无效（确定判定 0 格）」+ 自动开的 P0 任务 | 修通路后重跑采证；**不进**熔断、不建 bug/trace；闸一律拦到 AI 列有效或主理人逐格裁决 |
| staging 在验收中途被重新部署 | 提交人列时 409，页面提示「本单验的构建已失效」 | 重开新 run（新 sha 二元组），旧 run 存档为 `stale`，留痕不删 |
| 规程 yaml 改版 | 同上（`spec_sha` 不匹配） | 同上；改版说明写进新 run 单头 |
| 放行闸取不到双表数据 | promote 时 release-gate 红，summary 写「双表取数失败（infra_error）」 | 修通路后重跑；紧急发版填 `bypass_two_column_infra`（进 summary 大字 + 棘轮计数） |
| 员工与 AI 大面积分歧 | 合看页整列变分歧色 | 先怀疑打表器（核 AI 证据截图是否为登录页）；非绿格占比 >1/3 自动熔断，改开「规程/数据源疑似分叉」P0 |
| **AI 打表器误触达真人（红线7 暗号已发出）** | 收信端账号出现非计划私信 / 抖音风控告警 / 打表器日志出现非 allowlist host 或 `collect/start` 调用 | ①立刻停跑该 workflow 并吊销 `STAGING_ACCEPTANCE_*` + `ACCEPTANCE_AI_TOKEN`；②在收信端截图取证，本轮 run 直接标 `stale` 作废（暗号已消耗，S12 本轮不可复用，需换新暗号）；③开 P0 复盘 Gate A 哪一层被穿；④Bark 告警主理人（不走飞书）；⑤补 A11 的机械断言覆盖被穿的那一层后才允许重新开跑 |

---

## 验收断言（A1-A14，冻结后 AI 不可改）

对齐 PRD `Final E2E`，按 **36 格**口径与 r2 findings 修正。所有 shell 断言禁用裸 `grep -c`（`|| true` 兜底）。

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

**A4 · AI 诚实边界（Gate A 的机械化，决策⑤；v3 绑静态属性）**
```sql
-- ① 16 个 human_only 格（yaml 解析得出）不得出现「通过」
SELECT count(*) FROM acceptance_checks
WHERE run_id=:rid AND check_key IN (:human_only_16_list) AND ai_verdict <> '无法验证';  -- == 0
-- ② AI 给出确定判定的格数上限 = machine_db 20
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_verdict IN ('通过','不通过');  -- <= 20
-- ③ reason 与格的静态属性绑定（不是 AI 自报说了算）
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_evidence->>'reason'='human_only'
  AND check_key NOT IN (:human_only_16_list);              -- == 0
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_evidence->>'reason'='scenario_not_triggered'
  AND check_key NOT IN (:scenario_required_6_list);        -- == 0
-- ④ 整轮哑火识别（v3 新增，堵「count=0 恒满足 <=20」）
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_verdict IN ('通过','不通过');  -- == 0 时
-- 断言 acceptance_runs.detail->>'ai_status' = 'dumb' 且 gate_verdict='红'
```
并断言：向 `POST /acceptance/ai-results` 提交「非 human_only 格 + reason='human_only'」→ **HTTP 400**（服务端强校验，不落库）。

**A5 · 九组合矩阵机械对表**
构造一个测试 run，把 9 种组合各造至少 1 格（含 Q0/Q0′/Q3′），断言：
- 每格 `final_state` 与本文矩阵表逐行一致（服务端计算，psql 读回）；
- `gate_verdict='绿'` 当且仅当 **36** 格 `final_state` 全绿；任一 hard 格非绿 → `gate_verdict='红'` 且 `red_cells[]` 含该格号；
- hard 格为 Q3′（故障类无法验证）时**不得**被判绿。

**A6 · 合看页 + 裁决落库 + 员工回显（决策③）**
截图证据 **4 张**：①九组合矩阵全貌（至少含双绿/分歧/双红/仅人列绿四色 + 缺格降级图例 + 第14步灰带）；②一个分歧格展开，左 AI 证据右员工 note 并排；③主理人点裁决后的确认态；④**员工身份登录**同一页，看到裁决人与理由。加 psql：
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

---

## 判定点登记表（J1-J19，批准即写 decisions 冻结）

**J1 · ⚠️「双表绿」放行判据的分母**（v3 改数）
- 候选：A 36 格**双列都绿** ／ B 20 machine_db 双绿 + 16 human_only 人列独判 ／ C 只看 8 红线格 ／ **D 36 格「最终态」全绿**
- **REC = D**（分母由 37 改 36，见 J10）
- 依据：AI 天花板是有限确定判定 + 16 格恒无法验证，**A 物理不可达**；B/C 把「人列没验成」和「没填」当成默认放行，正是 product#P0-1 的绕过口。D 用「最终态」统一口径：绿只来自 Q1、合法 Q3、或裁决绿。v2 的 D 之所以仍恒不可达，是因为分母里混进了 S14-c1 这个**恒不可判**的格（r2-P0-1）——J10 修掉分母后，D 才真正可达。
- 误判后果：选 B/C → 8 个 hard 格里 4 个可以「无法验证」蒙混过关；选 A → 闸恒红，三次之后必被豁免成摆设。

**J2 · ⚠️ AI 列可见时机**（v3 追加跨轮闸）
- 候选：A 逐格提交后该格解锁 ／ **B 人列全表提交（run 达 `human_complete`）后统一解锁**
- **REC = B**，v3 追加两条：**①裁剪判据 = 逐行按该行所属 run 的状态**（`loadRunsWithChecks` 是多 run 响应，响应级判据无解）；**②gp 级跨轮闸**——同 gp 存在未达 `human_complete` 的 run 时，该 gp 全部轮次 AI 列 + `adjudication` 一并隐藏。
- 依据：`check_key` 改规程格号后每轮同名（J5-A），而「验收历史」入口已存在（`App.tsx:49-51` → `services/acceptance.ts:64-67` → `routes/acceptance.js:264-274` 全量返回）；不加 gp 级闸，员工本轮填表期就能看到上一轮同格的 AI 判定，锚定照旧成立。防锚定只须约束 T1（本轮人列提交前）这一段，故与 Step 7（决策③ 要求员工看得到裁决）不冲突——时序见§可见性时序表。
- 误判后果：选 A 且 9 条出口漏一处 → 整轮双列独立性作废且事后无法察觉；不加 gp 级闸 → 从第二轮起防锚定形同虚设。

**J3 · ⚠️ AI 打表器的执行体**
- 候选：A mac_web 的 Claude + Playwright ／ **B zenithjoy GitHub 托管 runner 跑 capture，判定另派 Brain docker 内任务** ／ C Brain 内置 curl/psql 直跑
- **REC = B**（不变）
- 依据：决策⑤ 字面「判据=屏幕所见非查库」作废 C。A 的问题是**能力过剩**：`spawn.js:66` 判到 `mac_web` 即走 `host-executor.js` ssh 逃逸宿主。B 的托管 runner 同样跑真 chromium，但物理上够不到手机池，且 secrets 可白名单化。
- 误判后果：选 A →「不碰真机」只剩提示词承诺。
- **v3 附注**：B 只解决**带外**逃逸；带内（经 staging 后台指挥真机）由 J17 解决，两者缺一不可。

**J4 · ⚠️ 不可自动化格的 AI 列**（v3 改判据来源）
- 候选：A 标「无法验证」留空 ／ B 硬跑给低置信判定
- **REC = A**，v3 追加：「无法验证」的**合法/故障分类由格的静态属性判定**（yaml `verifiable_by` / `scenario_required`），AI 自报 `reason` 只作补充说明，且服务端对不匹配的 reason 直接 400。
- 依据：`cells-map.mjs:14` 已明规「场景未出现必须判无法验证，不许假绿」。v2 把分类落在 AI 自填的 `ai_evidence.reason` 上，等于让被考核者自己定考卷（r2-P1-3）——`machine_db` 且非 `scenario_required` 的 **14 格**，合法 reason 集合为空集，任何「无法验证」一律故障类。
- 误判后果：不绑静态属性 → 打表器登录失效整轮哑火时把 reason 写成 `human_only` 就从 Q3′ 滑进 Q3 绿通道，一轮什么都没验的 run 被判定案绿。

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
- 依据：
  - **A 与 C 的安全边界完全相同**（AI 都是零点火），差别只在 AI 跑的时刻；但 **A 的完备性代价极大**：v3 实测 20 个 machine_db 格里，**11 格**的判据原文依赖本轮采集数据（S6-c3/S7-c1/S7-c2/S8-c1/S8-c3/S8-c4/S9-c1/S9-c2/S10-c1/S11-c1/S11-c3），**6 格**是 `scenario_required`（S4-c2/S4-c3/S5-c3/S5-c4/S10-c4/S13-c4，无场景时本就合法无法验证），剩下 **3 格**（S1-c3/S6-c4/S11-c4）才是常态可判——即 **A 会把 AI 的常态确定判定压到 3/36 格**，两列制退化成摆设，而闸判据（J1-D）依赖 AI 列有实质内容才有对抗价值。
  - **C 不违反决策②**：决策② 的字面是「员工填表时绝不可见 AI 判定，AI 列后台先行完成」——约束的是「**先于填表**」，C 里 AI 采证发生在 Step 2（操作）之后、Step 4（填表）之前，字面成立。员工的「发起采集」本来就是规程 S6 的 `op`（原文「在预发环境用本轮关键词发起一个采集任务」），是**员工授权的人工动作**，不是 AI 的点火。
  - **C 不削弱防锚定**：AI 读的是 staging 页面状态，读不到人列（人列此时还没填；且 AI 的 `ACCEPTANCE_AI_TOKEN` 按 J19 物理上读不到 checks）。
- **候选 B 呈主理人拍板（不由 AI 单方决定）**——两条路的真实边界：
  | | A/C（零点火） | B（允许点火，专用租户+专用小号） |
  |---|---|---|
  | AI 常态确定判定格数 | C：20 格；A：3 格 | 20 格 |
  | 真机/真账号风险 | 零 | 每轮多一次真实抖音采集：小号风控/封号、目标视频作者被真实触达、手机池占用 |
  | 仪式跨度 | C：约 2 小时两段 | 一坐到底约 1.5 小时 |
  | 需新增资产 | 无 | 专用验收租户 + 专用小号（需采购/养号）+ 与生产小号池的隔离验证 |
- 误判后果：选 B 而不做租户/小号隔离 → 每轮验收都在真实抖音上打一次采集，风控与触达风险按轮累加，且 Gate A「不触达任何真实抖音账号」变成空话；选 A → AI 列只剩 3 格有内容，闸判据的对抗价值归零，几个月后必被当作噪音关掉；选 C 而不把「员工操作流」显式拆成独立步骤 → 员工会边跑边填，AI 采证时人列已部分落库，防锚定窗口失守。

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
- 误判后果：选 A/B 而保留 AI 侧持有人列写权 → 决策② 在能力层永远不成立，且「AI 伪造员工判定」这种事**数据里看不出来**（`submitted_by` 就是员工名）；不下线公网人列写端点 → 一把泄露的 token 就能把任意一轮验收单全写成绿并放行生产。

---

## 交付物划分（按依赖排序；实现路径见 J13）

> 命名按内容不按代号。每件对应一个 `/dev` 任务，`payload.anchor` 必带 `{journey_id, gp_id, step_id}` 三件套。

**D1 · 数据层地基与状态机**（cecelia，阻塞其余全部）
AI 四列 migration（J6-A，中文枚举 + CHECK）＋ `check_key` 改规程格号 ＋ `UNIQUE (run_id, check_key)`（J5-A）＋ `submitAcceptanceResults` 全链路加 `run_id` 作用域 ＋ **规程 yaml → 36 格建单生成器**（J10-B 的排除集：`na:true` ∪ `fixedNa` 步骤全格；含 J14 的 kind；`scenario_required` 从 `cells-map.mjs` 迁进 yaml 成为静态属性）＋ `backend_sha`/`frontend_sha` 双源对账与 `spec_sha`/`version` 落库（J12）＋ **run 状态机改造**（`369_acceptance_tables.sql:11` 的 CHECK 加 `human_complete`/`adjudicated`/`stale`，`status` 计算改按九组合矩阵算 `final_state` 与 `gate_verdict`，`detail.ai_status` 记哑火，`passed` 退为历史兼容值）。
对应 Step 1 / Step 6 / Step 9；解锁断言 A1 / A3 / A5 / A9 / A10 / A14。

**D2 · AI 打表器零点火化与 Gate A 机械约束**（zenithjoy 为主，cecelia 加回写端点）
**采证器删除「发起采集」交互、`action` 枚举收敛为单值 `observe`、改按 run 单头的本轮任务编号定位任务**（J17-C，Gate A 第①层）＋ 打表器 workflow（`runs-on: ubuntu-latest`，J3-B）＋ Playwright 域名 allowlist ＋ secrets 白名单与 smoke 校验（**不含 `ACCEPTANCE_API_TOKEN`**）＋ staging 后端 `GET /api/version` 暴露已有 build-info（**措辞修正 ← P2-2**：`apps/api/src/app.ts:109,115` 已有根路径 `/version`，公网 404 是因为隧道只把 `/api/*` 路由到 API；本项 = 把已有 build-info 挂到 `/api` 前缀，并确认 staging 部署链真的注入了 `BUILD_SHA`——`deploy-staging-hk.yml:80` 已注入）＋ **staging 前端新增 build sha 标记**（`VITE_BUILD_SHA` 注入 + 页面可读，全仓现零命中）＋ **`deploy-dashboard-staging.yml:57` 改 pin `github.sha`** ＋ 判定任务（Brain docker 内，读 artifact 截图判「屏幕所见」）＋ `POST /acceptance/ai-results` 回写端点（J19 的 AI token；reason 与静态属性的服务端强校验，不匹配 400）＋ 产物不再 commit 进 repo。
对应 Step 3；解锁断言 A4 / A11。

**D3 · 背靠背裁剪与凭据分权**（cecelia + zenithjoy 反代；依赖 D1 的列存在，可与 D2 并行）
`loadChecks`/`loadRunsWithChecks` SQL 列白名单 ＋ `view` 参数与服务端 `human_complete` 校验 ＋ **gp 级跨轮闸**（J2 判据②）＋ 9 条读侧出口逐条覆盖 ＋ 反代层同步不透传 ＋ **`createBearerAuth` 下沉到路由级、三 token 分权、公网 `POST /acceptance/results` 与 `GET /acceptance/pending` 下线**（J19，含下线前的访问日志核查）。
对应 Step 4；解锁断言 A2（读侧 + 写侧）。

**D4 · 合看页、裁决、员工回显、员工表收编与分流建单**（zenithjoy 页面 + cecelia 后端；依赖 D1/D2/D3）
九组合矩阵合看页（`apps/staff-hub/src/pages/`，含 device / `scenario_required` 标记 + 第14步灰带）＋ `adjudication` 裁决 API 与 hard 格裁决绿自动开 P0 ＋ 员工侧裁决回显视图 ＋ 侧边栏待办角标与仪式发起通知 ＋ **建单页承接现役网页的表头字段**（手机型号/客户端编号/本轮任务编号/本轮暗号 → `acceptance_runs.detail`）＋ **`lib.mjs` 收编：generate 改产只读判据说明书，去掉三态按钮，第三态措辞统一**（J18-B）＋ 聚合式分流建任务（≤1 bug + ≤1 trace、**查重谓词加 `acceptance_bucket` 维度**、anchor 三件套、非绿格占比 >1/3 熔断、AI 整轮哑火走独立 P0）。
对应 Step 2 / Step 5 / Step 6 / Step 7；解锁断言 A6 / A7 / A13 / A14。

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
| P2-16 | theater 闸 GP 段提取兜底：`sprint-prd.md` 无 `## Golden Path` 标题则扫全文，且 `###` 子标题不终止段落 | `harness-judge.js:796` |
