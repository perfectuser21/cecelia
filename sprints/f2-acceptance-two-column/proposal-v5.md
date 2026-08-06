# 发版验收一体两面——F2 步2 加厚「一张表两列背靠背合着看」Golden Path v5

提案人：Cecelia（AI）。v5 = 对 solo 复审 r4（`.harness/verdicts/gp-r4-solo.json`）的逐条修订轮：**0 P0 / 3 P1 全部核销，0 REFUTE，4 P2 全部核销，P2 记账累计 24 条**。r2/r3 的台账留痕在 `proposal-v3.md` / `proposal-v4.md`，本版不重抄。

- **归位**：工厂 · F2 部署闭环（journey `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`）· 步2「部署被证明没坏」· 动作=**加厚**（非新路）
- **GP_ID**：`7790f728-f490-4243-b166-03f3250a0938`（golden_paths，candidate）
- **法源**：决策 `fdeb48aa` 六条（一字为法，本提案不得改写其语义）；④「移交节奏」Phase 2+ 只登记
- **现状依据**：`.harness/explore-report.md` + v2/v3 实测 + 本轮为核销 r4 findings 新增的直接读码/解析（新增部分逐条标「v5 实测」）

---

## 0. 相对 v4 的结构性变化

| # | 变化 | 回应 |
|---|---|---|
| 1 | **跨轮闸判据② 由「未达 `human_complete`」收窄为「活跃 run」**：活跃 = `status ∈ ('pending','in_review')`；`stale`/`expired`/`abandoned`/`adjudicated` 全部**不是**持锁者。同时补齐 v4 缺失的 **pending run 退出路径**（`expired` 自动过期 + `abandoned` 显式作废），run 状态机由 5 值扩到 7 值。A2 反向断言与 A15 各补「同 gp 存在 stale/expired run 时仍可合看」构造用例 | → r4-P1-1 |
| 2 | **「场景是否发生」从 AI 自报改为有证据指针的机械判据**：新增每格静态属性 **`scenario_class`** 三值（`mandatory` / `opportunistic` / `unverifiable_this_version`），配**双闸**——闸①（提交期，比对员工在 Step 2 勾选的 `detail.scenarios_observed[]`）＋闸②（合看期，人列给出确定判定即证伪 AI 的 `scenario_not_triggered`，该格翻 **Q3″** 拦闸）。逐格核完 6 个 `scenario_required`：**2 格摘除**（S4-c2/S4-c3 场景恒发生）、**3 格保留**（S5-c3/S5-c4/S10-c4）、**1 格 fail-closed**（S13-c4 本版物理不可制造）。新增判定点 **J20**、断言 **A17**、A4⑥⑦ | → r4-P1-2 |
| 3 | **复盘闭环主体写死为「发起人 / 主理人」，员工侧改 ack + 异议 note**；配**防橡皮图章闸**（全部人列提交人已 ack 或距定案满 24h 才准关）与**建单 409 逃生阀**（`force_reason` 强开新轮 + 审计留痕 + 计入棘轮）。出错路径表补两行 | → r4-P1-3 |
| 4 | **v5 新增实测发现（顺 P1-2 逐格核出）**：**S4-c2「在约定时间窗内恢复在线」与 S7-c2/S9-c2 同属时限格**——候选 C 之下 AI 迟到约 40 分钟，同样只能读页面时间戳。按 fail-closed 一并摘出 AI 可判集合，Gate B 第4条由两格扩到**三格两类页面** | → 顺 r4-P1-2 核出 |
| 5 | **§口径切换表整表重算**：基线 human_only **20** / machine_db **16** / 故障类 **13** / AI 上限 **16** / 哑火分母 16 阈值 ≥8；切回 17 / 19 / 16 / 19 / 19 阈值 ≥10 | → 随 #2 #4 |
| 6 | **P2 编号去重与条数对齐**：重复的第二条 P2-16（theater 闸兜底）重编 **P2-21**；新增 P2-22/23/24；全表 **24 条** | → r4-P2-21 |
| 7 | **J17 对照表 A/C 列口径对齐**：C 列改报「常态确定判定 13（基线）/16（切回）」，与「AI 确定判定上限 16/19」分列表述，不再拿上限充常态 | → r4-P2-22 |
| 8 | **D1 措辞纠正**：`verifiable_by` **本就在 yaml 里**，需从 `cells-map.mjs` 迁入的只有 `scenario_required`（并升级为 `scenario_class`）；D1 对这两格只改**取值**不做迁移 | → r4-P2-23 |
| 9 | **Step 3 / D2 租户自检口径统一**：由「登录租户 ≠ 单头 `tenant_account`」（类型不匹配）改为 A16 末段已写对的那条——**`run-summary.machines_online` 须含单头 `device_model` 那台机** | → r4-P2-24 |

---

## R4 核销台账

> 处置只有两种：**核销@节名**（提案已改）或 **REFUTED+证据**。本轮 **3 条 P1 + 4 条 P2 全部核销，0 条 REFUTE**。P1-2 的逐格核查过程中另外核出一个 v4 未察觉的同类缺陷（S4-c2 也是时限格），一并修在本版（§0 第 4 行）。

| id | 处置 |
|---|---|
| r4-P1-1（跨轮闸判据② 把 stale/废弃 run 也算成持锁者，一次 staging 中途重部署该 gp 永久瞎） | **核销@J2 判据② 改写 + §可见性时序表 T4 + D1 状态机 7 值 + Step 9 + A2 反向断言 + A15④**。finding 属实且我复核了它给的现成参照：`acceptance.js:174` `loadPendingRuns` 的 `status IN ('pending','in_review')` 正是「活跃」口径，直接沿用不另造。**修法上我比 finding 多做一步**：finding 只要求排除 stale，但同一个洞还有第二个入口——「员工开了单没填完就走」的 pending run 永远停在 `pending`，一样永久满足判据②，而 v4 全文没有任何 run 退出路径。故本版把 run 状态机一次补齐到 7 值（`pending`/`in_review`/`human_complete`/`adjudicated`/`stale`/`expired`/`abandoned`），并写死**这些是互斥的 status 值、不是 detail 旗标**——否则会长出「`status='in_review'` 且 `detail.stale=true`」这种两处真相的形态，判据又回到二义 |
| r4-P1-2（`scenario_not_triggered` 只校验静态属性，「场景这一轮到底有没有发生」仍由 AI 自报，6 格含 3 个 hard 红线格可单方滑进绿通道） | **核销@J20（新）+ §场景证据指针逐格台账 + 分类表第二行重写 + Q3″ 行 + Step 2/3/5 挂片与分支 + A4⑥⑦ + A17 + Gate B 第4/6条**。finding 的两条修复方向我**两条都取并合成双闸**（①员工现场勾选做人证 = 提交期闸；②人列确定判定做交叉证伪 = 合看期闸），理由是单取任一条都有窗口：只取① 则员工漏勾即放行；只取② 则 AI 提交时人列尚未填写（Step 3 早于 Step 4），当场无从校验，必须留到 `human_complete` 才重算。**服务端直查 staging 业务表这条路我核过后否决**：`packages/brain/src/zenithjoy-db.js:23-31` 那个 pool 在 `ZENITHJOY_DB_NAME` 未设时直接返回 Brain 主 pool，设了也是连 Brain 所在环境配置的那个库，**与 HK staging 的业务库不是一回事**，跨库通路未探明——按铁律不能把地基架在未探明的通路上，故本版全部证据指针只落**本地表（`acceptance_runs.detail` / `acceptance_checks`）**，跨库直查登记为将来升级路径（P2-23）。逐格核查见 §场景证据指针台账，3 个 hard 格结论各不相同，其中 **S13-c4 是真 fail-closed**：制造「被频控限制」场景等于故意违反 S12-c2 自己的频控红线（yaml 原文「同设备10分钟内最多发3条」），不可规定动作化 |
| r4-P1-3（复盘闭环主体二义；409 无逃生阀、未进出错路径表） | **核销@Step 7 重写 + D1/D4 + J2 判据④ + J16 开轮前置① + 出错路径表两行 + A15④⑤⑥⑦**。主体定为**发起人/主理人**（不是 finding 建议的员工）——但 finding 指出的风险是真的，所以不是简单选一边：若发起人可单方随时关，Step 7 就退化成自审橡皮图章。故配一道**前置闸**：`review-closed` 端点须满足「本轮全部人列提交人已 ack」**或**「距定案满 24 小时」，否则 403。这样员工的窗口由机械闸保住，而闭环动作本身握在发版路径上的人手里，不会变成 J15 当初否决候选 B 的那种「一坏就彻底堵死发版」。逃生阀按 finding 要求补齐：建单 409 时发起人可带 `force_reason` 强开，留痕落 `detail` 并计入 A12 棘轮 |
| r4-P2-21（P2 编号重复、条数不符） | **核销@P2 记账表**：第二条 P2-16（theater 闸 GP 段提取兜底）重编 **P2-21**；提案头与 §0 条数改 **24**（21 原有 + 3 新增） |
| r4-P2-22（J17 对照表 A/C 列口径不一致） | **核销@J17 对照表**：C 列拆成「AI 确定判定上限」与「常态确定判定」两行，常态 = 上限 − 3 个 `opportunistic` 场景格 = **13（基线）/ 16（切回）**；A 列 3 格口径不变。结论不翻（13 vs 3） |
| r4-P2-23（D1 说 `verifiable_by` 要从 cells-map 迁进 yaml，失实） | **核销@D1**：改为「`scenario_required` → 升级为 `scenario_class` 后从 `cells-map.mjs` 迁进 yaml；`verifiable_by` 已在 yaml（v5 复核：36 个建行格全带该字段，human_only 16 / machine_db 20），本项只按 §口径切换表改 4 格取值，不做迁移」 |
| r4-P2-24（Step 3 租户自检拿「租户」比「账号」，类型不匹配） | **核销@Step 3 分支 + D2 + A16**：统一为「`run-summary.json` 的 `machines_online` ≥ 1 且含单头 `device_model` 那台机」，不再比对租户字符串 |

---

## Gate A · 边界硬约束（fail-closed，能力层剥夺）

**AI 打表器只走 staging 后台网页，只读观察，一根火都不点：不碰真机、不发起采集、不发私信、不触达任何真实抖音/微信账号。**

v2 的四层被 r2-P0-2 击穿：四层剥的全是**带外**能力（宿主 ssh 逃逸、真机车道 label），而采证器的**带内**能力原样保留——`capture.mjs:152-163` 真的填关键词点「开始采集」，该动作经 `POST /api/acquisition/collect/start` 落 `acquisition_collect_tasks(agent_id)`，由绑在常驻验收租户下的真安卓 agent 领走用真抖音小号执行（凭据注释原文「绑真机租户，4台安卓在线」，`capture.mjs:13-15`）。allowlist 放行 `staging-autopilot.zenjoymedia.media` 恰恰放行的就是这条指挥通道本身。「零点火」是第①层，且它是**唯一一层需要动采证器代码**的：

| 层 | 落法 | 机械性 |
|---|---|---|
| **①带内通道剥夺（最重要）** | 采证器删除「发起采集」交互；`cells-map.mjs` 的 `action` 枚举去掉 `trigger_collect` 与 `signup_flow`，只剩 **`observe`** 一值，schema/单测强制。**受影响格数写死：`trigger_collect` 恰 1 格 = S6-c3**（v3 实测 `cells-map.mjs` 全表 20 格：signup_flow 1 / trigger_collect 1 / observe 18）。S6-c3 改为观察员工本轮已发起的任务记录（任务编号来自 run 单头，见 J17-C）。**v5 口径**：基线下时限三格（S4-c2/S7-c2/S9-c2）与 S13-c4 从 `cells-map.mjs` 移出（改由人列独判），采证器覆盖格 20→**16**；Gate B 第4条通过后三格加回并改成读时间戳（见 §口径切换表） | 机械（`action` 枚举单测 + 采证器全文 `grep -c '开始采集\|collect/start'` == 0，A11-e） |
| ②执行环境剥夺 | 打表器 job 固定 `runs-on: ubuntu-latest`（GitHub 托管），**禁止** `self-hosted` / `android-capable` label。手机池只经 self-hosted 车道可达（`nightly-android-fleet-pc4.yml:36,114`），托管 runner 够不着真机 | 机械（workflow 文件可 grep 断言，A11-a） |
| ③凭据剥夺 | 该 job 的 `secrets` 白名单 = `STAGING_ACCEPTANCE_EMAIL` / `STAGING_ACCEPTANCE_PASSWORD` / **`ACCEPTANCE_AI_TOKEN`**（只能写 AI 四列）。**`ACCEPTANCE_API_TOKEN` 移出白名单**（r2-P0-3：它能写人列并伪造 `submitted_by`）；**禁止** `TAILSCALE_AUTHKEY` / `HK_VPS_SSH_KEY` / 1Password token。判定任务跑 Brain docker 内（`executeInDocker`），不走 `executeOnHost` | 机械（smoke 解析 workflow yaml 断言白名单，A11-b） |
| ④网络 allowlist | Playwright `page.route('**', …)` 只放行 `staging-autopilot.zenjoymedia.media`，其余 host abort；`checkCellsMapComplete`（`capture.mjs:61-67`）保留，白名单外格号拒绝执行并写「无法验证」 | 机械（单测 A11-c） |
| ⑤产物约束 | 证据截图与文本快照走 CI artifact，**不 commit 进 repo**（现 `acceptance-spec/runs/*/ai-column.json` 含真实线索 PII）；结论只 POST 进 DB | 机械（`git ls-files` 断言，A2 出口8） |
| ⑥事后核对 | 断言 **A4**（基线 20 个 human_only 格恒「无法验证」）+ **A11**，兜底不作主防线 | 事后 |

**S12 全 4 格 + S13-c1/c3 等需安卓真机的格，AI 列恒为「无法验证」，不允许出现「通过」**——这是 Gate A 的设计输出。

## Gate B · 前置探明（开工第一件事，半天内出结论，不过则改道）

1. 5223 **公网可达性**（GitHub ubuntu runner 能否打通 gate 只读端点**与 AI 回写端点**）。两侧回落必须分开写——闸侧不通走 J7-B（Brain 定案时反向 push commit status）；**回写侧不通则 AI 列无处落库，两列制当轮只剩一列**，回落 = AI 回写改走「artifact + Brain 侧 docker 内判定任务读 artifact 后经内网 5221 落库」（判定任务本来就在 Brain docker 内，见 J3-B），仍**不得**把 runner 换成 self-hosted。本机实测 `https://brain-acceptance.zenjoymedia.media/acceptance/catalog` 返 401（隧道活着、鉴权墙在），大概率通得过。
2. gate 端点鉴权形态 → 已由 J19 定案为**独立只读 token**（`ACCEPTANCE_GATE_TOKEN`），此条转为「确认 Brain 生产容器能注入第三个 env」，并按 P2-19 确认三把钥匙**任一缺失只降级为该端点不挂载**、不得让整个 listener 起不来。
3. （← P2-5）**托管 runner 上真跑一次 capture 登录**：网络可达性有先例（`deploy-dashboard-staging.yml:37` 的 ubuntu-latest job 已在打公网 staging），但先例全是 `curl`，没有「托管 runner 数据中心 IP 上跑 headless chromium 完成 better-auth 登录」的实证（`deploy-lib.sh:505-513` 有 better-auth invalid origin 前科）。开工首日真跑一次，**不通则登记回落方案，且回落不得落回 self-hosted 真机车道**（会推翻 Gate A 第②层）。
4. **时限三格的事后可测性（v5 由两格扩到三格、两类页面）**：候选 C 之下 AI 在员工操作流结束约 40 分钟后才到场，`capture.mjs:168-185` 那套「自己触发起轮询计时」（`wait_budget_ms`）物理不可用，只能读页面时间戳算差值。逐格肉眼确认：
   - **S7-c2**（「5分钟内进入终态」）与 **S9-c2**（「3分钟内出判定结果」）→ 采集任务列表/详情页与判定结果页是否**同时**显示「创建时间」与「进入终态时间 / 判定出结果时间」；
   - **S4-c2**（「在约定时间窗内恢复在线」，v5 新增）→ 设备/账号页（`/area/acquisition/accounts`）是否显示设备的**掉线时刻与恢复上线时刻**（或等价的 `last_seen` 历史）。
   **三格分别判定，不捆绑**：通的格回 `machine_db`、采证器改读时间戳；不通的格维持基线 `human_only`，由员工在现场操作流里自己掐表。§口径切换表按「三格全通」写切回值；部分通则按实际格数逐项调整（切换表第 7 行给了逐格公式）。
5. **AI 采证账号与本轮客户账号的同租户可见性**：用 `ai-acceptance@zenithjoy.test` 登录 staging，确认它能看到**员工用本轮测试授权码绑机后**产生的设备/任务/私信记录。**判据用实体不用字符串（← r4-P2-24）**：`run-summary.json` 的 `machines_online` ≥ 1 **且**其中含单头 `device_model` 那台机。**通** → 把该租户写死为「验收专用租户」，建单页的「测试用客户账号」做成从该租户下拉选择（A16）；**不通** → 本 GP 停在这里升级给主理人：要么给验收开一个 AI 与员工共用的常驻租户，要么 J17 退回候选 B 重新拍板。
6. **（v5 新增，← r4-P1-2）S13-c4 的受控注入可行性**：确认 staging 是否有（或能否低成本加）一个把某条派单标记为「被频控限制」的受控开关，使红线8 的场景**不必靠真实触发频控**就能出现。**通** → S13-c4 的 `scenario_class` 由 `unverifiable_this_version` 升 `mandatory`，回 `machine_db`（human_only 20→19、machine_db 16→17、上限 16→17）；**不通** → 维持 fail-closed 处置（见 §场景证据指针台账），**不阻塞开工**，但该格「无裁决不得绿」的代价随本 GP 一起呈报主理人。

- 1/2/3/5 **全通** → 按 J7-A 开工。**1 闸侧不通** → J7-B；**1 回写侧不通** → 第 1 条的 artifact 回落。**3 不通** → 升级给主理人重新拍板 J17（AI 列取证路径本身没了）。**4 不通** → 口径维持基线，不阻塞开工。**5 不通** → **阻塞**，升级主理人。**6 不通** → 不阻塞，按 fail-closed 走。

---

## 场景证据指针台账（v5 新增，← r4-P1-2）

**要解决的问题**：v4 分类表第二行的判据是「该格 yaml `scenario_required == true` 且 AI 证据里无该场景」——前半是静态属性服务端能算，后半「场景这一轮到底有没有发生」不是静态属性，服务端算不出来，于是原样保留了「让被考核者自己定考卷」。6 格里有 3 个 hard 红线格（S5-c4/S10-c4/S13-c4），它们本该「唯一逃生阀是有名有姓的裁决」，却多了一个无名无姓、事后不可区分的出口。

**解法**：给每格登记一个**服务端可执行的场景证据指针**，并按指针的可得性把格分成三类（新增 yaml 静态属性 `scenario_class`）。

| `scenario_class` | 含义 | `scenario_not_triggered` 的合法性 | 证据指针 |
|---|---|---|---|
| **`mandatory`** | 场景由规程 `op` 强制，员工每轮必做，**场景恒发生** | **永不合法**（服务端一律 400） | 建单/收单期校验 `detail.scenarios_observed[]` 必含该场景码，缺则不许进 Step 3 |
| **`opportunistic`** | 场景靠现场运气，`op` 未强制 | 合法，但受**双闸** | 闸①：`detail.scenarios_observed[]` 含该场景码 → 400；闸②：`human_complete` 时若人列为确定判定 → 证伪 |
| **`unverifiable_this_version`** | 场景既不能规定动作化、也无受控注入手段 | 不适用（该格已摘出 AI 可判集合） | 无——fail-closed：转 `human_only`，且**该格最终态为绿必须经有名有姓的裁决** |

**两道闸的分工与为什么缺一不可**：
- **闸①（提交期人证）**——员工在 Step 2 现场跑完后于单头勾选本轮**实际出现的场景清单**（`scenarios_observed[]`，与 `tenant_account`/`collect_task_no` 同一批落 `acceptance_runs.detail`）。AI 在 Step 3 提交 `scenario_not_triggered` 时，服务端拿这份人证比对：场景明明勾了 → **400 拒收**，AI 必须给确定判定或故障类 reason。接缝由此从「AI 自报」变成「人证」。
- **闸②（合看期交叉证伪）**——闸① 挡不住「员工漏勾」。而人列本身就是场景发生与否的第二证据：员工若能对该格给出**确定判定（通过/不通过）**，说明他看见了场景。故在 run 达 `human_complete` 那一刻服务端**重算**：凡 AI 声明 `scenario_not_triggered` 而人列为确定判定的格，AI 的 reason 被服务端改写为 **`scenario_falsified`**，归**故障类**，该格落 **Q3″**（未定，拦闸，处置=裁决而非重跑）。
- **为什么不能只留闸②**：AI 在 Step 3 提交时人列还没填（Step 4 才填），当场无从校验，必须留到 `human_complete` 重算——而闸① 能在提交期就拒收，早一步且省一轮。两闸时机不同，覆盖的漏法也不同。
- **为什么不做服务端直查 staging 业务表**（reviewer 与 controller 都提到的那条路）：`packages/brain/src/zenithjoy-db.js:23-31` 的 pool 在 `ZENITHJOY_DB_NAME` 未设时**直接返回 Brain 主 pool**，设了也只是连 Brain 所在环境配置的那个 zenithjoy 库，**与 HK staging 的业务库不是一回事**；Brain 能不能读 staging 库未探明。按铁律不把地基架在未探明的通路上，本版全部指针只落**本地表**。跨库直查登记为将来升级路径（P2-23）——打通后 `opportunistic` 格的闸① 可由人证升级为直查，`unverifiable_this_version` 格亦可能翻身。

### 6 个 `scenario_required` 格逐格核（3 个 hard 格优先）

| 格 | hard | 场景是什么 | 核查结论 | `scenario_class` | 口径影响 |
|---|---|---|---|---|---|
| **S4-c2** | 否 | 冷启动/重启手机后恢复在线 | yaml S4 `op` 原文「**冷启动客户端一次；重启手机一次，观察恢复**」——**规定动作，每轮必做**，AI 声明「无该场景」是可证伪的假话。从 `scenario_required` **摘除** | `mandatory` | 但顺手核出**另一个缺陷**：该格 `t` 原文「在**约定时间窗内**恢复在线」是**时限判据**，与 S7-c2/S9-c2 同类——候选 C 下 AI 迟到 40 分钟无法观测恢复过程，只能读页面时间戳。按 fail-closed 与那两格**同批摘出 AI 可判集合**（转 `human_only`），Gate B 第4条一并实测 |
| **S4-c3** | 否 | 「已知设备对照」 | 对照物 = 单头 `device_model`/`client_no`，A16① 已断言建单期五项非空、**恒存在**。指针 = 查 `acceptance_runs.detail`（本地表，零新通路）。场景恒满足 → 从 `scenario_required` **摘除** | `mandatory` | 留在 `machine_db` 常态可判集合——**收紧**：该格从「可滑进 Q3 绿通道」变成「AI 必须给确定判定」 |
| **S5-c3** | 否 | 本轮有测试小号掉线 | yaml S5 `op`「手机登录2到3个测试小号，触发一次账号扫描」**不含**制造掉线 → 偶发。员工手上就是测试小号，掉没掉线他知道，可勾；人列亦可交叉证伪 | `opportunistic`（**建议**把 S5 `op` 加一句「手动让其中一个小号退出登录/断网，制造一次掉线」→ 升 `mandatory`，见 J20 呈批项） | 留在 `machine_db`，受双闸 |
| **S5-c4** | **是** | 同 S5-c3（掉线小号） | 与 S5-c3 同场景同批。双闸可执行 → **hard 格保护不降级** | `opportunistic`（同上，随 S5 `op` 加厚升 `mandatory`） | 留在 `machine_db`，受双闸 |
| **S10-c4** | **是** | 两轮数据覆盖对照（红线11：旧评论不得覆盖新的） | 需同一目标有两轮采集数据；单轮规程下**常态不触发**。员工可勾（他知道自己跑了几次采集），人列可交叉证伪 → 双闸可执行 | `opportunistic`（**建议**把 S10 `op` 加一句「用同一关键词再发起一次采集，对照同一视频评论是否被覆盖」→ 升 `mandatory`；代价 = 仪式跨度再加约 8 分钟，见 P2-24） | 留在 `machine_db`，受双闸。**加厚前的诚实后果**：本轮无覆盖场景时，员工诚实填「无法验证」→ Q9 双盲 → 拦；员工填确定判定 → 闸② 证伪 AI → Q3″ → 拦。**两条路都拦**，红线11 不会被静默放行，但也确实每轮需要一次处置——这正是把 `op` 加厚的理由 |
| **S13-c4** | **是** | 频控限制被真实触发（红线8：「被限制」不得显示成「已私信」） | **真 fail-closed**：制造该场景 = 故意超频发送，而 yaml **S12-c2 原文「同设备10分钟内最多发3条；关注每小时不超10次、点赞不超15次」本身就是一条验收判据**——为验红线8 去违反 S12-c2，等于用一条红线换另一条，且消耗真实抖音风控额度、有封号风险。不可规定动作化；服务端亦无本地指针 | `unverifiable_this_version`（Gate B 第6条若探明受控注入可行则升 `mandatory`） | **摘出 AI 可判集合**（转 `human_only`），且**摘出 Q3 绿通道**：该格最终态为绿**必须经有名有姓的裁决**（计入 A12 棘轮）。代价明示：本版对红线8 的双列保护退化为「员工单列判 + 必要时裁决」 |

**摘除/保留计数核对**：6 格 → `mandatory` 摘除 2（S4-c2、S4-c3）、`opportunistic` 保留 3（S5-c3、S5-c4、S10-c4）、`unverifiable_this_version` 1（S13-c4）。合法 `scenario_not_triggered` 的格集合由 6 收窄到 **3**，且这 3 格全部受双闸。3 个 hard 格里 2 个（S5-c4、S10-c4）保住双列保护，1 个（S13-c4）以「无裁决不得绿」兜底并呈报。

---

## 两列九组合裁决矩阵（决策①③⑥的机械口径）

人列枚举 `通过/不通过/无法验证` 是 DB 强约束（`369_acceptance_tables.sql:25`），AI 列复用同一套枚举（J6）。两列各含「未填/未跑」的空态，故实为 4×4，空态统一归 **Q0**。**矩阵仍是三态——「不适用」不是终态而是「不建行」**（J10/J18）。

### 「无法验证」的机械分类（判据 = 格的静态属性 + 场景证据指针，不是 AI 自报）

**下表按 v5 基线口径写；Gate B 第4条通过后按 §口径切换表 整表切回。**

| 分类 | 判据（**服务端算**，AI 自报 reason 只作补充说明） | 享受 Q3 绿通道 |
|---|---|---|
| **合法 · human_only** | 该格 yaml `verifiable_by == 'human_only'`（基线 **20** 格 = yaml 原 16 + 时限三格 S4-c2/S7-c2/S9-c2 + S13-c4） | 是（**S13-c4 除外**：`scenario_class=unverifiable_this_version`，绿必须经裁决） |
| **合法 · scenario_not_triggered** | 该格 `scenario_class == 'opportunistic'`（**3 格**：S5-c3/S5-c4/S10-c4）**且**闸①（`detail.scenarios_observed[]` 不含该场景码）**且**闸②（`human_complete` 时人列非确定判定）双双成立 | 是 |
| **故障** | 其余全部——即 `machine_db` 且非 `opportunistic` 的格（基线 **13** 格）的任何「无法验证」，无论 AI 写什么 reason；**外加**被闸② 证伪的 `scenario_falsified` | **否** |

**机械化落点**：`POST /acceptance/ai-results` 服务端校验——
- `reason='human_only'` 而该格 yaml 不是 `human_only` → **400 拒收**；
- `reason='scenario_not_triggered'` 而该格 `scenario_class ≠ 'opportunistic'` → **400 拒收**（含 `mandatory` 格与已摘除的格）；
- `reason='scenario_not_triggered'` 而 `detail.scenarios_observed[]` **含**该格场景码 → **400 拒收**（闸①）；
- 故障类 reason（`page_unreachable`/`login_failed`/`timeout`）任何格都可提交，但一律不进绿通道。
- `human_complete` 触发时服务端重算：`reason='scenario_not_triggered'` 且人列 ∈ (通过,不通过) → reason 改写 `scenario_falsified`、归故障类、该格落 **Q3″**（闸②）。

### AI 可判集合口径切换表（v5 重算）

**为什么要切换而不是直接写死**：三个**时限格**（S4-c2「约定时间窗内恢复在线」、S7-c2「5分钟内进入终态」、S9-c2「3分钟内出判定结果」）原本靠采证器自己点火后轮询计时（`cells-map.mjs` 的 `wait_budget_ms`，`capture.mjs:168-185`）。候选 C 让 AI 在员工操作流结束**约 40 分钟后**才到场，这套计法物理失效，AI 只能读页面时间戳算差值——**而页面是否显示所需时间戳未探明**。按 fail-closed，未探明即先摘除。S13-c4 的摘除理由不同（场景不可制造，见台账），但同样先摘。

| 口径 | 触发条件 | human_only | machine_db | `opportunistic` | 故障类 | AI 确定判定上限 | 哑火分母/阈值 |
|---|---|---|---|---|---|---|---|
| **基线（v5 默认）** | Gate B 第4条未跑或不通 | **20** | **16** | 3 | **13** | **16** | 16 / ≥8 |
| **切回** | Gate B 第4条三格全通 | 17 | 19 | 3 | 16 | 19 | 19 / ≥10 |

**切换是一次性整表操作，受影响的位置全部登记在此，改口径必须同批改完**：

| # | 位置 | 基线值 → 切回值 |
|---|---|---|
| 1 | 规程 yaml：S4-c2 / S7-c2 / S9-c2 的 `verifiable_by` | `human_only` → `machine_db` |
| 2 | §无法验证的机械分类表 三行格数 | 20 / 3 / 13 → 17 / 3 / 16 |
| 3 | §熔断与哑火判据 条件二的分母与阈值 | 16 格中故障类 ≥8 → 19 格中 ≥10 |
| 4 | A4① 的 `:human_only_list` 与 A4② 的上限 | 20 格 / `<= 16` → 17 格 / `<= 19` |
| 5 | J17 对照表 C 列（上限 / 常态两行） | 16 / 13 → 19 / 16 |
| 6 | D2 采证器：三格的取数方式 | 不采（`human_only` 恒判无法验证） → 读页面创建/终态/上线时间戳算差值 |
| 7 | **逐格公式（Gate B 第4条部分通过时用）** | 设三格中通过 *k* 格（k∈0..3）：human_only = 20−k，machine_db = 16+k，故障类 = 13+k，上限 = 16+k，哑火阈值 = ⌈(16+k)/2⌉ |
| 8 | 出错路径表「AI 列不完整」文案分母 | 恒为 **36**（AI 须对全部建行格回写，不随口径变） |

> **两个口径下 36 格总数、8 个 hard 格、J1-D 的分母都不变**——切换只在 `human_only ↔ machine_db` 之间搬三格，不影响闸的语义。
> **S13-c4 不参与本切换**（它的开关是 Gate B 第6条，不是第4条）。若第6条也通，在上表基础上再 human_only −1 / machine_db +1 / `opportunistic` +1 / 上限 +1。
> **摘除不等于放弃这些格**：它们仍在 36 格分母里，只是改由员工在现场操作流里判（人列独判，AI 列恒「无法验证-human_only」）。红线本身没丢；S13-c4 更进一步要求「绿必须经裁决」。

### 九组合表

| 组合 | 人列 | AI 列 | 名称 | 最终态 | 一般格动作 | hard 红线格闸判据 |
|---|---|---|---|---|---|---|
| Q1 | 通过 | 通过 | 双绿 | **绿** | 无 | 放行（唯一无需裁决的绿） |
| Q2 | 通过 | 不通过 | 分歧（AI 红人绿） | 未定 | 必须裁决 | **拦**，除非裁决绿 |
| Q3 | 通过 | 合法无法验证 | 仅人列绿 | **绿** | 无 | 放行（human_only / 场景合法未触发的正常绿路径）。**例外：`scenario_class=unverifiable_this_version` 的格（S13-c4）不走此通道，绿必须经裁决** |
| Q3′ | 通过 | 故障无法验证 | 人绿·AI 哑火 | 未定 | 重跑打表器；重跑仍哑火→裁决 | **拦** |
| **Q3″**（v5 新增，← r4-P1-2） | 通过/不通过 | `scenario_not_triggered` **被闸② 证伪** | 人绿·AI 场景声明被证伪 | 未定 | **直接裁决，不重跑**（场景已过，重跑取不回来）；并记一次「AI 场景采证失准」计数 | **拦** |
| Q4 | 不通过 | 通过 | 分歧（AI 绿人红） | 未定 | 追查任务（优先信人） | **拦**，除非裁决绿 |
| Q5 | 不通过 | 不通过 | 双红 | **红** | bug 任务 | **拦**（裁决绿需写补偿措施并自动开 P0） |
| Q6 | 不通过 | 无法验证 | 人红独判 | **红** | bug 任务 | **拦** |
| Q7 | 无法验证 | 通过 | 人未验·AI 绿 | 未定 | 追查任务（为什么人验不了） | **拦** |
| Q8 | 无法验证 | 不通过 | 人未验·AI 红 | **红** | bug 任务 | **拦** |
| Q9 | 无法验证 | 无法验证 | 双盲 | 未定 | 「补验证手段」任务 | **拦** |
| Q0 | 未填 | 任意 | 不完整 | 未定 | Step 5 不解锁 | **拦**（run 到不了 `human_complete`） |
| Q0′ | 任意 | 未跑 | AI 列缺格 | **未定** | 单独重跑打表器补格；且**整轮**标 `ai_incomplete`（见哑火判据条件三） | **拦**（缺格视同未拿到确定绿） |

> **Q3″ 为什么单列一行而不并进 Q3′**：两者最终态相同（未定/拦），但**处置相反**——Q3′ 是打表器坏了，重跑能救；Q3″ 是场景确实发生了而 AI 说没发生，重跑取不回已经过去的场景，只能裁决。若并成一行，实现者会对 Q3″ 也走「重跑」分支，每轮多烧一次采证还是同样结果，最后必被人手改成放行。**机械可区分**：服务端在 `human_complete` 重算时把 reason 写死为 `scenario_falsified`，与 `page_unreachable`/`timeout` 等故障 reason 不同值。
> **Q0′ 为什么是「未定」**（承 r3-P1-2）：v3 的 Q0′ 与闸判据「缺格一律拦」正面矛盾，宽松读法是一个**静默放行口**——缺格行 `ai_verdict` 为 NULL，既不落进「确定判定 == 0」也不落进「故障类 ≥ 阈值」，于是 AI 只要回写 8 个 hard 格加少数几格、其余不提交，就既躲开哑火识别、又让那些格靠员工一列判绿。改「未定」后闸口径唯一；再配哑火判据条件三，「AI 少回写」这件事本身也被识别成 infra 故障。

**闸判据**：
> 一格的最终态为**绿**，当且仅当它落在 Q1、Q3（`unverifiable_this_version` 格除外），或经主理人裁决 `verdict='绿'`。其余（红、未定、缺格、空态）一律**拦**。
> **分母 = 36 个建行格**（J10）。8 个 hard 红线格（S2-c4/S5-c4/S6-c4/S8-c4/S10-c4/S11-c4/S12-c4/S13-c4，v5 复核 yaml `hard: true` 逐个相等，全部落在步骤 1-13）不可被任何 `bypass` 豁免；hard 格唯一逃生阀是**有名有姓的裁决**（记裁决人/理由/时间，计入棘轮 A12）。

**`passed` 不再是放行判据**：现行 `status = pending>0?'in_review':fail>0?'failed':pass===total?'passed':'in_review'`（`acceptance.js:88`）里只要有一格「无法验证」，`pass===total` 永假 → `passed` 物理不可达。D1 改为新状态机。

### 熔断与哑火判据

**AI 必须对全部 36 个建行格回写**（human_only 格回写「无法验证」+ `reason='human_only'`，见 A4①），所以「某格 `ai_verdict IS NULL`」= 打表器没跑到这格，是**故障信号**，不是正常态。

| 情形 | 机械判据（三条**任一**成立即哑火） | 处置 |
|---|---|---|
| **AI 整轮哑火** | **①** 本轮 AI「确定判定」（`ai_verdict ∈ (通过,不通过)`）格数 **== 0**；**②** 基线 16 个 `machine_db` 格中**故障类**无法验证 **≥ 8**（半数；切回口径 19 格中 ≥10）；**③** 本轮 **缺格数 > 0**（`SELECT count(*) … WHERE run_id=:rid AND ai_verdict IS NULL` ≠ 0） | run 标 `ai_incomplete` + `ai_status='dumb'`；**不建** bug/trace 任务、**不进**熔断；单开 1 个 P0「AI 打表器整轮哑火」（描述含缺格格号清单）；**闸对 `ai_incomplete` 一律拦**（走 `ai_run_infra_error` 路径，与「格红」机械可区分，见 J15）|
| **熔断（规程/数据源疑似分叉）** | 在 AI 未哑火的前提下，**非绿格（`final_state ∈ {红, 未定}`）占 36 的比例 > 1/3** | 不建 36 个散任务，改开 1 个 P0「规程/数据源疑似分叉」 |
| **常规分流** | 未哑火且未熔断 | 每 run ≤1 bug 任务 + ≤1 追查任务（A7） |

> **`scenario_falsified` 不计入哑火**（v5 明确）：它不是 infra 故障，是 AI 该格采证方法判断失准，与「登录挂了/页面打不开」形态不同，混进哑火分子会让真故障被稀释。单独计数，实现期建议对「同一格近 N 轮反复被证伪」开 P0（已记 P2-22）。
> **条件三为什么定在「>0」而不是「> N」**：任何 N>0 的门槛都留出一个「少回写 N 格且不被发现」的窗口，而这 N 格恰好可以是坏掉的采证器挑出来的那几格。回写全 36 格对 AI 侧零额外成本（human_only 格本来就要回写「无法验证」），门槛定 0 不会误伤。
> **补跑路径**：`ai_incomplete` 不是终态——单独重跑打表器补齐缺格后重算，缺格数归 0 且条件①② 不成立即摘掉 `ai_incomplete`，闸重新可绿。

---

## AI 列可见性时序表

裁剪**不是逐端点打补丁**，而是在 `loadChecks`（`acceptance.js:151`）/`loadRunsWithChecks`（`:155-171`）的 SQL 层做**列白名单**：AI 四列（`ai_verdict`/`ai_evidence`/`ai_run_at`/`adjudication`）默认不 SELECT。

**裁剪判据（写死）**：

1. **逐行判定，不是响应级**——一行是否带 AI 四列，看**该行所属 run** 的状态（`loadRunsWithChecks` 是多 run 响应，响应级判据无解）。
2. **gp 级防跨轮锚定闸（v5 收窄，← r4-P1-1）**——若该 `gp_id` 下存在**任一活跃 run**，则该 gp 的**全部轮次**（含已定案的历史轮）AI 四列与 `adjudication` 一并隐藏。
   - **「活跃 run」的机械定义**：`status IN ('pending','in_review')`。现成参照 `acceptance.js:174` `loadPendingRuns` 用的正是这个谓词，直接沿用不另造。
   - **`stale` / `expired` / `abandoned` / `adjudicated` / `human_complete` 一律不是持锁者**——它们都到不了、或已经越过 `human_complete`，把它们算进来就是永久锁死（r4-P1-1 的原形态）。
   - **stale run 自己的可见性遵循它定案前的状态**：它从未达 `human_complete`（人列没提交完），故**它自己的 AI 四列仍隐藏**；但它**不阻塞**同 gp 其他轮次的可见性。两件事分开写，不要混成一条。
   - **状态互斥写死**：`stale`/`expired`/`abandoned` 是 `status` 的**取值**，不是 `detail` 旗标。禁止出现「`status='in_review'` 且 `detail.stale=true`」这种两处真相的形态，否则判据又回到二义（D1 的 CHECK 约束承载这一条）。
3. **合看态**需显式 `?view=review` 且服务端校验该 run 已达 `human_complete`（Staff Hub 员工身份亦可，见 Step 7）。
4. **复盘窗口 = T4 到下一轮 T0 之间，且开新轮以复盘闭环为前置**——同 gp 的**最近一个** `adjudicated` run 若 `detail.review_closed_at` 为空，则**拒绝**为该 gp 建新 run（HTTP 409，提示「上一轮复盘未闭环」）。**逃生阀（v5 新增，← r4-P1-3）**：发起人可在建单请求带 `force_reason`（非空且 ≥20 字）强开新轮，服务端放行并把 `force_reason`/`force_opened_by`/`force_opened_at` 落新 run 的 `detail`、把上一轮标 `review_force_closed=true`（与正常 `review_closed_at` 机械可区分），计入 A12 棘轮。

| 时刻 | run 状态 | 员工看得到 AI 四列 / adjudication？ | 依据 |
|---|---|---|---|
| T0 建单 | `pending` | 否 | 判据 2（本 run 是活跃 run） |
| T1 员工操作流 + 填表期 | `pending`/`in_review` | 否（含全部历史轮） | 判据 2 —— 决策② 防锚定的**唯一**硬窗口 |
| T2 最后一格提交 | `human_complete` | **是**（本轮 + 历史轮同时解锁） | 判据 1+3 |
| T3 主理人裁决中 | `human_complete` | 是（AI 列可见，`adjudication` 逐格随裁决落库而出现） | 判据 1 |
| T4 定案 → 复盘窗口 | `adjudicated` | **是——前提：该 gp 下不存在活跃 run**（`status IN ('pending','in_review')`）。同 gp 存在 `stale`/`expired`/`abandoned` run **不影响**本窗口。窗口从定案起，到该 gp 下一轮建单为止；判据 4 保证窗口不会被下一轮抢先关掉 | Step 7 = 决策③ 的要求 + 判据 2/4 |

> **冲突消解**：决策③ 要求员工在裁决后看得到裁决理由（Step 7），而防锚定只须约束「**本轮人列提交前**」这一段（T1）。v2 的 A2 把 `adjudication` 无条件列进禁止集，才与 Step 7 打架；v3 用时序表把两者分到 T1 / T2+ 两段；v4 用判据 4 把复盘挤进「定案后、开新轮前」的窗口解掉跨轮维度的互斥；**v5 补掉最后一个洞**——判据 2 原本按「未达 `human_complete`」写，而 `stale` 是与 `human_complete` 平级的另一个终态、永远达不到 `human_complete`，一次 staging 中途重部署（J16/P2-6 实测：`deploy-staging-hk.yml:14-20` 在 `apps/api/**` push 到 main 即自动部署、近 14 天 22 次提交，本 GP 把「中途被重部署」当预期常态并专门设计了 stale 兜底）就会让该 gp 的 AI 四列与裁决理由**永久隐藏**，而闸侧走 D5 gate 端点只取 `gate_verdict`/`red_cells` 不受影响——故障形态是「闸照常跑、人看不见」，静默且不可恢复。收窄成「活跃 run」后此形态消失。
> **为什么不给已定案轮的 `adjudication` 开跨轮可见例外**：裁决理由几乎必然引用 AI 证据（「AI 截图显示任务已终态，故推翻人列的不通过」），要论证它「不携带本轮 AI 判定信息」做不成；而格号跨轮同名（J5-A），上一轮同格的裁决理由对本轮就是直接锚定。防锚定强度优先。

### AI 列出口清单（防锚定裁剪的完整靶面）

| # | 出口 | 现状（实测） | 处置 |
|---|---|---|---|
| 1 | 内网 5221 `GET /acceptance/pending` | `:303`→`loadPendingRuns`→`SELECT *` | 列白名单 |
| 2 | 内网 5221 `GET /acceptance/runs?gp_id=` | `:264-274`，不过滤 status，一次返回该 GP 全部 run 全量 checks | 列白名单 + **gp 级闸**（判据 2） |
| 3 | 内网 5221 `GET /acceptance/runs/:run_key` | `:277-289`→`loadChecks`→`SELECT *` | 列白名单 + 默认态=员工态 |
| 4 | 公网 5223 `GET /acceptance/pending` | `:332-340`，与内网共用 loader | **本期下线**（J19，Notion Worker 已停摆无消费者） |
| 5 | 公网 5223 `GET /acceptance/catalog` | `:317-330`，只回 catalog 不含 checks | 保留，登记，无需改 |
| 6 | Staff Hub 反代 `/api/staff/acceptance/*` | `services/acceptance.ts:52` 整数组直出 → `staff.ts:319` 整包展开 | 反代层同步白名单（双保险） |
| 7 | 新增的 gate 只读端点（D5） | 不存在 | 只回 `{run_key, backend_sha, frontend_sha, spec_sha, status, gate_verdict, red_cells[]}`，**不回 AI 列原文**；独立 `ACCEPTANCE_GATE_TOKEN` |
| 8 | repo 内 `acceptance-spec/runs/*/ai-column.json` | 两轮历史产物已在 git 里，员工 clone 即可见 | 本期起不再 commit（Gate A 第⑤层） |
| 9 | psql 直查 | 员工无 DB 账号（Staff Hub 走飞书白名单身份，`middleware/staff.ts:44`） | 登记为组织约束，不做代码闸 |

---

## Golden Path 步骤

主体：**发版人 / 验收员工 / 主理人**。步骤名写「他感知到什么」，工序细节全部下沉到【挂片】【分支/判定点】。共 9 步。

| 步骤（承诺） | 现状 | 验证等级承诺 | 【挂片】 | 【分支/判定点】 |
|---|---|---|---|---|
| **Step 1** 发版人发起这一轮验收后，员工当天在待办里就看到一张属于这个构建的单子，单头写着它验的是哪个构建（前后端各一个 sha）、哪一版规程 | **半成** | L2（服务端真验） | run 建单端点幂等(已有，`acceptance.js:183`)／**36** 有效格从规程展开成行(**缺失**)／每格 `kind` 来源(**缺失**，yaml 全文零个 kind 字样，J14)／`backend_sha` + `frontend_sha` 双源对账写进单头(**缺失**；后端源② `deploy-staging-hk.yml:42` 已 pin `github.sha` **可直接用**，前端 `deploy-dashboard-staging.yml:57` 仍 `reset --hard origin/main` **需改 pin**)／规程版本锁 `version`+`spec_sha`(**半成**，`acceptance_runs.version` 列已有但没人写)／侧边栏待办角标(**缺失**，`App.tsx:46-48` 是纯文本 NavLink)／仪式发起通知(**缺失**) | 分支：同构建已有 run → 幂等复用不重开；任一源两两不等 → **拒绝建单**并告警；同 gp 最近一个 `adjudicated` run 的 `detail.review_closed_at` 为空 → 拒绝建单 **409**「上一轮复盘未闭环」，**（v5 新增 ← r4-P1-3）除非请求带 `force_reason`（非空 ≥20 字）→ 放行并留痕、计入棘轮**；单头「测试用客户账号」不属于验收专用租户 → 拒绝建单。判定点 **J5**（格号）／**J10**（排除集）／**J12**（冻结锁与双源）／**J14**（kind）／**J16**（仪式）／**J2 判据4**（复盘窗口与逃生阀）／**J17 前提①**（同租户） |
| **Step 2** 员工先把这一轮的现场跑完——真机装绑、发起采集、走到私信——单头上留下这一轮用的是哪个客户账号、任务编号和暗号，**还有这一轮现场实际出现了哪些场景**，后面所有证据都对得上这一轮 | **半成** | **L3（真机真验）** | 规程 op 序列(**已有**，yaml 14 步 op 字段)／现役网页的单头字段(**已有**，`lib.mjs:292-299` 有 测试日期/测试人/**测试用客户账号**(`:297`，`data-f=tenant`)/手机型号/客户端编号/本轮采集任务编号/本轮暗号)／这些字段落进 `acceptance_runs.detail`(**缺失**)／**本轮场景清单勾选 `detail.scenarios_observed[]`**(**缺失**，v5 新增 ← r4-P1-2；场景码与 `scenario_class` 同源于 yaml)／「测试用客户账号」= 验收专用租户的机械校验(**缺失**)／录屏与截图证据规范(**已有**，`lib.mjs:370-372`) | 分支：员工现场跑不通（真机掉线/装不上）→ 本轮直接标 `stale` 重开，不进 AI 采证；员工用了非验收专用租户的授权码 → 建单期即被拒（A16），不允许跑到 Step 3 才发现；**（v5 新增）`mandatory` 场景码未勾齐 → 不允许推进到 Step 3**（规定动作没做完，AI 采证跑了也白跑）。判定点 **J17**（仪式两段式、点火边界与两条前提）／**J20**（场景判据来源）／**J16**（工时） |
| **Step 3** 员工坐下来判之前，AI 已经把它能在网页上看见的那部分先看过一遍；它一根火都不点，看不见的老实说看不见，还说得出为什么看不见——**而这个「为什么」要拿得出证据，不是它说了算** | **半成** | **L3（真环境真验）** | 采证器走真 staging UI + 截图 + `innerText`(**已有且有 2 轮真实产物**，`capture.mjs:32,54-57`)／常驻登录凭据(已有，1Password CS)／自动触发(**缺失**，全仓无 workflow/npm script，`capture.mjs:236` 硬编码 `trigger:'manual'`)／**删除「发起采集」交互、`action` 枚举收敛为单值 `observe`**(**缺失**，现 `capture.mjs:152-163` 真点「开始采集」)／按单头任务编号定位本轮任务(**缺失**)／结论回写 `POST /acceptance/ai-results`(**缺失**)／reason 与静态属性的服务端校验(**缺失**)／**`scenario_not_triggered` 的闸①（比对 `detail.scenarios_observed[]`）**(**缺失**，v5 新增)／**开跑前自检「`run-summary.machines_online` 含单头 `device_model` 那台机」**(**缺失**，v5 口径修正 ← r4-P2-24)／**时限三格按口径取数**(基线不采；Gate B 第4条通过后改读页面时间戳算差值)／**对全部 36 建行格回写、零缺格**(**缺失**)／Gate A 六层(**缺失**) | 分支：某格页面打不开 → 记 `page_unreachable`（**故障类**，不享受 Q3 绿通道），不中断整轮；**自检看不到单头那台机 → 整轮直接标 `ai_incomplete` 并告警退出**，禁止继续跑成一堆「无法验证」（否则依赖本轮采集数据的格会被判成故障类、触发哑火，看起来像打表器坏了，实则是租户/绑机配错，两种故障必须可区分）；**（v5 新增）提交 `scenario_not_triggered` 而该格 `scenario_class ≠ opportunistic`、或员工已勾该场景 → 400 拒收**。判定点 **J3**（执行体）／**J4**（诚实边界）／**J20**（场景判据来源）／**J17**（点火边界与前提）／**J19**（回写凭据） |
| **Step 4** 员工打开验收页，看到的还是那张熟悉的表；AI 那一列此刻对他根本不存在，翻 F12、换端点、走公网、翻上一轮的历史单都翻不出来 | **半成** | L2（服务端真验） | 三个页面(**已有**，路由 `App.tsx:66-68`)／分批草稿增量提交(已有)／`submitted_by` 防伪注入(**已有且有测试**，`middleware/staff.ts:44`→`staff.ts:338`)／**服务端列裁剪(完全缺失**，三跳全裸：`acceptance.js:155-171` `SELECT *` → `services/acceptance.ts:52` → `staff.ts:319`)／**gp 级跨轮闸（判据 2，按「活跃 run」口径）**(**缺失**，`验收历史` 入口已存在 `App.tsx:49-51`)／9 条出口逐条覆盖(**缺失**)／第三态措辞统一为「无法验证」(**Staff Hub 已是**，`AcceptanceDetailPage.tsx:141-143`；**现役 generated HTML 仍是「不适用」**，`lib.mjs:430`) | 分支：员工只填一半离开 → 草稿按子集留存（既有）；**（v5 新增 ← r4-P1-1）员工开了单长期不填 → run 超 48h 未达 `human_complete` 自动转 `expired`，不再算活跃 run、不再锁住该 gp 的可见性**；发起人亦可显式作废转 `abandoned`（留痕 `detail.abandoned_reason/by/at`）。判定点 **J2**（可见时机与时序表）／**J6**（存储形态与裁剪位置）／**J18**（现役网页处置） |
| **Step 5** 员工把最后一格交上去的那一刻，两列一起亮出来，哪些一致、哪些打架、哪些两边都没验成，一眼看清 | **缺失** | **L3（真浏览器真页面截图）** | 九组合矩阵合看页(**缺失**，全仓 grep「对比页\|四象限」非 md 零命中)／`human_complete` 解锁态(**缺失**)／AI 缺格降级态(**缺失**)／**闸②：`human_complete` 触发时服务端重算 `scenario_not_triggered` 与人列的交叉证伪**(**缺失**，v5 新增 ← r4-P1-2)／需真机/需场景的格在填表页提前标出(**缺失**，`device` 列已有已渲染，`scenario_class` 需从 `cells-map.mjs` 迁进 yaml)／fixedNa 步骤渲染为灰带「固定不适用（本版未做）」(**缺失**) | 分支：AI 列缺格 → **Q0′ 恒判「未定」并拦**，合看页把缺格标成「AI 未回写」并显示整轮 `ai_incomplete` 横幅与补跑入口；**（v5 新增）AI 场景声明被人列证伪 → 该格落 Q3″，合看页标「AI 说没场景，但你判了——请裁决」并直通裁决入口（不给重跑按钮）**。判定点 **J1**（放行分母）／**J20**（闸②）／**J8**（这页从哪打得开） |
| **Step 6** 打架和没验成的格子主理人当场拍板；拍完这一版验收就有了定论，定论跟着两个构建号和规程版本一起存档 | **缺失** | L2（服务端真验） | `adjudication` 字段与裁决 API(**缺失**，`\d acceptance_checks` 无此列)／裁决人与理由留痕(**缺失**)／run 状态机 `adjudicated` 与 `gate_verdict`(**缺失**，`369_acceptance_tables.sql:11` 只许 4 值)／hard 格裁决绿自动开 P0(**缺失**)／**`unverifiable_this_version` 格（S13-c4）绿必经裁决的强校验**(**缺失**，v5 新增) | 分支：Q5/Q6/Q8 → bug 任务；Q4/Q7 → 追查任务；Q9 → 补验证手段任务；**Q3″ → 直接裁决（不重跑）**；非绿格占比 >1/3 → 熔断；AI 整轮哑火 → 走 `ai_run_infra_error` 不进熔断。判定点 **J1**／**J15**／**J20** |
| **Step 7** 员工回到同一页，能看到主理人怎么判的、为什么这么判——尤其是自己判红被推翻的那几格；有话要说就在这一轮结束前说完，**而且这一轮不会在他看过之前被人悄悄关掉** | **缺失** | L2（服务端真验） | 员工身份的裁决回显视图(**缺失**)／裁决理由对员工可见的权限口径(**缺失**，时序表 T2 起开放)／**员工侧「我已看过裁决」ack 按钮与异议 note**(**缺失**，v5 改 ← r4-P1-3)／**发起人/主理人侧「关闭复盘」按钮写 `detail.review_closed_at`+`review_closed_by`**(**缺失**)／**防橡皮图章前置闸**(**缺失**，v5 新增)／开新轮前置校验(**缺失**，落在 Step 1 建单端点) | **（v5 重写 ← r4-P1-3）执行主体写死**：「关闭复盘」**只有发起人或主理人**能点（员工打该端点 → **403**）；员工侧只有「我已看过裁决」ack 与异议 note（不阻塞本轮定案）。**防橡皮图章闸**：`review-closed` 端点前置校验「本轮全部人列提交人（`submitted_by` distinct 集合）均已 ack」**或**「距 `adjudicated_at` 已满 **24 小时**」，两者皆不满足 → **403**（响应写明还差谁 ack / 还需等多久）。分支：员工有异议 → 在该格追加 note，走下一轮或即时升级；**发版被这道 409 卡住且等不起** → 发起人带 `force_reason` 强开（Step 1 逃生阀），上一轮标 `review_force_closed` 并计入棘轮。判定点 **J2**（判据 4 与逃生阀）／**J16**（仪式前置） |
| **Step 8** 发版人点 promote 的时候，如果这一版的表没绿，闸当场拦住他，并且直说卡在哪几格；拿旧单子想放行新构建、或者只换了前端没换后端，也一样拦 | **缺失** | **L3（真闸真跑）** | `release-gate` job 三步式结构(**已有且真在用**，5 次真实 dispatch，`promote-all-prod.yml:59-138`)／后端 `sha` 输入与 `DEPLOY_SHA` 解析(**已有**，`:164-184`)／**前端 `promote-dashboard` 读 `inputs.sha`**(**缺失**，`:206-230` 全段无 INPUT_SHA，且 `reset --hard origin/main` 会把 backend 刚 pin 的同一个 repo 复位)／第三证据项(**缺失**，落点 `:138` 之后)／gate 脚本 + selftest workflow(**缺失**)／棘轮与计数(**缺失**，v5 加计 `force_opened` 与 `unverifiable_this_version` 裁决绿两项) | 分支：取数失败 = **红**（fail-closed），仅此情形可填 `bypass_two_column_infra`；格红一律不可豁免。判定点 **J7**（取数通路）／**J9**（怎么验闸而不真发版）／**J12**（sha 绑定）／**J15**（逃生阀） |
| **Step 9**（出错路径）任何一步塌了，主理人在验收单上就看得见是哪一步塌的，并且能重开一轮而不丢上一轮的留痕 | **缺失** | L2（服务端真验） | **run 状态机 7 值**(**缺失**，v5 由 5 值扩到 7：`pending`/`in_review`/`human_complete`/`adjudicated`/`stale`/`expired`/`abandoned`)／`ai_incomplete` 标记(**缺失**)／**pending run 过期扫描器**(**缺失**，v5 新增 ← r4-P1-1)／同 GP 多轮 run 并存(**当前物理不可能**，`acceptance_checks_check_key_key` 全局 UNIQUE)／跨 run 写隔离(**缺失且是新坑**，`acceptance.js:62-66` `UPDATE … WHERE check_key = $4` 不带 run_id) | 分支：验收期间 staging 重部署或规程改版 → run 标 `stale`，人列提交 409，必须重开新 run，旧 run 存档留痕不删；**员工开单不填超 48h → `expired`**；**发起人显式作废 → `abandoned`**。**三者都不是活跃 run，都不锁该 gp 的 AI 列可见性**（判据 2）。判定点 **J5**／**J12**／**J2 判据2** |

### 出错路径的用户视角（发现 → 恢复）

| 故障 | 用户怎么发现 | 怎么恢复 |
|---|---|---|
| AI 打表器中途挂 | 单头显示「AI 列不完整（已完成 N/36）」+ 缺格格号清单 + 自动开的 P0 | 员工照常填（人列不受影响）；**缺格按 Q0′ = 未定，闸拦**；整轮标 `ai_incomplete`（哑火条件三）；单独重跑打表器补齐后自动摘标 |
| AI 采证账号看不见员工本轮绑的机 | 建单期即被拒（A16②），提示「测试用客户账号不属于验收专用租户」；若绕过建单校验则 Step 3 自检时（`machines_online` 不含单头 `device_model`）整轮 `ai_incomplete` 并告警 | 改用验收专用租户的授权码重新绑机并重开 run；**不允许**让 AI 带着看不见的租户跑完一轮判一堆「无法验证」 |
| **AI 说「本轮没这个场景」，员工却判了**（v5 新增） | 合看页该格标「AI 说没场景，但你判了——请裁决」（Q3″），`ai_evidence.reason` 已被服务端改写为 `scenario_falsified` | **不重跑**（场景已过，取不回来）→ 主理人当场裁决；同时记一次「AI 场景采证失准」计数，同格反复出现则开 P0 查该格采证方法（P2-22） |
| **红线8（S13-c4）本轮无从验证**（v5 新增） | 合看页该格标「本版无受控手段制造频控场景」，AI 列恒「无法验证」，且该格**不走 Q3 绿通道** | 主理人有名有姓裁决放行（计入 A12 棘轮）；根治路径 = Gate B 第6条的 staging 受控注入开关 |
| AI 打表器整轮哑火（登录失效/staging 全站不可达） | 单头显示「AI 列本轮无效（确定判定 0 格）」+ 自动开的 P0 任务 | 修通路后重跑采证；**不进**熔断、不建 bug/trace；闸一律拦到 AI 列有效或主理人逐格裁决 |
| staging 在验收中途被重新部署 | 提交人列时 409，页面提示「本单验的构建已失效」 | 重开新 run（新 sha 二元组），旧 run 存档为 `stale`，留痕不删；**该 stale run 不会锁住这个 gp 的 AI 列可见性**（判据 2 已收窄，r4-P1-1） |
| **员工开了单没填完就走**（v5 新增） | 该 run 停在 `pending`/`in_review`，48h 后自动转 `expired` 并在单头标「已过期未完成」 | 发起人重开新 run；亦可在到期前显式作废转 `abandoned`（留痕）。**过期/作废后该 gp 的历史轮 AI 列与裁决理由恢复可见** |
| 规程 yaml 改版 | 同上（`spec_sha` 不匹配） | 同上；改版说明写进新 run 单头 |
| **上一轮复盘未闭环导致本轮建单被拒**（v5 新增 ← r4-P1-3） | 发起人点「发起验收」收到 **409**「上一轮复盘未闭环」，响应写明上一轮 `run_key`、还差哪些人 ack、以及距自动可闭环还有多久 | ①正常路：催齐 ack 或等满 24h 后，由**发起人/主理人**点「关闭复盘」→ 重新建单；②逃生阀：发版等不起时带 `force_reason`（≥20 字）强开，上一轮标 `review_force_closed`，留痕落 `detail` 并进 A12 棘轮（近 30 天 >3 次 → gate `exit 1`） |
| 放行闸取不到双表数据 | promote 时 release-gate 红，summary 写「双表取数失败（infra_error）」 | 修通路后重跑；紧急发版填 `bypass_two_column_infra`（进 summary 大字 + 棘轮计数） |
| 员工与 AI 大面积分歧 | 合看页整列变分歧色 | 先怀疑打表器（核 AI 证据截图是否为登录页）；非绿格占比 >1/3 自动熔断，改开「规程/数据源疑似分叉」P0 |
| **AI 打表器误触达真人（红线7 暗号已发出）** | 收信端账号出现非计划私信 / 抖音风控告警 / 打表器日志出现非 allowlist host 或 `collect/start` 调用 | ①立刻停跑该 workflow 并吊销 `STAGING_ACCEPTANCE_*` + `ACCEPTANCE_AI_TOKEN`；②在收信端截图取证，本轮 run 直接标 `stale` 作废（暗号已消耗，S12 本轮不可复用，需换新暗号）；③开 P0 复盘 Gate A 哪一层被穿；④Bark 告警主理人（不走飞书）；⑤补 A11 的机械断言覆盖被穿的那一层后才允许重新开跑 |

---

## 验收断言（A1-A17，冻结后 AI 不可改）

对齐 PRD `Final E2E`，按 **36 格**口径与 r2/r3/r4 findings 修正。所有 shell 断言禁用裸 `grep -c`（`|| true` 兜底）。涉及「AI 可判格数」的断言一律按 §口径切换表从 yaml 解析取数，**不硬编码 16 或 19**。

**A1 · 一张表两列（决策①）**
```sql
SELECT check_key, result, submitted_by, ai_verdict, ai_evidence, ai_run_at
FROM acceptance_checks WHERE run_id = :rid AND check_key = 'S3-c1';
```
断言：恰 **1 行**；`result` 与 `ai_verdict` 均非空且同属枚举 `('通过','不通过','无法验证')`；`check_key ~ '^S\d+-c[1-4]$'`；`SELECT count(*) … WHERE run_id=:rid` = **36**；`SELECT count(*) … WHERE run_id=:rid AND check_key LIKE 'S14-%'` = **0**。

**A2 · 背靠背（决策②，服务端裁剪；读侧 9 出口 + 写侧 3 条）**
读侧——该 gp 下存在**活跃 run**（`status IN ('pending','in_review')`）时，以下全部成立：
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
**反向断言 ①（同一轮解锁）**：该 gp 下**无活跃 run** 时，出口2 与出口3 的 `?view=review` 返 200 **且含** AI 四列（同一组 curl 反向再跑一次）——Step 7 与 A3 由此可同时成立。

**反向断言 ②（v5 新增，← r4-P1-1：非活跃 run 不是持锁者）**：构造一个 gp，其下有 **1 个 `adjudicated` run + 1 个 `stale` run**（模拟「验收中途 staging 重部署 → 旧轮作废重开 → 新轮已定案」这条 J16/P2-6 明确预期的常态路径），断言：
```bash
# 该 gp 无活跃 run（stale 不算），故已定案轮的 AI 四列与 adjudication 必须可见
test "$(curl -s "localhost:5221/api/brain/acceptance/runs/$ADJUDICATED_RUN_KEY?view=review" \
     | grep -c -E "$AI_COLS" || true)" != "0"
test "$(curl -s -o /dev/null -w '%{http_code}' "…/runs/$ADJUDICATED_RUN_KEY?view=review")" = "200"
# 而 stale run 自己仍隐藏（它从未达 human_complete）
test "$(curl -s "localhost:5221/api/brain/acceptance/runs/$STALE_RUN_KEY" | grep -c -E "$AI_COLS" || true)" = "0"
```
把 `stale` 分别换成 `expired` 与 `abandoned` 各跑一遍，三次结果必须一致。**这三条是 r4-P1-1 的直接回归测试**：若判据 2 写成「未达 `human_complete`」，第一条断言必挂。

写侧：
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

**A4 · AI 诚实边界（Gate A 的机械化，决策⑤；绑静态属性 + 零缺格 + v5 场景双闸）**
> 下列 `:human_only_list` 与「确定判定上限」按 §口径切换表取值：**基线 20 格 / 上限 16**，Gate B 第4条通过后切 17 格 / 上限 19。断言脚本从 yaml 解析取数，不硬编码数字。
```sql
-- ① human_only 格（yaml 解析得出）不得出现「通过」，且必须有回写
SELECT count(*) FROM acceptance_checks
WHERE run_id=:rid AND check_key IN (:human_only_list) AND (ai_verdict IS NULL OR ai_verdict <> '无法验证');  -- == 0
-- ② AI 给出确定判定的格数上限 = machine_db 格数（基线 16）
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_verdict IN ('通过','不通过');  -- <= 16
-- ③ reason 与格的静态属性绑定（不是 AI 自报说了算）
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_evidence->>'reason'='human_only'
  AND check_key NOT IN (:human_only_list);                        -- == 0
-- ④ 整轮哑火识别 · 条件① 确定判定为 0（堵「count=0 恒满足上限」）
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_verdict IN ('通过','不通过');  -- == 0 时
-- 断言 acceptance_runs.detail->>'ai_status' = 'dumb' 且 gate_verdict='红'
-- ⑤ 整轮哑火识别 · 条件③ 零缺格
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_verdict IS NULL;   -- 正常轮 == 0
-- 构造轮：造一个「只回写 8 个 hard 格 + 2 格、其余 26 格不提交」的 run，
-- 断言 detail->>'ai_status'='dumb' 且 run 标 ai_incomplete 且 gate_verdict='红'
-- 且那 26 格的 final_state 全为「未定」（不得因人列通过而变绿）
-- ⑥（v5 新增，← r4-P1-2）scenario_not_triggered 只允许出现在 opportunistic 格
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid
  AND ai_evidence->>'reason'='scenario_not_triggered'
  AND check_key NOT IN (:scenario_opportunistic_3_list);          -- == 0（3 格 = S5-c3/S5-c4/S10-c4）
```
并断言（服务端强校验，不落库）：
- 向 `POST /acceptance/ai-results` 提交「非 `human_only` 格 + `reason='human_only'`」→ **HTTP 400**；
- **（v5 ⑦）**提交「`mandatory` 格（S4-c2/S4-c3）+ `reason='scenario_not_triggered'`」→ **HTTP 400**；
- **（v5 ⑧ 闸①）**单头 `detail.scenarios_observed` 已含某 `opportunistic` 格的场景码时，该格提交 `scenario_not_triggered` → **HTTP 400**。

**A5 · 九组合矩阵机械对表**
构造一个测试 run，把矩阵每一行各造至少 1 格（含 Q0/Q0′/Q3′/**Q3″**），断言：
- 每格 `final_state` 与本文矩阵表逐行一致（服务端计算，psql 读回）；
- `gate_verdict='绿'` 当且仅当 **36** 格 `final_state` 全绿；任一 hard 格非绿 → `gate_verdict='红'` 且 `red_cells[]` 含该格号；
- hard 格为 Q3′（故障类无法验证）时**不得**被判绿；
- **Q0′ 格的 `final_state` 恒为「未定」，与人列取值无关**——同一格分别构造「人列通过 + AI 缺格」「人列不通过 + AI 缺格」「人列无法验证 + AI 缺格」三种，三次读回都必须是「未定」，不得出现绿或红。

**A6 · 合看页 + 裁决落库 + 员工回显（决策③）**
截图证据 **4 张**：①九组合矩阵全貌（至少含双绿/分歧/双红/仅人列绿四色 + 缺格「未定」图例 + **Q3″「AI 说没场景但你判了」图例** + 第14步灰带）；②一个分歧格展开，左 AI 证据右员工 note 并排；③主理人点裁决后的确认态；④**员工身份登录**同一页，看到裁决人与理由。加 psql：
```sql
SELECT adjudication->>'verdict', adjudication->>'by', adjudication->>'reason', adjudication->>'at'
FROM acceptance_checks WHERE run_id=:rid AND adjudication IS NOT NULL;  -- 四字段全非空
```

**A7 · 分流建任务（聚合式 + 熔断 + 哑火分流）**
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

**A9 · sha 绑定与双源对账**
```sql
SELECT detail->>'backend_sha',  detail->>'backend_sha_src2',
       detail->>'frontend_sha', detail->>'frontend_sha_src2',
       version, detail->>'spec_sha'
FROM acceptance_runs WHERE id=:rid;   -- 六项均非空；两组 sha 各自组内相等且为 40 位
```
- 源①（被测系统自报）：后端 `GET /api/version` 的 `build.sha`；前端 staging 页面的 build sha 标记（新增，见 D2）。
- 源②（构建侧 GitHub API）：后端 `deploy-staging-hk.yml` 最近成功 run 的 `headSha`（该 workflow `:42` `DEPLOY_SHA=${{ github.sha }}`、`:80` 注入容器 `BUILD_SHA`，故 headSha ≡ 实际部署 sha）；前端 `deploy-dashboard-staging.yml` 最近成功 run 的 `headSha`（**前提：该 workflow `:57` 由 `reset --hard origin/main` 改为 pin `github.sha`**）。
- 建单时任一组两源不等 → **拒绝建单**（HTTP 4xx + 无新行）。
- gate 断言：`PROMOTE_SHA`（`inputs.sha` 或 `origin/main` HEAD，与 `promote-all-prod.yml:183-184` 同算法）必须**同时**等于定案 run 的 `backend_sha` 与 `frontend_sha`，任一不等 → `exit 1` 且 `::error::` 写明「这个构建没有验收单」。
- **`promote-dashboard` 必须消费 `inputs.sha`**（现 `:206-230` 全段无 INPUT_SHA），否则闸绑死后端而前端仍按执行时 main HEAD 上产。

**A10 · 冻结锁与 run 退出路径（决策⑥；v5 补过期/作废）**
- 构造 staging 重新部署 → 人列提交 409 且 run 转 `stale`；构造 yaml 改版（`spec_sha` 变）→ 同样 409 + `stale`。curl 状态码 + psql 双证。
- **（v5 新增，← r4-P1-1）run 退出路径**：
```sql
-- ① 状态机 CHECK 恰含 7 值（+ 历史兼容值）
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='acceptance_runs'::regclass AND contype='c';
-- 断言定义含 pending/in_review/human_complete/adjudicated/stale/expired/abandoned
-- ② 过期扫描：把一个 pending run 的 created_at 回拨 49h，跑一次扫描器
SELECT status FROM acceptance_runs WHERE id=:rid;   -- == 'expired'
-- ③ 显式作废留痕
SELECT detail->>'abandoned_reason', detail->>'abandoned_by', detail->>'abandoned_at'
FROM acceptance_runs WHERE id=:rid2;                -- 三项非空，status='abandoned'
-- ④ 反二义：不存在「status 非终态而 detail 标了终态旗标」的行
SELECT count(*) FROM acceptance_runs
WHERE status IN ('pending','in_review')
  AND (detail ? 'stale' OR detail ? 'expired' OR detail ? 'abandoned');   -- == 0
```

**A11 · Gate A 能力剥夺**
- a) 打表器 workflow：`runs-on` 恰为 `ubuntu-latest`，全文 `grep -c 'self-hosted\|android-capable'` == 0；
- b) 该 job 引用的 `secrets.*` 集合 ⊆ 白名单三项且**不含** `ACCEPTANCE_API_TOKEN`（smoke 解析 workflow yaml 断言）；
- c) Playwright allowlist 单测：非 `staging-autopilot.zenjoymedia.media` 的 host 被 abort；
- d) 判官任务 payload 无 `target_environment:'mac_web'`（不走 `spawn.js:66` 宿主逃逸）；
- e) **零点火**：`cells-map.mjs` 的 `action` 取值集合恰为 `{'observe'}`（单测遍历 CELLS_MAP 断言）；采证器全文 `grep -c '开始采集\|collect/start\|trigger_collect'` == 0。

**A12 · 逃生阀可观测与棘轮（v5 加计两项）**
```sql
SELECT count(*) FROM acceptance_runs WHERE detail->>'bypass_used'='true' AND created_at > now()-interval '30 days';
SELECT count(*) FROM acceptance_checks c JOIN acceptance_runs r ON r.id=c.run_id
WHERE c.check_key IN (:hard_8_list) AND c.adjudication->>'verdict'='绿' AND r.created_at > now()-interval '30 days';
-- （v5 新增）复盘强开次数
SELECT count(*) FROM acceptance_runs WHERE detail ? 'force_reason' AND created_at > now()-interval '30 days';
-- （v5 新增）unverifiable_this_version 格（S13-c4）靠裁决判绿的次数
SELECT count(*) FROM acceptance_checks c JOIN acceptance_runs r ON r.id=c.run_id
WHERE c.check_key = 'S13-c4' AND c.adjudication->>'verdict'='绿' AND r.created_at > now()-interval '30 days';
```
断言：gate summary 打印全部四个计数；构造「近 30 天 bypass >3 次」→ gate 直接 `exit 1`（棘轮生效）；构造「近 30 天 `force_reason` >3 次」→ 同样 `exit 1`（复盘逃生阀不得变日常）。

**A13 · 员工待办信号**
建单后：`GET /api/staff/acceptance/pending` 返回 count ≥ 1；Staff Hub 侧边栏「验收」右侧出现数字角标（截图为证）；仪式发起通知实际送达（Bark 回执截图）。

**A14 · fixedNa 与红线13**
```sql
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND check_key LIKE 'S14-%';  -- == 0
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid;                             -- == 36
```
并断言：
- 建单生成器对任何 `fixedNa:true` 的步骤零建行——喂一份构造 yaml，把 S7 也标 `fixedNa:true`（S7 有效格 = c1/c2 共 2 个），建行数必须从 **36 降到 34**，且结果里不含任何 `S7-*`；
- 合看页把第 14 步渲染成不可填灰带，文案含「固定不适用（本版未做）」（截图为证）；
- run 的结论文案恒含「本轮结论只覆盖前13步」——与现役网页 `lib.mjs:381` 原文一致（红线13 的承载物）；
- 员工填表页三态按钮恰为 `通过/不通过/无法验证`，**不存在「不适用」按钮**（DOM 断言）。

**A15 · 复盘闭环：主体、防橡皮图章闸与逃生阀（v5 重写，← r4-P1-3）**
```bash
# ① 上一轮已定案但未闭环复盘 → 该 gp 建新 run 被拒
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "localhost:5221/api/brain/acceptance/runs" \
     -H 'Content-Type: application/json' -d "{\"gp_id\":\"$GP_ID\",\"backend_sha\":\"$NEW_SHA\",…}")" = "409"
# ② 主体唯一：员工身份打 review-closed → 403（只有发起人/主理人能关）
test "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "X-Staff-Identity: $EMPLOYEE" \
     "localhost:5221/api/brain/acceptance/runs/$PREV_RUN_KEY/review-closed" -d '{}')" = "403"
# ③ 防橡皮图章：员工未 ack 且距定案未满 24h 时，发起人打 review-closed → 403
test "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "X-Staff-Identity: $INITIATOR" \
     "…/runs/$PREV_RUN_KEY/review-closed" -d '{}')" = "403"
# ④ 全部人列提交人 ack 后，发起人打 review-closed → 200，随后建新 run → 200
curl -s -X POST -H "X-Staff-Identity: $EMPLOYEE" "…/runs/$PREV_RUN_KEY/review-ack" -d '{}'
test "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "X-Staff-Identity: $INITIATOR" \
     "…/runs/$PREV_RUN_KEY/review-closed" -d '{}')" = "200"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "localhost:5221/api/brain/acceptance/runs" … )" = "200"
# ⑤ 24h 兜底：把 adjudicated_at 回拨 25h、员工零 ack → 发起人打 review-closed → 200（不死锁）
# ⑥ 逃生阀：不闭环但带 force_reason（≥20字）建单 → 200；force_reason 为空或 <20 字 → 仍 409
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "…/acceptance/runs" \
     -d "{\"gp_id\":\"$GP_ID\",\"force_reason\":\"生产事故需紧急发版，复盘顺延至下一轮仪式统一补做\"}")" = "200"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "…/acceptance/runs" \
     -d "{\"gp_id\":\"$GP_ID\",\"force_reason\":\"急\"}")" = "409"
```
```sql
-- ⑦ 闭环与强开各自留痕，且机械可区分
SELECT detail->>'review_closed_at', detail->>'review_closed_by' FROM acceptance_runs WHERE run_key=:prev_run_key;
-- 正常路：两项非空；强开路：两项为空而 detail->>'review_force_closed'='true'
SELECT detail->>'force_reason', detail->>'force_opened_by', detail->>'force_opened_at'
FROM acceptance_runs WHERE run_key=:new_run_key;   -- 强开时三项非空
```
并断言（可见性闭合）：在**复盘窗口内**（上一轮 `adjudicated`、该 gp 无**活跃** run），员工身份打 `GET /acceptance/runs/$PREV_RUN_KEY?view=review` 返 **200 且含** `adjudication`；**下一轮建单之后**同一请求的 AI 四列与 `adjudication` **一并消失**（A2 读侧断言复用）。**（v5 补 ← r4-P1-1）**在窗口内额外插入一个同 gp 的 `stale` run，上述 200 + 含 `adjudication` 必须**不受影响**。

**A16 · AI 采证账号看得见员工本轮造的数据（v5 口径修正，← r4-P2-24）**
```sql
-- ① 单头字段真的落库了（含 v5 新增的场景清单）
SELECT detail->>'tenant_account', detail->>'device_model', detail->>'client_no',
       detail->>'collect_task_no', detail->>'passphrase', detail->'scenarios_observed'
FROM acceptance_runs WHERE id=:rid;    -- 六项均非空（scenarios_observed 为 JSON 数组，可为空数组但键必须在）
```
```bash
# ② 建单期机械校验：填一个不属于验收专用租户的客户账号 → 拒绝建单，且无新行
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "localhost:5221/api/brain/acceptance/runs" \
     -d '{"gp_id":"'$GP_ID'","detail":{"tenant_account":"someone-else@example.com"},…}')" != "200"
# ③ 采证期自检（v5 口径）：断言判据是「看得见那台机」，不是「租户字符串相等」
#    jq -e '.machines_online >= 1 and ([.machines[].device_model] | index($DEVICE_MODEL) != null)' run-summary.json
# ④ 自检不过 → 整轮 ai_incomplete 且不产生任何「无法验证」回写
# psql 复核：detail->>'ai_status'='dumb'、ai_incomplete=true、count(ai_verdict IS NOT NULL)==0
```
并断言（Gate B 第5条的实证留痕）：一轮真实 run 里，员工用验收专用租户授权码绑机后，AI 采证的 `run-summary.json` 里 `machines_online` ≥ 1 **且**其中含员工本轮绑的那台机型号（与单头 `device_model` 对得上）——这是「AI 真的看得见员工造的数据」的唯一直接证据，也是候选 C 那 16/19 格可判量的地基。

**A17 · 场景证据指针与 hard 格保护（v5 新增，← r4-P1-2）**
```sql
-- ① scenario_class 是 yaml 静态属性且三值齐全，与本文台账逐格相等
-- 从 yaml 解析：mandatory ⊇ {S4-c2,S4-c3}；opportunistic == {S5-c3,S5-c4,S10-c4}；
--               unverifiable_this_version == {S13-c4}
-- ② 闸②（合看期交叉证伪）：构造「AI 写 scenario_not_triggered + 人列给确定判定」的 opportunistic 格，
--    触发 human_complete 后读回
SELECT ai_evidence->>'reason', final_state FROM acceptance_checks
WHERE run_id=:rid AND check_key='S10-c4';
-- 断言 reason == 'scenario_falsified' 且 final_state == '未定'（Q3″），不得为绿
-- ③ 对照组：同格「AI scenario_not_triggered + 人列无法验证」→ reason 保持 scenario_not_triggered，
--    final_state == '未定'（Q9 双盲），同样不得为绿
-- ④ 合法绿通道仍在：「AI scenario_not_triggered + 人列通过 + 员工未勾该场景」→ final_state == '绿'（Q3）
-- ⑤ unverifiable_this_version 格无裁决不得绿
SELECT final_state, adjudication FROM acceptance_checks WHERE run_id=:rid AND check_key='S13-c4';
-- 构造「人列通过 + AI 无法验证 + 无 adjudication」→ final_state != '绿'（不走 Q3）
-- 构造「同上 + adjudication.verdict='绿' 且 by/reason/at 非空」→ final_state == '绿'，且计入 A12 第四项计数
-- ⑥ scenario_falsified 不进哑火分子
-- 构造一轮：确定判定 >0、缺格 0、故障类 < 阈值，但有 2 格 scenario_falsified
-- 断言 detail->>'ai_status' != 'dumb' 且 run 未标 ai_incomplete（该格仍拦闸，但不是 infra 故障）
```
并断言（3 个 hard 场景格的保护未降级）：`S5-c4` 与 `S10-c4` 仍在 `machine_db` 集合内（AI 必须给判定或走双闸校验过的合法无法验证）；`S13-c4` 虽转 `human_only`，但其绿路径**只剩裁决一条**——构造「人列通过 + AI human_only 无法验证 + 无裁决」，`gate_verdict` 必须为**红**且 `red_cells[]` 含 `S13-c4`。

---

## 判定点登记表（J1-J20，批准即写 decisions 冻结）

**J1 · ⚠️「双表绿」放行判据的分母**
- 候选：A 36 格**双列都绿** ／ B `machine_db` 格双绿 + `human_only` 格人列独判 ／ C 只看 8 红线格 ／ **D 36 格「最终态」全绿**（两类格数按 §口径切换表，基线 20/16）
- **REC = D**（分母由 37 改 36，见 J10）
- 依据：AI 天花板是有限确定判定 + `human_only` 格（基线 20）恒无法验证，**A 物理不可达**；B/C 把「人列没验成」和「没填」当成默认放行，正是 product#P0-1 的绕过口。D 用「最终态」统一口径：绿只来自 Q1、合法 Q3、或裁决绿。v2 的 D 之所以仍恒不可达，是因为分母里混进了 S14-c1 这个**恒不可判**的格（r2-P0-1）——J10 修掉分母后，D 才真正可达。
- 误判后果：选 B/C → 8 个 hard 格里 4 个可以「无法验证」蒙混过关；选 A → 闸恒红，三次之后必被豁免成摆设。

**J2 · ⚠️ AI 列可见时机**（v5 收窄判据②、判据④ 加逃生阀）
- 候选：A 逐格提交后该格解锁 ／ **B 人列全表提交（run 达 `human_complete`）后统一解锁**
- **REC = B**，四条判据：**①裁剪判据 = 逐行按该行所属 run 的状态**（`loadRunsWithChecks` 是多 run 响应，响应级判据无解）；**②gp 级跨轮闸——同 gp 存在任一活跃 run（`status IN ('pending','in_review')`）时，该 gp 全部轮次 AI 列 + `adjudication` 一并隐藏**；③合看态需显式 `?view=review`；**④复盘窗口前置**——同 gp 最近一个 `adjudicated` run 的 `detail.review_closed_at` 为空时拒绝建新 run（409），**除非带 `force_reason` 强开（留痕 + 棘轮）**。
- 依据：`check_key` 改规程格号后每轮同名（J5-A），而「验收历史」入口已存在（`App.tsx:49-51` → `services/acceptance.ts:64-67` → `routes/acceptance.js:264-274` 全量返回）；不加 gp 级闸，员工本轮填表期就能看到上一轮同格的 AI 判定，锚定照旧成立。防锚定只须约束 T1（本轮人列提交前）这一段，故与 Step 7 不冲突。
- **v5 为什么把判据② 从「未达 `human_complete`」收成「活跃 run」（← r4-P1-1）**：`stale` 是与 `human_complete` **平级的另一个终态**（A10/J12/Step9 明写：验收期间 staging 重部署或规程改版 → run 标 `stale`、人列提交 409、必须重开新 run、旧 run 存档留痕不删），它**永远达不到** `human_complete`，于是永久满足旧判据②。而这不是小概率事件——J16/P2-6 自己实测 `deploy-staging-hk.yml:14-20` 在 `apps/api/**` 有 push 到 main 就自动部署、近 14 天 22 次提交，本 GP 把「中途被重部署」当预期常态并专门设计了 stale 兜底。同类还有「员工开了单没填完就走」的 pending run。后果是**静默且不可恢复**：合看页、裁决页读取、员工裁决回显全部读不到 AI 四列与 `adjudication`，而闸侧走 D5 gate 端点只取 `gate_verdict`/`red_cells` 不受影响 → 「闸照常跑、人看不见」。收窄口径直接沿用 `acceptance.js:174` `loadPendingRuns` 的现成谓词，并同步补齐 pending run 的退出路径（`expired` 48h 自动过期 / `abandoned` 显式作废），三态一律不是持锁者。**stale run 自己的 AI 列仍隐藏**（遵循其定案前状态：它从未达 `human_complete`），但不阻塞他轮——两件事分开写。
- **v5 明确不取的方案**：给「已定案轮的 `adjudication` 文本」开跨轮可见例外。理由是它要论证「裁决文本不携带本轮 AI 判定信息」，而裁决理由几乎必然引用 AI 证据；格号又跨轮同名，上一轮同格的裁决理由对本轮就是直接锚定。
- 误判后果：选 A 且 9 条出口漏一处 → 整轮双列独立性作废且事后无法察觉；不加 gp 级闸 → 从第二轮起防锚定形同虚设；加了 gp 级闸却不加判据④ → 员工的异议永远来不及说；**判据② 不收窄 → 第一次 stale 之后该 gp 的人侧视图永久瞎，且因为闸还在跑，没人会发现**。

**J3 · ⚠️ AI 打表器的执行体**
- 候选：A mac_web 的 Claude + Playwright ／ **B zenithjoy GitHub 托管 runner 跑 capture，判定另派 Brain docker 内任务** ／ C Brain 内置 curl/psql 直跑
- **REC = B**（不变）
- 依据：决策⑤ 字面「判据=屏幕所见非查库」作废 C。A 的问题是**能力过剩**：`spawn.js:66` 判到 `mac_web` 即走 `host-executor.js` ssh 逃逸宿主。B 的托管 runner 同样跑真 chromium，但物理上够不到手机池，且 secrets 可白名单化。
- 误判后果：选 A →「不碰真机」只剩提示词承诺。
- **附注**：B 只解决**带外**逃逸；带内（经 staging 后台指挥真机）由 J17 解决，两者缺一不可。

**J4 · ⚠️ 不可自动化格的 AI 列**
- 候选：A 标「无法验证」留空 ／ B 硬跑给低置信判定
- **REC = A**，追加：「无法验证」的**合法/故障分类由格的静态属性判定**（yaml `verifiable_by` / `scenario_class`），AI 自报 `reason` 只作补充说明，且服务端对不匹配的 reason 直接 400。
- 依据：`cells-map.mjs:14` 已明规「场景未出现必须判无法验证，不许假绿」。v2 把分类落在 AI 自填的 `ai_evidence.reason` 上，等于让被考核者自己定考卷（r2-P1-3）——`machine_db` 且非 `opportunistic` 的格（基线 **13** 格，切回 16 格），合法 reason 集合为空集，任何「无法验证」一律故障类。
- **追加（← r3-P1-2）**：「不回写」也是一种自报——AI 不提交某格，等于绕开了这张分类表。故 AI 必须对全部 36 建行格回写，缺格数 > 0 即整轮 `ai_incomplete`（哑火条件三），缺格行 `final_state` 恒「未定」（Q0′）。
- **v5 追加（← r4-P1-2）**：「场景没发生」同样是一种自报，且是**唯一一种服务端算不出静态属性**的自报。由 J20 的双闸接管，本条只保留「reason 必须与静态属性一致」这一半。
- 误判后果：不绑静态属性 → 打表器登录失效整轮哑火时把 reason 写成 `human_only` 就从 Q3′ 滑进 Q3 绿通道；绑了静态属性但允许缺格 → 同一个绕过口换个形状回来（不写 reason，直接不交这一格）；**绑了静态属性、堵了缺格，却仍让 AI 自报「场景没发生」→ 第三种形状：6 格（含 3 个 hard 红线格）可单方声明滑进绿通道，且事后与「场景真没发生」不可区分**。

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

**J10 · ⚠️ 建行格的排除集**
- 候选：A 只排除 `na:true`（v2 REC，**已被 r2-P0-1 证伪**）／ **B 排除 `na:true` ∪ `fixedNa:true` 步骤下的全部格** ／ C 全 56 格建行标 `na` ／ D 保留 S14-c1 但给矩阵加第四态「不适用」
- **REC = B**，建行 **36** 格
- 依据（三重实测）：①**法源自己的数字**——决策① 原文「一份规程**52**格」，而 yaml 解析 步骤 1-13 全格数 = 13×4 = **52**（精确相等），加上第 14 步四格才是 56，即法条本身就把 fixedNa 步整步排除在计数外；52 − 16（步骤 1-13 内的 na 格）= **36**。②**规程原文**：S14 `fixedNa: true`、`op:'不用操作——这个版本没做这个功能'`、`ev: []`，c2/c3/c4 标 `na:true`，c1 判据原文「固定不适用」——作者留下 c1 不是要人判它，是要挂红线13 这句话。③**现役网页已经这么做**：`lib.mjs:439` 对 fixedNa 步的 c1 渲染成不可填的「固定：不适用」，员工物理上点不了。
- 排除 D 的理由：加第四态要动 DB CHECK、Staff Hub select、九组合矩阵、闸判据四处，而「不适用」在其余 36 格里没有任何合法用例（真不适用的格 yaml 已标 na）——为一格加一态，等于给员工多一个可以在红线格上点的绿色出口。
- **红线13 的承载物**（不能因为不建行就丢）：①生成器对 fixedNa 步零建行（`fixedNa` 已在 `line02-android.schema.json:27`，可机械依赖）；②合看页把第 14 步渲染成灰带「固定不适用（本版未做）」；③run 结论文案恒含「本轮结论只覆盖前13步」，与现役网页 `lib.mjs:381` 原文一致。三条合起来 = A14。
- 误判后果：选 A（v2 现状）→ S14-c1 三条路全落拦，闸恒红，复刻 J1 给候选 A 判死刑的同一个死结。选 C → 分母含 19 个永不参与判定的格，闸语义变糊。选 D → 红线格上多一个绿色出口。

**J11 · ⚠️ 剧场闸（`theater_mismatch`）冲突的处置**
- 候选：A 措辞分区 ／ B 改 `harness-judge.js` 加白名单例外 ／ C 挂 `windows_wechat` 真机环境 ／ **D 本 GP 不进 harness 主链**（见 J13）
- **REC = D**；**A 作废，B 明确否决**
- 依据：A 挡不住——闸是大小写不敏感 substring（`harness-judge.js:812`），关键词表含 `android`（`:188`），而规程文件名 `line02-android.yaml`、run_key `line02-android-*` 本身含 android。B 会把一道正确的闸拆了。C 拿不到浏览器且与 Gate A 冲突。
- **措辞修正**（← P2-1）：`runMechanicalGate` 经 `runJudgeGate` 暴露，除 `routes/harness.js:19` 外还有 `orchestrator/run.js:128` 与 `scripts/harness-judge-cli.mjs:83` 两处接线；**三处均属 harness 链**，故「走 `/dev` 则整条闸不在路径上」的结论不变。
- 误判后果：坚持 A → 合同一提交 `theater_mismatch` FAIL，诱导下一个人去改闸。

**J12 · ⚠️ 冻结锁的校验强度**
- 候选：**A 记 sha 并双向校验** ／ B 只记录不校验
- **REC = A**，四条：
  - **①双源对账（换活 workflow）**：后端源① = staging `GET /api/version` 的 `build.sha`，源② = **`deploy-staging-hk.yml`** 最近成功 run 的 `headSha`。**v2 用的 `deploy-us-vps.yml` 已停用**（文件名已改「已弃用——staging 已迁 HK」，`:21-23` on 只剩 `workflow_dispatch`，最近成功停在 2026-07-14）——照 v2 落地则两源恒不等，A9「两源不等 → 拒绝建单」会让本 GP 永远建不出第一张单（r2-P1-1）。
  - **②前端同样双源**：源① = staging 前端 build sha 标记（**需新增**，全仓 `VITE_BUILD_SHA/buildSha` 在 `apps/dashboard` 零命中），源② = `deploy-dashboard-staging.yml` 最近成功 run 的 `headSha`，**且该 workflow `:57` 需由 `reset --hard origin/main` 改为 pin `github.sha`**。
  - **③规程版本锁**：`version` + `spec_sha`（yaml 内容 sha256），任一变更 → run 转 `stale`。
  - **④闸侧双 sha 绑定**：`PROMOTE_SHA` 必须同时等于 `backend_sha` 与 `frontend_sha`，且 **`promote-dashboard` 改读 `inputs.sha`**（现 `:206-230` 无 INPUT_SHA，`reset --hard origin/main`，还会把 `promote-backend` 刚 pin 的同一个 `/opt/zenithjoy/repo` 复位）。
- 依据：决策⑥「验收站位=staging 冻结切面」。两列判的绝大多数格是在 staging **网页**上看出来的，只绑后端 sha 等于没绑（r2-P1-2）。
- 误判后果：源选错 → 首次建单即被自己的 fail-closed 拦死；只绑后端 → 上产的前端是 promote 那一刻的 main HEAD；只做 run 内冻结不做闸侧绑定 → 用昨天的绿单放行今天的构建。

**J13 · ⚠️ 本 GP 的实现路径**
- 候选：A 走 harness 主链 ／ **B 拍板后按交付物建多个 `/dev` 任务**（带 `payload.anchor` 三件套）
- **REC = B**
- 依据：①**跨 repo**：`GP_HARNESS_BASE_REPO` 常量恒为 `cecelia.git`（`golden-path-contract-task.js:1`），而本 GP 过半交付物落 `zenithjoy-workspace`；②**真浏览器**：`GP_HARNESS_TARGET_ENVIRONMENT` 常量恒为 `local_api`（同文件 `:2`），且 `mac_web` 已被 J3 因安全理由否决。
- 误判后果：选 A → 合同签完才发现要么被 theater 闸卡死、要么 PR 改不到 zenithjoy。
- **代价与补偿**：`/dev` 路径没有 GAN 对抗与 evaluator 的 L2/L3 findings。补偿 = 本提案的 A1-A17 冻结断言作为每个 `/dev` 任务 DoD 的 `[BEHAVIOR]` 来源，且最后一个交付物必须跑一次覆盖全部断言的 Final E2E。

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
- **v5 附注（← r4-P1-3）**：本条「B 会被人手绕过」的论证同样适用于复盘 409——**任何落在发版路径上的硬闸都必须配一条有名有姓的出口**，否则它会被改掉。故 J2 判据④ 的 `force_reason` 强开与本条 `bypass_two_column_infra` 同形：都留痕、都进 A12 棘轮、都不掩盖格红。
- **附注（← P2-4，本期只记账不实现）**：A12 的棘轮到顶（近 30 天 >3 次）后当前没有登记的升级路径。建议实现期在棘轮到顶后接一条有名有姓的出口（主理人在 Brain 写一条 `decision` 才放行），已进 P2 记账 P2-4。

**J16 · ⚠️ 验收仪式的发起人、频率与工时**
- 候选：**A 每次 promote 前一轮（发版人发起）** ／ B 固定每周一轮 ／ C 员工自助随时发起
- **REC = A**
- 依据：决策⑥「员工验收=发版仪式非日常」字面。发起人 = **发版人**；频率 = **每次 promote 前恰一轮**（同构建幂等复用，`acceptance.js:183` 已支持）。
- **仪式的两个开轮前置**（发起人在发起前必须满足，否则建单 409）：**①上一轮复盘已闭环**（`detail.review_closed_at` 非空；**v5**：闭环动作由发起人/主理人执行，且受「全员 ack 或满 24h」前置闸约束；等不起时可带 `force_reason` 强开，见 J2 判据④）；**②本轮的「测试用客户账号」= 验收专用租户**（J17 前提①）。两条都在建单端点机械校验，不靠发起人自觉。
- **工时与跨度（两段式）**——① 员工现场操作流（Step 2）约 40 分钟（含 S12 真机全程录屏私信；**v5：另加本轮场景清单勾选，约 2 分钟**）；② AI 采证（Step 3）约 40 分钟，**员工可离开**；③ 员工填表判定（Step 4）约 30 分钟；④ 主理人裁决约 15 分钟；⑤ **v5：员工看裁决并 ack 约 5 分钟（异步，不占仪式跨度，但闭环需等）**。**员工工时 1.2–1.5 人时/轮不变，仪式跨度约 2 小时两段**，发版人排期须按此。若 J20 的 `op` 加厚呈批通过（S5 制造掉线 + S10 二次采集），Step 2 再加约 10 分钟、Step 3 的采集等待再加约 8 分钟（已记 P2-24）。
- **验收窗口的冻结约束**（← P2-6）：`deploy-staging-hk.yml:14-20` 在 `apps/api/**` 有 push 到 main 就自动部署，近 14 天该路径 22 次提交。发起人在发起本轮前须在团队频道公告「验收窗口 T，期间 `apps/api/**` 与 `apps/dashboard/**` 暂停合并」；未公告而窗口内发生部署 → run 按 A10 转 `stale` 重开（含重跑一次 AI 采证）。**本期只做「组织约束 + stale 兜底」，不做机械冻结**，此代价明示登记。
- 误判后果：不定仪式 →「36 格齐才解锁」变成没人负责的阻塞点；不评工时 → 员工草率填表；不登记冻结约束 → 反复 409 + 整轮重开，员工把两列制当成负担。

**J17 · ⚠️ AI 采证的点火边界与仪式时序**（**最需要主理人拍板的一条**）
- 背景（实测）：`cells-map.mjs` 的 `action` 三值里 `trigger_collect` **恰 1 格 = S6-c3**，`capture.mjs:152-163` 真的填关键词点「开始采集」；该动作经 `POST /api/acquisition/collect/start` 落 `acquisition_collect_tasks(agent_id)`，由绑在常驻验收租户下的**真安卓 agent 用真抖音小号**领走执行。这是决策⑤「AI 扮员工走 UI」与 Gate A「不碰真机」的真实矛盾点。
- 候选：
  - **A · AI 完全先行 + 零点火**：AI 在员工任何动作之前跑，凡依赖本轮采集数据的格一律「无法验证-需真实采集」。
  - **B · 允许点火，但限专用验收租户 + 专用小号**：保留 `trigger_collect`，把风险收在一个隔离租户里。
  - **C · 两段式仪式：员工先跑操作流 → AI 先行采证（零点火，按单头任务编号定位本轮任务）→ 员工填表判定**。
- **REC = C**
- **C 的两条显式前提**
  - **前提① 同租户可见性**——C 的全部可判量建立在「AI 采证账号看得见员工本轮造的数据」上，而采证器的可见范围完全由它登录的账号/租户决定（`login.mjs:1-11` 原文：每轮新注册 → 租户下零设备 → 链路格全部只能标无法验证）。员工在 Step 2 用「本轮发的测试授权码」绑机，现役网页把它记在单头**「测试用客户账号」**（`lib.mjs:297`，`data-f=tenant`）。落法：该字段落 `acceptance_runs.detail`，建单期校验 ∈ 验收专用租户（不等则拒绝建单），采证开跑前再自检一次。**v5 口径修正（← r4-P2-24）**：自检判据不是「登录租户 == 单头 `tenant_account`」（前者是租户、后者是一个客户账号，类型不匹配，且 staging 未必暴露租户标识），而是**「`run-summary.machines_online` ≥ 1 且含单头 `device_model` 那台机」**——用「看不看得见员工本轮绑的那台机」代替字符串相等。Gate B 第5条首日实测，**不通则本 GP 阻塞升级主理人**。
  - **前提② 时限格事后可测性**——C 之下 AI 在员工操作流结束约 40 分钟后才到场，「自己点火后轮询计时」（`capture.mjs:168-185`）物理失效，只能读页面时间戳。**v5 核出该前提影响的是三格不是两格**：除 S7-c2「5分钟内进入终态」、S9-c2「3分钟内出判定结果」外，**S4-c2「在约定时间窗内恢复在线」同属时限判据**（yaml 原文 + fails「等了很久才恢复在线」），AI 迟到同样观测不到恢复过程。按 fail-closed 三格一并先摘出 AI 可判集合（基线上限 16），Gate B 第4条逐格实测后按 §口径切换表切回。
- 依据：
  - **A 与 C 的安全边界完全相同**（AI 都是零点火），差别只在 AI 跑的时刻；但 **A 的完备性代价极大**：20 个 `machine_db` 格里 **11 格**的判据原文依赖本轮采集数据（S6-c3/S7-c1/S7-c2/S8-c1/S8-c3/S8-c4/S9-c1/S9-c2/S10-c1/S11-c1/S11-c3），剩下 **3 格**（S1-c3/S6-c4/S11-c4）才是 A 之下的常态可判——即 **A 会把 AI 的常态确定判定压到 3/36 格**，两列制退化成摆设。
  - **C 不违反决策②**：决策② 的字面是「员工填表时绝不可见 AI 判定，AI 列后台先行完成」——约束的是「**先于填表**」，C 里 AI 采证发生在 Step 2（操作）之后、Step 4（填表）之前，字面成立。员工的「发起采集」本来就是规程 S6 的 `op`（原文「在预发环境用本轮关键词发起一个采集任务」），是**员工授权的人工动作**，不是 AI 的点火。
  - **C 不削弱防锚定**：AI 读的是 staging 页面状态，读不到人列（人列此时还没填；且 AI 的 `ACCEPTANCE_AI_TOKEN` 按 J19 物理上读不到 checks）。
- **候选 B 呈主理人拍板（不由 AI 单方决定）**——**v5 按 r4-P2-22 把「上限」与「常态」拆开表述，不再拿上限充常态**：

  | | A（AI 完全先行） | C（两段式，REC） | B（允许点火，专用租户+专用小号） |
  |---|---|---|---|
  | AI 确定判定**上限** | 3 格 | **16 格**（基线）／19（Gate B 第4条三格全通） | 20 格 |
  | AI **常态**确定判定 | **3 格** | **13 格**（基线）／16（切回） | **16 格** |
  | 真机/真账号风险 | 零 | 零 | 每轮多一次真实抖音采集：小号风控/封号、目标视频作者被真实触达、手机池占用 |
  | 仪式跨度 | 约 2 小时两段 | 约 2 小时两段 | 一坐到底约 1.5 小时 |
  | 需新增资产 | 无 | 无 | 专用验收租户 + 专用小号（需采购/养号）+ 与生产小号池的隔离验证 |

  > **常态 vs 上限的口径（← r4-P2-22）**：「上限」= `machine_db` 全部格数，是 A4② 的断言上界；「常态」= 上限扣掉 3 个 `opportunistic` 场景格（S5-c3/S5-c4/S10-c4，场景未触发时本就是合法「无法验证」、不构成确定判定）。B 的常态同样扣 3 个场景格再扣 S13-c4（本版不可制造，见 J20），故 20−1−3 = 16。A 的 3 格（S1-c3/S6-c4/S11-c4）不含场景格与时限格，不随口径变。**结论不翻：13 vs 3 仍是压倒性差距，13 vs 16 的 3 格差价换掉的是每轮一次真实抖音触达。**
- 误判后果：选 B 而不做租户/小号隔离 → 每轮验收都在真实抖音上打一次采集，风控与触达风险按轮累加，Gate A「不触达任何真实抖音账号」变成空话；选 A → AI 列只剩 3 格有内容，闸判据的对抗价值归零，几个月后必被当作噪音关掉；选 C 而不把「员工操作流」显式拆成独立步骤 → 员工会边跑边填，AI 采证时人列已部分落库，防锚定窗口失守；**选 C 而不落前提① → 首轮就死**（AI 登录的租户看不见员工本轮绑的机，11 个格全判「无法验证」→ 按静态属性归故障类 → 直接撞上哑火条件②③，而现场排查会先怀疑打表器坏了，实则是租户配错）；选 C 而不落前提② → 时限格每轮被判成故障类无法验证，常驻拦闸，最后必被人手改成「合法」而把整张分类表的可信度一起搭进去。

**J18 · ⚠️ 现役员工验收网页的处置**
- 背景（实测）：员工现在实际填的是 `acceptance-spec/generated/line02-android.html`（`cli.mjs:32-47` generate 产出，手工 scp 到 hk-vps 文档中心）。它是一张**完整可填**的表：有测试日期/测试人/复核人/手机型号/本轮暗号等表头字段（`lib.mjs:292-299`）、每格三选一、步骤红绿灯自动汇总。它的第三态是**「不适用」**（`lib.mjs:430` `STATE_LABEL`），而 Staff Hub 与 DB CHECK 是**「无法验证」**——两词语义相反（不适用=本来就不该验；无法验证=该验但验不了），而九组合矩阵的 Q3/Q6/Q7/Q8/Q9 全建在「人列无法验证」上。决策①「一张表」在员工侧没有收口。
- 候选：A 现状不动（两张表并存）／ **B 收编：generate 改产只读「判据说明书」，填表唯一入口 = Staff Hub** ／ C 反向收编（保留网页填表，Staff Hub 只做合看）
- **REC = B**
- 依据：决策①「数据层一张表」+ 决策 `efa578b8` ⑤「QA 验收留在 Staff Hub 直连 Brain」+ 决策 `078b314a`「动作走直连面」三条同向。C 会把两列合看、裁决、闸取数全部建在一张 scp 上去的静态 html 上（且 P2-10 已记：服务器那份不保证 = repo 那份）。B 的具体改动：`lib.mjs` 去掉三态按钮与 localStorage 勾选，保留判据全文/证据规范/红线说明/第14步灰带，页头加一行「填表请到 Staff Hub 验收页」并给链接。
- 具体收口三件事：①三态措辞统一为 `通过/不通过/无法验证`，「不适用」退出可填态（na 格与 fixedNa 步渲染为不可填灰格）；②表头字段（**测试用客户账号**/手机型号/客户端编号/本轮任务编号/本轮暗号 + **v5 新增的本轮场景清单**）迁进 Staff Hub 建单页与 `acceptance_runs.detail`（Step 2 的挂片）；③结论文案「前13步全部打通」由 A14 承载。
- 误判后果：选 A → 员工被训练的第三态与矩阵地基的第三态语义相反，填表时把「该验但验不了」点成「不适用」，闸按 Q3 放行，两列制在员工侧从第一天起就是错的。

**J19 · ⚠️ 公网 5223 的凭据分权与端点收口**
- 背景（实测）：`acceptance-public-server.js:32` 是 `app.use(createBearerAuth(token))` 单 token 守**全** router，它守的端点含 `POST /acceptance/results`（`routes/acceptance.js:342`）→ `submitAcceptanceResults` 写**人列** `result`，且 `submitted_by` 直取 `r.submitted_by`（`:62-66`，公网/内网路由都不注入身份，只有 Staff Hub 反代那条路才注入 `staffIdentity`，`staff.ts:338`）。v2 的 Gate A 把 `ACCEPTANCE_API_TOKEN` 列进打表器白名单并称之为「机械剥夺」——实际是把能把 36 格人列全写成「通过」并署名成员工的那把钥匙交给了 AI。
- 候选：A 保留单 token，靠提示词/断言约束 ／ B 单 token + 按 token 做端点白名单 ／ **C 三 token 分权 + 公网人列写端点下线**
- **REC = C**
- 落法：`createBearerAuth` 从 app 级下沉到路由级，三把钥匙各管各的——

  | token | 可达端点 | 持有者 |
  |---|---|---|
  | `ACCEPTANCE_AI_TOKEN`（新） | **只** `POST /acceptance/ai-results`（只吃 `ai_verdict`/`ai_evidence`/`ai_run_at`，服务端**忽略**请求体里的 `result`/`submitted_by`/`adjudication`；并校验 reason 与静态属性及场景闸①，见 J4/J20） | 打表器 job（GH secret） |
  | `ACCEPTANCE_GATE_TOKEN`（新） | **只** `GET /acceptance/gate`（只回闸判据，不回 AI 列原文） | promote workflow（GH secret） |
  | `ACCEPTANCE_API_TOKEN`（既有） | `GET /acceptance/catalog` | 保留给 catalog 消费者；**移出打表器白名单** |

- **公网 `POST /acceptance/results` 与 `GET /acceptance/pending` 本期下线**（不是加防护）。依据：这两个端点的设计消费者是 Notion Worker，而 Notion Worker 已于 07-31 停摆（决策 `fc7b5dc0`），并被决策 `efa578b8` ⑤ 与 `078b314a` 二次确认；Staff Hub 反代实测走**内网** 5221（`services/acceptance.ts:11-12`），不经 5223。**下线前置动作**：D3 开工时先核一次 5223 近 30 天访问日志，若发现非本 GP 的活跃调用方，改走候选 B 并回报主理人。
- **下线的实现形态（← P2-18）**：决策 `fc7b5dc0` 原文是「5223 公网端点与 cloudflared 路由转**休眠**（保留代码与配置备将来外部集成）」，故「下线」= **不挂载该路由 / 解挂 cloudflared 路由**，**不删码**；A2 出口10 断言在 404/401 两种形态下都成立。
- **（← P2-19）**：`createBearerAuth` 下沉到路由级后，三把钥匙**任一缺失只降级为该端点不挂载 + 启动日志告警**，不得让 `createBearerAuth(undefined)` 在建 app 时 throw 把整个 listener 拖挂（现状 `acceptance-public-server.js:12-25` 就是这个形状）。
- 误判后果：选 A/B 而保留 AI 侧持有人列写权 → 决策② 在能力层永远不成立，且「AI 伪造员工判定」这种事**数据里看不出来**；不下线公网人列写端点 → 一把泄露的 token 就能把任意一轮验收单全写成绿并放行生产。

**J20 · ⚠️「场景是否发生」的判据来源**（v5 新增，← r4-P1-2）
- 背景：v4 的分类表把 `scenario_not_triggered` 的合法性写成「该格 yaml `scenario_required == true` 且 AI 证据里无该场景」。前半是静态属性，服务端能算；**后半不是静态属性，服务端算不出来**——于是 6 格（含 3 个 hard 红线格 S5-c4/S10-c4/S13-c4）保留了「被考核者自己定考卷」的出口：AI 写 `scenario_not_triggered` 就是合法 → Q3 → 人列通过即判绿，且事后与「场景真没发生」不可区分。更硬的反证是 S4-c2：yaml S4 的 `op` 原文「冷启动客户端一次；重启手机一次，观察恢复」是**员工每轮必做的规定动作**，AI 声明「无该场景」是可证伪的假话，服务端照样放行。另一条真实触发路径：租户/页面问题导致 AI 看到空列表，它自然得出「无该场景」而不是「页面打不开」，本该进故障类被哑火判据抓住的失败，从这 6 格漏出去变成合法绿。
- 候选：
  - **A · AI 自报**（v4 现状）
  - **B · 员工现场勾选场景清单（人证）+ 人列交叉证伪（双闸）**
  - **C · 服务端直查 staging 业务表**（断网场景查采集任务 `status=interrupted`；掉线场景查 machines 表 `last_seen` 断档）
  - **D · 6 格全部摘出 AI 可判集合**
- **REC = B**（C 作为将来升级路径登记 P2-23；D 只用于 B 也够不着的格）
- 依据：
  - **A 作废**：它就是 r2-P1-3 要堵的「被考核者自己定考卷」，换了个字段名又回来了。
  - **C 现在做不了，且不能假装能做**：`packages/brain/src/zenithjoy-db.js:23-31` 那个 pool 在 `ZENITHJOY_DB_NAME` 未设时**直接返回 Brain 主 pool**，设了也只是连 Brain 所在环境配置的那个 zenithjoy 库，**与 HK staging 的业务库不是一回事**；Brain 能否读 staging 库未探明。按铁律不把地基架在未探明的通路上——若照 C 写进提案，实现期会去找一条不存在的通路，形状与 r4-P2-23 指出的「去找一个不存在的迁移源」一样。
  - **B 的两道闸缺一不可**：闸①（提交期比对员工勾选的 `detail.scenarios_observed[]`）能在 AI 提交当场拒收，但挡不住员工漏勾；闸②（`human_complete` 时人列给出确定判定即证伪）能兜住漏勾，但 AI 提交时人列还没填（Step 3 早于 Step 4），当场无从校验。两闸时机不同、覆盖的漏法不同。
  - **D 对 hard 格是倒退**：摘成 `human_only` 后该格走「人列通过 + AI 合法无法验证 = Q3 绿」，等于把 hard 格的双列保护降级成员工单列判——只在 B 也够不着时才用，且必须额外剥夺 Q3 绿通道（见 S13-c4 的处置）。
- **逐格结论见 §场景证据指针台账**。摘要：`mandatory` 2 格（S4-c2/S4-c3，场景恒发生，`scenario_not_triggered` 永不合法）／`opportunistic` 3 格（S5-c3/S5-c4/S10-c4，受双闸）／`unverifiable_this_version` 1 格（S13-c4，转 `human_only` 且绿必经裁决）。合法 `scenario_not_triggered` 的格集合由 **6 收窄到 3**。
- **呈主理人的两项（不由 AI 单方决定）**：
  1. **把 S5 / S10 的偶发场景升为规定动作**（S5 `op` 加「手动让其中一个小号退出登录/断网，制造一次掉线」；S10 `op` 加「用同一关键词再发起一次采集，对照同一视频评论是否被覆盖」）。**这是改验收标准本身**，故呈批。通过则这 3 格由 `opportunistic` 升 `mandatory`，红线9/10/11 的保护从「碰运气」变成「每轮必验」；代价 = Step 2 加约 10 分钟、Step 3 采集等待加约 8 分钟（P2-24）。
  2. **S13-c4 的处置**：本版制造「被频控限制」场景 = 故意超频发送，而 **S12-c2 本身就是一条验收判据**（yaml 原文「同设备10分钟内最多发3条；关注每小时不超10次、点赞不超15次」）——为验红线8 去违反 S12-c2 等于用一条红线换另一条，还消耗真实抖音风控额度、有封号风险。故本版 fail-closed：该格绿必经有名有姓的裁决（计入 A12 棘轮）。根治路径 = Gate B 第6条探明 staging 能否加一个把派单标记为「被限制」的受控注入开关；通了就升 `mandatory` 回 `machine_db`。
- 误判后果：留 A → 3 个 hard 红线格多了一个无名无姓、事后不可区分的绿色出口，而 J1 反复强调「hard 格唯一逃生阀是有名有姓的裁决」当场作废；只做闸① → 员工漏勾即放行；只做闸② → AI 提交期无校验，且要等到 `human_complete` 才发现，已经浪费一轮采证；照 C 写 → 实现期去接一条未探明的跨库通路，接不通就地放弃校验，退回 A；对 S13-c4 用 D 而不剥夺 Q3 → 红线8 变成「员工点一下通过就绿」，比 v4 还松。

---

## 交付物划分（按依赖排序；实现路径见 J13）

> 命名按内容不按代号。每件对应一个 `/dev` 任务，`payload.anchor` 必带 `{journey_id, gp_id, step_id}` 三件套。

**D1 · 数据层地基与状态机**（cecelia，阻塞其余全部）
AI 四列 migration（J6-A，中文枚举 + CHECK）＋ `check_key` 改规程格号 ＋ `UNIQUE (run_id, check_key)`（J5-A）＋ `submitAcceptanceResults` 全链路加 `run_id` 作用域 ＋ **规程 yaml → 36 格建单生成器**（J10-B 的排除集：`na:true` ∪ `fixedNa` 步骤全格；含 J14 的 kind）＋ **静态属性收口（← r4-P2-23 措辞纠正）**：`scenario_required` 升级为 **`scenario_class`** 三值并**从 `cells-map.mjs` 迁进 yaml**（v5 复核：`cells-map.mjs` 全文有 `scenario_required` 6 处、**无** `verifiable_by`）；**`verifiable_by` 本就在 yaml 里**（36 个建行格全带，human_only 16 / machine_db 20），本项**只按 §口径切换表改 4 格取值**（S4-c2/S7-c2/S9-c2/S13-c4 → `human_only`），**不做迁移** ＋ `backend_sha`/`frontend_sha` 双源对账与 `spec_sha`/`version` 落库（J12）＋ **run 状态机改造**（`369_acceptance_tables.sql:11` 的 CHECK 由 4 值扩到 **7 值**：`pending`/`in_review`/`human_complete`/`adjudicated`/`stale`/`expired`/`abandoned`，`passed`/`failed` 退为历史兼容值；**三个非活跃终态是 status 取值不是 detail 旗标**，A10④ 断言这一点；`status` 计算改按九组合矩阵算 `final_state` 与 `gate_verdict`，含 **Q0′ 缺格恒判「未定」** 与 **Q3″ 场景证伪**；`detail.ai_status` 记哑火并实现三条件判据）＋ **pending run 过期扫描器**（48h 未达 `human_complete` → `expired`）与显式作废端点（→ `abandoned`，留痕）＋ **建单期前置校验与逃生阀**（同 gp 上一轮 `review_closed_at` 非空，否则 409；带 `force_reason` ≥20 字则放行并留痕；单头 `tenant_account` ∈ 验收专用租户；单头 `mandatory` 场景码勾齐）＋ `review-closed` / `review-ack` 端点（含主体校验与「全员 ack 或满 24h」前置闸）。
对应 Step 1 / Step 6 / Step 7 / Step 9；解锁断言 A1 / A3 / A5 / A9 / A10 / A14 / A15 / A16 / A17。

**D2 · AI 打表器零点火化与 Gate A 机械约束**（zenithjoy 为主，cecelia 加回写端点）
**采证器删除「发起采集」交互、`action` 枚举收敛为单值 `observe`、改按 run 单头的本轮任务编号定位任务**（J17-C，Gate A 第①层）＋ 打表器 workflow（`runs-on: ubuntu-latest`，J3-B）＋ Playwright 域名 allowlist ＋ secrets 白名单与 smoke 校验（**不含 `ACCEPTANCE_API_TOKEN`**）＋ staging 后端 `GET /api/version` 暴露已有 build-info（**措辞见 P2-2**：`apps/api/src/app.ts:109,115` 已有根路径 `/version`，公网 404 是隧道只把 `/api/*` 路由到 API；本项 = 把已有 build-info 挂到 `/api` 前缀，并确认 staging 部署链真的注入了 `BUILD_SHA`）＋ **staging 前端新增 build sha 标记**（`VITE_BUILD_SHA` 注入 + 页面可读）＋ **`deploy-dashboard-staging.yml:57` 改 pin `github.sha`** ＋ 判定任务（Brain docker 内，读 artifact 截图判「屏幕所见」）＋ `POST /acceptance/ai-results` 回写端点（J19 的 AI token；reason 与静态属性的服务端强校验 + **场景闸①**，不匹配 400）＋ **采证开跑前的自检（v5 口径 ← r4-P2-24）**：判据 = `run-summary.machines_online` ≥ 1 **且**含单头 `device_model` 那台机；不满足 → 整轮 `ai_incomplete` 告警退出，不产生任何「无法验证」回写 ＋ **对全部 36 建行格回写、零缺格** ＋ **时限三格按口径处理**（基线不采；Gate B 第4条逐格通过后改读页面创建/终态/上线时间戳算差值，并把 yaml 对应格切回 `machine_db`）＋ 产物不再 commit 进 repo。
对应 Step 3；解锁断言 A4 / A11 / A16③④ / A17①。

**D3 · 背靠背裁剪与凭据分权**（cecelia + zenithjoy 反代；依赖 D1 的列存在，可与 D2 并行）
`loadChecks`/`loadRunsWithChecks` SQL 列白名单 ＋ `view` 参数与服务端 `human_complete` 校验 ＋ **gp 级跨轮闸（J2 判据②，按「活跃 run」= `status IN ('pending','in_review')` 口径，沿用 `acceptance.js:174` 现成谓词）** ＋ 9 条读侧出口逐条覆盖 ＋ 反代层同步不透传 ＋ **`createBearerAuth` 下沉到路由级、三 token 分权、公网 `POST /acceptance/results` 与 `GET /acceptance/pending` 下线**（J19，含下线前的访问日志核查、休眠而非删码、三钥匙缺失只降级不拖挂 listener）。
对应 Step 4；解锁断言 A2（读侧含两组反向断言 + 写侧）。

**D4 · 合看页、裁决、员工回显、员工表收编与分流建单**（zenithjoy 页面 + cecelia 后端；依赖 D1/D2/D3）
九组合矩阵合看页（`apps/staff-hub/src/pages/`，含 device / `scenario_class` 标记 + 第14步灰带 + **Q3″ 与缺格图例**）＋ **闸②：`human_complete` 触发时服务端重算场景交叉证伪**（reason 改写 `scenario_falsified`、落 Q3″、走裁决不走重跑）＋ `adjudication` 裁决 API 与 hard 格裁决绿自动开 P0 ＋ **`unverifiable_this_version` 格绿必经裁决的强校验** ＋ 员工侧裁决回显视图 ＋ **员工侧「我已看过裁决」ack 与异议 note**、**发起人/主理人侧「关闭复盘」按钮**（v5 ← r4-P1-3；主体分离，员工打 `review-closed` → 403）＋ 侧边栏待办角标与仪式发起通知 ＋ **建单页承接现役网页的表头字段**（测试用客户账号（做成从验收专用租户下拉选择）/手机型号/客户端编号/本轮任务编号/本轮暗号 ＋ **本轮场景清单勾选 `scenarios_observed[]`**）＋ **`lib.mjs` 收编：generate 改产只读判据说明书，去掉三态按钮，第三态措辞统一**（J18-B）＋ 聚合式分流建任务（≤1 bug + ≤1 trace、**查重谓词加 `acceptance_bucket` 维度**、anchor 三件套、非绿格占比 >1/3 熔断、AI 整轮哑火走独立 P0）。
对应 Step 2 / Step 5 / Step 6 / Step 7；解锁断言 A6 / A7 / A13 / A14 / A15 / A16① / A17②③④⑤。

**D5 · 放行闸第三证据项**（zenithjoy）
只读 gate 端点（J7-A，落 5223，J19 的 gate token）＋ `scripts/release-gate/two-column-gate.sh`（**双 sha 绑定**、`infra_error` vs `cells_red` 机械区分、`bypass_two_column_infra`、**四项棘轮计数**含 `force_reason` 强开与 S13-c4 裁决绿）＋ `two-column-gate-selftest.yml` ＋ `promote-all-prod.yml:138` 之后接线 ＋ **`promote-dashboard` 改读 `inputs.sha`**（J12-④）。
对应 Step 8；解锁断言 A8 / A12。

**Phase 2（只登记，本提案不展开）**
决策④「连续多轮双绿的格从员工表摘除、标已移交 AI 可抽查」——依赖多轮 run 历史；Kernel 融合（proposer 合同 BEHAVIOR 锚格、sprint evaluator 的 L2/L3 findings 产「新格候选」进待审池、格覆盖闸）；其余 GP 的 acceptance-spec yaml 编写（本轮只做 line02-android 一条样板）。

---

## P2 记账（不阻塞，进账本留给实现期）

> **v5 编号修正（← r4-P2-21）**：v4 表内有两条并列的 P2-16，后者（theater 闸 GP 段提取兜底）重编为 **P2-21**；全表 **24 条**（21 原有 + 3 新增）。

| # | 事项 | 证据 |
|---|---|---|
| P2-1 | 「theater 闸唯一调用方 `routes/harness.js:19`」措辞不准（结论仍成立）：另有 `orchestrator/run.js:128` 与 `scripts/harness-judge-cli.mjs:83` 两处，**三处均属 harness 链** | `harness-judge.js:690,924,933`；`routes/harness.js:19,2100`；`orchestrator/run.js:128`（已同步修正 J11 措辞） |
| P2-2 | D2 的「staging 新增 `GET /api/version`」实为把已有 build-info 挂到 `/api` 前缀：`app.ts:109,115` 已有根路径 `/version`，公网 404 是隧道只路由 `/api/*` | `apps/api/src/build-info.ts:11-13`；实测 `/api/health` 返 API 自己的 NOT_FOUND JSON（已同步修正 D2 措辞） |
| P2-3 | A7 查重谓词需加 `acceptance_bucket` 维度：既有谓词「同 run_key 无未终态任务」不区分 bucket，照抄则第二个桶永远建不出来 | `acceptance.js:99-106`（已同步写进 A7 与 D4） |
| P2-4 | bypass 棘轮到顶后无升级路径，重演 J15 否决候选 B 的理由；建议接一条有名有姓的出口（主理人在 Brain 写 `decision` 才放行） | proposal A12 / J15（已在 J15 附注登记） |
| P2-5 | 托管 runner 跑 Playwright 登录 Cloudflare 前置的 staging 未探明（先例全是 curl，无 headless chromium 完成 better-auth 登录的实证） | `deploy-dashboard-staging.yml:37,103-106`；`deploy-lib.sh:505-513` better-auth invalid origin 前科（**已前推进 Gate B 第 3 条**） |
| P2-6 | 验收窗口与 staging push-main 自动部署冲突（近 14 天 `apps/api/**` 22 次提交），本期只做组织约束 + `stale` 兜底，不做机械冻结 | `deploy-staging-hk.yml:14-20`（已在 J16 登记约束与代价） |
| P2-7 | 现行 release-gate 证据① 查 `deploy-us-vps.yml` 最近一次结论，而该 workflow 最近成功停在 2026-07-14，此后再没跑过——这条断言事实上恒绿（既有缺陷，非本提案引入） | `promote-all-prod.yml:68-80`（接第三证据项时顺带修正） |
| P2-8 | 七环对账巡检棘轮击穿：`RATCHET_PATH` 容器内解析不到 json → 静默 fallback `hard_flaw_max:0` → 生产 `ratchet_breached=true` 恒真且只 console.warn 无人消费 | `explore-report.md:100`，`seven-ring-audit.js:16,183` |
| P2-9 | `harness-evaluator` skill 三处版本分叉：cecelia 内 1.35.1 / SSOT 1.33.0 / dist 快照 1.32.2 且不含人形协议段 | `explore-report.md:113,188` |
| P2-10 | 员工验收网页部署仍是手工 scp，CI 只保证 repo 内一致、不保证服务器那份 = repo 那份（J18-B 收编后风险降级但未消除） | `explore-report.md:76`，`cli.mjs:47` |
| P2-11 | Staff Hub 详情页拉全量 pending 再前端 `find`，已有的 `GET /runs/:run_key` 端点闲置（D3 改造后应切过去） | `explore-report.md:45`，`AcceptanceDetailPage.tsx:36` |
| P2-12 | cecelia 侧 `promote-all-prod.yml` 与 `scripts/release-gate.mjs` 均为事实死代码，建议明确废弃或接线 | `explore-report.md:97,101` |
| P2-13 | `line02-android-collect-realmachine-smoke.sh:49` 的 `awk` 只抓第一台设备，多机型矩阵能力缺失 | `explore-report.md:163` |
| P2-14 | evaluator `android_realmachine` 分支半成：skill 有派发逻辑但 Brain 侧 `ANDROID_REALMACHINE_WORKFLOW` 零命中，目标 workflow 两 repo 都不存在，真派必 FAIL | `explore-report.md:162` |
| P2-15 | harness 主链的 `base_repo` / `target_environment` 均为不可覆盖常量，任何跨 repo 或需真浏览器的 GP 都走不通（本 GP 靠 J13 绕开，下一条同类 GP 会再撞一次） | `golden-path-contract-task.js:1-2`，唯一消费点 `golden-path-contracts.js:397-398` |
| P2-16 | 双 sha 绑定仍可被并发部署穿透：staging 后端、staging 前端、生产 promote **三条** workflow 共用 HK 同一个 `/opt/zenithjoy/repo`。任一 staging 部署落在 promote 的 `reset` 与 `docker build` 之间，生产就会用另一棵树构建，而闸只断言 `PROMOTE_SHA` == 验收单 sha，断言仍绿。J16 的「验收窗口内暂停合并」组织约束部分缓解；实现期建议改用 `git worktree` 或按 sha 建独立构建目录 | `deploy-staging-hk.yml:57,61`；`deploy-dashboard-staging.yml:51,57`；`promote-all-prod.yml:181-190,222-229` |
| P2-17 | 5223 是 AI 回写与闸取数的**共同**前提；回写侧不通则采证结论无处落库、两列制当轮只剩一列。**已在 Gate B 第1条补写回写侧回落**（artifact + Brain docker 内判定任务经内网 5221 落库）。本机实测公网 `/acceptance/catalog` 返 401（隧道活着、鉴权墙在） | `acceptance-public-server.js:46-58`；A2 出口11；实测公网 401 |
| P2-18 | 「公网人列写端点下线」的**实现形态**要与决策 `fc7b5dc0` 原文对齐：原文是「转**休眠**（保留代码与配置备将来外部集成）」，故下线应实现为**解挂路由 / 不挂载该 router，不删码** | 决策 `fc7b5dc0` 原文；`packages/workflows/notion-acceptance-worker/README.md:11,35`；`docs/current/acceptance-endpoint-deploy.md`「Worker 侧」 |
| P2-19 | 三 token 分权后 5223 listener 的 **fail-closed 启动判据**需同步改造：`startAcceptancePublicServer` 只判 `ACCEPTANCE_API_TOKEN`，而 `createBearerAuth` 在 token 为空时直接 `throw` → 只注入两把钥匙就会在建 app 时抛错，整个 listener 起不来，失败形态从「少一个端点」放大成「公网面全挂」。已进 Gate B 第2条确认项 | `acceptance-public-server.js:12-25,46-52`；J19 落法表 |
| P2-20 | 决策② 后半句「AI 列后台**先行完成**」的顺序**无机械闸**，只靠 Step 2/3/4 的步骤拆分。之所以不阻塞：两列独立性由 J19 的 token 分权物理保证（AI token 只写 ai-results、读不到 checks；Staff Hub staging 只绑 Tailscale 公网不可达；5223 读端点下线），顺序颠倒不造成反向锚定，损失的只是仪式次序。实现期建议顺手加一条「run 未记录 `ai_run_at` 时人列提交 409」 | J17 误判后果；J19 token 表；`deploy/staff-hub/nginx-staging.conf:1` |
| **P2-21**（← r4-P2-21 重编，原为第二条 P2-16） | theater 闸 GP 段提取兜底：`sprint-prd.md` 无 `## Golden Path` 标题则扫全文，且 `###` 子标题不终止段落 | `harness-judge.js:796` |
| **P2-22**（v5 新增，← r4-P1-2 副产品） | **`scenario_falsified` 计数无消费者**：闸② 每证伪一次说明 AI 在该格的场景采证方法不可靠，但本提案只让它拦当轮的闸，没有横向观测。建议实现期加一条「同一格近 N 轮反复被证伪 → 自动开 P0 查该格采证方法」，否则同一个错误会每轮消耗一次主理人裁决而没人去修根因（形状同 P2-8 的「棘轮击穿但无人消费」） | 本提案 §熔断与哑火判据 v5 附注；Q3″ 行；A17⑥ |
| **P2-23**（v5 新增，← r4-P1-2 核查副产品） | **Brain 服务端直查 staging 业务表的通路未探明**：`zenithjoy-db.js:23-31` 的 pool 在 `ZENITHJOY_DB_NAME` 未设时直接返回 Brain 主 pool，设了也只连 Brain 所在环境配置的那个库，**不等于 HK staging 的业务库**。故本 GP 的全部场景证据指针只落本地表（`acceptance_runs.detail` / `acceptance_checks`）。若将来打通该通路，`opportunistic` 格的闸① 可由「员工勾选」升级为「服务端直查」（掉线场景查 machines `last_seen` 断档、中断场景查采集任务 `status`），`unverifiable_this_version` 格亦可能翻身——届时应重开 J20 | `packages/brain/src/zenithjoy-db.js:9-31`；`packages/brain/src/__tests__/zenithjoy-db.test.js:5` |
| **P2-24**（v5 新增，← J20 呈批项 2 的代价） | **规程 `op` 加厚的仪式代价未进 J16 工时表的正式估算**：若主理人批准把 S5（制造一次小号掉线）与 S10（同关键词二次采集）的偶发场景升为规定动作，Step 2 现场操作加约 10 分钟、Step 3 采集等待加约 8 分钟，员工工时上限从 1.5 人时/轮升到约 1.7。批准后须同步改 J16 的工时段与发版人排期口径 | 本提案 J20 呈批项 2；J16 工时段；yaml S5.op / S10.op 原文 |







