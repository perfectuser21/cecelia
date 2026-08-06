# 发版验收一体两面——F2 步2 加厚「一张表两列背靠背合着看」Golden Path v1

提案人：Cecelia（AI）。v1，尚未经三镜头对抗。

- **归位**：工厂 · F2 部署闭环（journey `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`）· 步2「部署被证明没坏」· 动作=**加厚**（非新路）
- **GP_ID**：`7790f728-f490-4243-b166-03f3250a0938`（golden_paths，candidate）
- **法源**：决策 `fdeb48aa` 六条（一字为法，本提案不得改写其语义）
- **现状依据**：`.harness/explore-report.md`（下文标注一律引用它的行号 + 它引用的源文件行号）

---

## 0. 口径纠偏（写在最前，避免下游沿用错数）

| 项 | 旧口径 | 本提案口径 | 依据 |
|---|---|---|---|
| 格数 | 52 格 | **56 个格位 / 37 个有效格**（na:true 19 个，含 S14 整步 fixedNa） | explore-report.md:12 → `zenithjoy-workspace/acceptance-spec/line02-android.yaml` v2.1.19 |
| 有效格构成 | — | `machine_db` 20 + `human_only` 17 | explore-report.md:72 |
| AI 能力天花板 | 隐含"AI 能打满" | **14 确定 + 6 条件（scenario_required） + 17 恒 unverifiable** | explore-report.md:150-155 → `ai-run/cells-map.mjs` 正好 20 格 |
| 红线格 | — | `hard:true` 8 个 | explore-report.md:73 |
| 放行闸落点 | cecelia `promote-all-prod.yml` | **zenithjoy `promote-all-prod.yml` 的 `release-gate` job** | explore-report.md:96-104；cecelia 那条 `gh run list` 返回空，从未跑过 |
| HK 数据流 | 探索报告标"存疑/半成"（:62） | **已解除**：explorer 后续实测 `zenithjoy-api-prod` 的 `CECELIA_BRAIN_URL` 指向 HK 宿主 5221 且返回真实 pending 数据 | 实测优先于 :62 的 grep 推断 |

PRD 草案（`memory/acceptance-one-table-prd.md`）里判定点②的「C+B 混合 / curl / psql 直跑」方案，与决策⑤「判据=屏幕所见非查库」冲突，**本提案按决策⑤作废该建议**（见 J3）。

---

## Gate A · 边界硬约束（不是探索 Gate，是开工即生效的禁令）

**AI 打表器只走 staging 后台网页，不碰真机、不发私信、不触达任何真实抖音/微信账号。**

真实接缝清单（explore-report.md:136-144）里的 7 条接缝，本 GP **一条都不碰**：安卓真机私信执行（S12 四格）、真实对外触达（S11→S12→S13）、红线7 暗号不重发、频控风控红线、真实评论抓取产生线索、真机在线/掉线场景、公开评论区回复（S14 整步 na）。

按「三层规范模型」（记忆 `judge-closure-arbitration-shipped` 的 08-06 教训：纯提示词条款会被采样漂移击穿）逐层落实，缺一层视为 Gate 未过：

| 层 | 落法 |
|---|---|
| 提示词层 | 打表器 skill 段写死「只可访问 `https://staging-autopilot.zenjoymedia.media`；禁止 adb/UIA/私信/任何写操作以外的真实触达」 |
| 断言层 | 验收断言 **A4**（17 个 human_only 格 ai_verdict 恒 unverifiable，一条 SQL 判 0） |
| 代码闸层 | 打表器只吃 `cells-map.mjs` 的 20 格白名单（`capture.mjs:61-67` 已有 `checkCellsMapComplete` 不 1:1 直接 exit 1，explore-report.md:111）；白名单外格号一律拒绝执行并写 unverifiable |

**S12 全 4 格 + S13-c1/c3 等需安卓真机的 6 格，AI 列恒为 `unverifiable`，不允许出现 pass**——这不是能力不足的遗憾，是 Gate A 的设计输出。

## Gate B · 前置探明（开工第一件事，半天内出结论，不过则改道）

**放行闸第三证据项的取数通路是否存在？** GitHub ubuntu runner 在公网，双表数据在美国 Mac 的 PG 里。已知有一个公网验收 router 挂 5223（fail-closed，无 `ACCEPTANCE_API_TOKEN` 不启动，`acceptance-public-server.js:47-57`，explore-report.md:39），但它原本服务 Notion Worker 通道，而 Notion Worker 已停摆（记忆 `acceptance-endgame-staff-hub`）——**该端口是否还在跑、是否公网可达，未经实测**。

- 结论 **通** → 按 J7 的 REC 走（新增一个只读 gate 端点）。
- 结论 **不通** → 走 J7 备选 B（Brain 定案时反向 push 一个 commit status / gate 文件到 zenithjoy repo），交付物 D4 的工期与形态随之变化。
- 两条都不通 → 第三证据项降级为「人工在 `waive_two_column` 输入框填理由」，并升级给主理人重新拍板是否接受。

---

## Golden Path 步骤

主体：**发版人 / 验收员工 / 主理人**。步骤名写「他感知到什么」，工序细节全部下沉到【挂片】【分支/判定点】。

| 步骤（承诺） | 现状 | 验证等级承诺 | 【挂片】 | 【分支/判定点】 |
|---|---|---|---|---|
| **Step 1** 发版落 staging 当天，主理人就能看到这一版专属的一张验收单，单头写着它验的是哪个构建 | **半成** | L2（服务端真验） | run 建单端点幂等(已有，`routes/acceptance.js:183`，explore-report.md:47)／37 有效格从规程展开成行(**缺失**，explore-report.md:177 缺口1.5)／构建号写进单头(**缺失**，两轮实跑 `backend_sha` 恒 `"unknown(健康端点未暴露构建号)"`，explore-report.md:87)／部署成功→建单的触发接线(**缺失**) | 分支：同构建已有 run → 幂等复用不重开。判定点 **J5**（格号）／**J10**（na 格是否建行）／**J12**（冻结锁校验强度） |
| **Step 2** 员工上班之前，AI 已经把它能在网页上看见的那部分先看过一遍；看不见的它老实说看不见 | **半成** | **L3（真环境真验）** | 采证器走真 staging UI + 截图 + `innerText` 文本快照(**已有且有 2 轮真实产物**，`ai-run/capture.mjs:32,54-57`，explore-report.md:110)／常驻登录凭据(已有，1Password CS「ZenithJoy AI验收账号」，`capture.mjs:14`+`login.mjs:51`，explore-report.md:83)／自动触发(**缺失**，全仓无 workflow/npm script，`capture.mjs:236` 硬编码 `trigger:'manual'`)／结论回写同一张表(**缺失**，产物落 `acceptance-spec/runs/*/ai-column.json` 与 DB 零通路，explore-report.md:33,185)／unverifiable 恒真规则(**缺失**，explore-report.md:189 缺口2.7) | 分支：某格页面打不开/超时 → 该格 unverifiable 并留失败截图，不中断整轮。判定点 **J3**（执行体与判据）／**J4**（诚实边界）／**J11**（剧场闸措辞） |
| **Step 3** 员工打开验收页，看到的还是那张熟悉的表；AI 那一列此刻对他根本不存在，翻 F12 也翻不出来 | **半成** | L2（服务端真验） | 三个页面(**已有**，`AcceptancePage.tsx`/`AcceptanceDetailPage.tsx`/`AcceptanceHistoryPage.tsx`，路由 `App.tsx:66-68`，explore-report.md:56-58)／分批草稿增量提交(已有能力)／`submitted_by` 防伪注入(**已有且有测试**，`middleware/staff.ts:44`→`staff.ts:338`，explore-report.md:60)／**服务端列裁剪(完全缺失——三跳全裸**：Brain `SELECT *` `acceptance.js:157,164` → 反代整数组直出 `services/acceptance.ts:52` → 路由整包展开 `staff.ts:319`，explore-report.md:48) | 分支：员工只填一半离开 → 草稿按子集留存（既有）。判定点 **J2**（AI 列可见时机）／**J6**（存储形态与裁剪位置） |
| **Step 4** 员工把最后一格交上去的那一刻，两列一起亮出来，哪些一致、哪些打架，一眼看清 | **缺失** | **L3（真浏览器真页面截图）** | 四象限合看页(**缺失**，全仓 grep「对比页\|四象限」在非 md 文件零命中，explore-report.md:205)／解锁条件=人列 37 格齐(**缺失**)／AI 列不全时的降级态(**缺失**) | 分支：AI 列缺格 → 该格显示"仅人列"，不算分歧也不算双绿。判定点 **J1**（双表绿分母）／**J8**（这页从哪打得开） |
| **Step 5** 打架的格子主理人当场拍板；拍完这一版验收就有了定论，定论跟着构建号存档 | **缺失** | L2（服务端真验） | `adjudication` 字段与裁决 API(**缺失**，`\d acceptance_checks` 无此列，explore-report.md:32,206)／裁决人与理由留痕(**缺失**) | 分支：双红/裁决红 → bug 任务；AI 绿人红 → 追查任务（优先信人）。判定点 **J1** |
| **Step 6** 发版人点 promote 的时候，如果这一版的表没绿，闸当场拦住他，并且直说卡在哪几格 | **缺失** | **L3（真闸真跑）** | `release-gate` job 三步式结构(**已有且真在用**，5 次真实 workflow_dispatch，`promote-all-prod.yml:59-138`，explore-report.md:96)／证据②已提供「分级不阻塞 + `waive_nightly` 豁免」成熟范式可照抄(`:82-138`)／第三证据项(**缺失**，落点 `:138` 之后新增 step，explore-report.md:104,207) | 分支：取数失败 = **红**（fail-closed），带 `waive_two_column` 逃生阀（谁豁免谁负责，照抄 `:84-93`）。判定点 **J7**（取数通路）／**J9**（怎么验闸而不真发版） |
| **Step 7**（出错路径）任何一步塌了，主理人在验收单上就看得见是哪一步塌的，并且能重开一轮而不丢上一轮的留痕 | **缺失** | L2（服务端真验） | run 的 `ai_incomplete` / `stale` 状态(**缺失**)／同 GP 多轮 run 并存(**当前物理不可能**——`check_key` 全局 UNIQUE，第二轮建单必 23505，`acceptance_checks_check_key_key`，explore-report.md:16,175) | 分支：验收期间 staging 被重新部署 → run 标 `stale`，人列提交被拒，必须重开新 run。判定点 **J12** |

### 出错路径的用户视角（发现 → 恢复）

| 故障 | 用户怎么发现 | 怎么恢复 |
|---|---|---|
| AI 打表器中途挂 | 验收单头显示「AI 列不完整（已完成 N/20）」 | 员工照常填；四象限对缺格降级"仅人列"；可单独重跑打表器补格 |
| staging 在验收中途被重新部署 | 提交人列时被拒，页面提示「本单验的构建已失效」 | 重开新 run（新构建号），旧 run 存档为 `stale`，留痕不删 |
| 放行闸取不到双表数据 | promote 时 release-gate 红，summary 写明「双表取数失败」 | 修通路后重跑；紧急发版填 `waive_two_column` 理由（进 summary 大字留痕） |
| 员工与 AI 全格分歧 | 四象限页整列变分歧色 | 先怀疑打表器（如登录失效导致整轮空跑），核 AI 列证据截图是否为登录页 |

---

## 验收断言（A1-A8，冻结后 AI 不可改）

对齐 PRD `Final E2E` 五条，按 37 格口径修正并补足可执行判据。

**A1 · 一张表两列（决策①）**
同一 run 同一格是一行两列，不是两张表：
```sql
SELECT check_key, result, submitted_by, ai_verdict, ai_run_at
FROM acceptance_checks WHERE run_id = :rid AND check_key = 'S3-c1';
```
断言：返回 **恰 1 行**；`result` 与 `ai_verdict` 均非空；`check_key ~ '^S\d+-c[1-4]$'`；且 `SELECT count(*) FROM acceptance_checks WHERE run_id=:rid` = **37**。

**A2 · 背靠背（决策②，服务端裁剪而非前端隐藏）**
三处同时为 0，缺一不可：
```bash
curl -s "$STAFF_HUB/api/staff/acceptance/pending"        | grep -c -E 'ai_verdict|ai_evidence|ai_run_at'   # == 0（反代层）
curl -s "localhost:5221/api/brain/acceptance/pending"     | grep -c -E 'ai_verdict|ai_evidence|ai_run_at'   # == 0（直连 Brain 内网，防"只在反代裁"）
curl -s -o /dev/null -w '%{http_code}' "…/acceptance/runs/$RUN_KEY?view=review"                            # == 403（人列未满时合看态被拒）
```

**A3 · 第二轮不炸（`check_key` UNIQUE migration 的直接证据）**
对同一 GP 连续建两个不同构建的 run，两轮各 37 行、**无 23505**：
```sql
SELECT count(*) FROM acceptance_checks WHERE check_key = 'S3-c1';  -- >= 2
SELECT count(DISTINCT run_id) FROM acceptance_checks WHERE check_key = 'S3-c1';  -- >= 2
```
并断言约束本身已改：`\d acceptance_checks` 中存在 `UNIQUE (run_id, check_key)`，不存在全局 `UNIQUE (check_key)`。

**A4 · AI 诚实边界（Gate A 的机械化，决策⑤）**
```sql
-- 17 个 human_only 格 + 未触发场景的条件格，AI 列不得出现 pass
SELECT count(*) FROM acceptance_checks
WHERE run_id = :rid AND check_key IN (:human_only_37_list) AND ai_verdict <> 'unverifiable';  -- == 0
-- AI 给出确定判定的格数上限
SELECT count(*) FROM acceptance_checks WHERE run_id=:rid AND ai_verdict IN ('pass','fail');   -- <= 20
```
且每个 `ai_verdict='unverifiable'` 的格，`ai_evidence` 必须含不可验证原因（`human_only` / `scenario_not_triggered` / `page_unreachable` 之一），非空串。

**A5 · 四象限合看 + 裁决落库（决策③）**
截图证据 3 张：① 四色矩阵全貌（四象限各至少 1 格有色，含"仅人列"降级态图例）；② 一个分歧格展开，左侧 AI 证据（截图缩略 + 文本片段）右侧员工 note 并排；③ 点裁决后的确认态。加 psql：
```sql
SELECT adjudication->>'verdict', adjudication->>'by', adjudication->>'reason', adjudication->>'at'
FROM acceptance_checks WHERE run_id=:rid AND adjudication IS NOT NULL;  -- 四字段全非空
```

**A6 · 四象限分流建任务（决策③ + 记忆 `manual-task-post-anchor-trap`）**
双红/裁决红 → bug 任务；AI 绿人红 → **追查**任务（不同 title 前缀，可 psql 区分）；双绿/仅人列绿 → 不建任何任务。
```sql
SELECT payload->'anchor'->>'journey_id', payload->'anchor'->>'gp_id', payload->'anchor'->>'step_id'
FROM tasks WHERE payload->>'acceptance_run_key' = :run_key;  -- 三件套全非空，每行都是
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key;  -- == 双红数 + AI绿人红数
```

**A7 · 放行闸第三证据项（决策⑥，闸必须是活的）**
在 zenithjoy 真跑一次 `promote-all-prod.yml`（按 J9 的 dry-run 方式，**不真发版**），`gh run view --log` 中：
- 「证据③ 双表绿」step 真实执行且出现在日志；
- 双表未定案时 **exit 1** 且 `::error::` 指名卡在哪几格（格号可见）；
- 定案后同一 step 绿；
- 取数失败时红且 `GITHUB_STEP_SUMMARY` 有 fail-closed 说明。
四种情形四条日志，缺一不算。

**A8 · 冻结切面（决策⑥）**
```sql
SELECT version, detail->>'backend_sha' FROM acceptance_runs WHERE id = :rid;  -- backend_sha 非 'unknown' 且为 40 位/短 sha
```
且构造一次 staging 重新部署后，人列提交返回 409 且 run 状态转 `stale`（curl 状态码 + psql 双证）。

---

## 判定点登记表（J1-J12，批准即写 decisions 冻结）

**J1 · ⚠️「双表绿」放行判据的分母**
- 候选：A 37 格全双绿 ／ B 20 个 machine_db 格双绿 + 17 human_only 由人列独判 ／ C 只看 8 个红线格
- **REC = B（分层判据）**：① 14 个确定 machine_db 格必须 AI 与人**双 pass**；② 6 个 `scenario_required` 格——场景触发则按双绿判，未触发则 AI 标 unverifiable、人列独判，且 run 上必须有「场景未触发」显式标记；③ 17 个 human_only 格由人列独判无「不通过」；④ 8 个 `hard:true` 红线格任一红 → 闸红且**不可 waive**。
- 依据：AI 天花板是 14 确定 + 6 条件 + 17 unverifiable（explore-report.md:150-155），**A 物理不可达**，写进闸等于闸恒红；C 漏掉非红线格的实锤缺陷。
- 误判后果：选 A → 闸永远拦着，三次之后必被 waive 成摆设（`release-gate.mjs` 死代码前车之鉴，explore-report.md:101）；③ 若允许"场景未触发"隐式跳过而不留标记，会变成洗白红格的后门。

**J2 · ⚠️ AI 列可见时机**
- 候选：A 员工逐格提交后该格解锁 ／ B 人列全表提交后四象限页统一解锁
- **REC = B**
- 依据：A 需要把裁剪粒度从 run 级降到格级，`loadRunsWithChecks` 的 `SELECT *` 要改成逐格状态机（explore-report.md:48），漏洞面显著扩大；且员工看到前面格的 AI 判定会污染后面格的独立性——决策②「防锚定」的原意。
- 误判后果：选 A 且裁剪漏一处，整轮双列独立性作废，这一轮验收数据不可用且**事后无法察觉**。

**J3 · ⚠️ AI 打表器的执行体与判据**
- 候选：A mac_web 环境的 Claude + Playwright（复用 `capture.mjs`），判据=屏幕所见 ／ B zenithjoy GitHub workflow 跑 capture 后另派 AI 判官任务 ／ C Brain 内置脚本 curl/psql 直跑（PRD 原建议）
- **REC = A**，B 作为吞吐不够时的补充
- 依据：决策⑤字面「判据=屏幕所见非查库」直接**作废 C**；mac_web 是唯一能开真浏览器的执行环境（`spawn.js:66-68` 绕 docker 走 host，`host-executor.js:4-6` 原文「Playwright 可访问真实浏览器」，explore-report.md:114），且 evaluator 已有成熟的视觉自验闭环（拷 PNG 到 SPRINT_DIR 用 Read tool 逐张判，explore-report.md:115）。
- 误判后果：GP 合同默认永远生成 `local_api`（`golden-path-contract-task.js:2` 硬编码，explore-report.md:186），不显式改就拿不到真浏览器，打表器会静默退化成查库——**违反决策⑤且外观上看不出来**。

**J4 · ⚠️ 不可自动化格的 AI 列**
- 候选：A 标 `unverifiable` 留空 ／ B 硬跑给低置信判定
- **REC = A**，且靠断言 A4 机械保证，不靠提示词自觉
- 依据：`cells-map.mjs:14` 已明规「场景未出现必须判无法验证，不许假绿」（explore-report.md:151）。
- 误判后果：选 B 会制造假 AI 判定污染交叉验证——四象限的全部价值来自两列独立，AI 列一旦掺水，"双绿定案"就是自欺。

**J5 · ⚠️ 格号统一方案**
- 候选：A `check_key` 直接存规程格号 `S{n}-c{m}` + 约束改 `UNIQUE (run_id, check_key)` ／ B 保留 `{run_key}:{S{n}-c{m}}` 拼接键
- **REC = A**
- 依据：决策①字面「一份规程一套格号」；B 每次 join AI 列都要字符串切割，等于格号仍是两套。
- 误判后果：不动 UNIQUE 约束 → 第二轮 run 建单立刻 23505（`acceptance_checks_check_key_key`，explore-report.md:16），本 GP 的多轮验收物理不成立；这是**必须写进合同的一条 migration**。

**J6 · ⚠️ AI 列的存储形态与裁剪实现位置**
- 候选：A 新增四个真列（`ai_verdict`/`ai_evidence`/`ai_run_at`/`adjudication`）+ SQL 层列白名单 ／ B 塞进已有的 `detail` jsonb 空壳（零 migration）+ 应用层删键
- **REC = A**
- 依据：`detail` 列全库 0 条有值确实是可征用空壳（explore-report.md:30），但裁剪要的是**默认不泄露**——列白名单 SQL 天然满足「新增列不会自动泄露」，jsonb 方案则要逐子键 delete，新增一个子键忘了删就漏。裁剪必须在 Brain 的 SQL 层做（`acceptance.js:151,157,164`），反代层（`services/acceptance.ts:52`）同步白名单作双保险。
- 误判后果：选 B 或只在反代裁 → 任何人直连 Brain 内网 5221 即拿到 AI 列，决策②的「防 F12」形同虚设，且断言 A2 的第二条 curl 会当场戳穿。

**J7 · ⚠️ 放行闸第三证据项的取数通路**（Gate B 的结论落点）
- 候选：A GitHub runner curl 公网验收 API（5223 fail-closed router 加一个只读 gate 端点，token 走 GH secret） ／ B Brain 在 run 定案时反向 push commit status / gate 文件到 zenithjoy repo ／ C runner 经 Tailscale 连 HK 再转发
- **REC = A**（前提 Gate B 探明 5223 在跑且公网可达），否则 B
- 依据：A 复用已有 fail-closed 公网 router（`acceptance-public-server.js:47-57`，explore-report.md:39）；C 需要在 GitHub runner 上装 Tailscale，跨账号凭据链最长。
- 误判后果：取不到数时如果**默认放行**，闸就是装饰；必须 fail-closed（取不到=红）+ `waive_two_column` 逃生阀，照抄证据② 的 `waive_nightly` 范式（`promote-all-prod.yml:84-93`）。

**J8 · ⚠️ 四象限页从哪打得开（断言 A5 的物理前提）**
- 候选：A 本机 mac_web 经 Tailscale 打 Staff Hub staging（`100.86.118.99:8091`） ／ B 临时开公网入口 ／ C 本地起 staff-hub dev server 连生产 Brain
- **REC = A**
- 依据：Staff Hub staging **公网不可达**——`deploy/staff-hub/nginx-staging.conf:1-4` 注释原文「只绑 Tailscale IP，公网不可达」，compose 显式绑 `100.86.118.99:8091/9444`（explore-report.md:85）；本机有 Tailscale 通路（HK VPS 日常经 `100.86.118.99` 访问）。
- 误判后果：默认按公网写 E2E → 连不上，A5 的三张截图永远拿不到，最后被降级成"页面代码 review 通过"这种空话验收。

**J9 · ⚠️ 放行闸怎么验证而不真发一次版**
- 候选：A 给 `promote-all-prod.yml` 加 `dry_run` input，为 true 时 `promote-backend`/`promote-frontend` 跳过，只跑 `release-gate` ／ B 把证据③ 逻辑抽成独立脚本 `scripts/release-gate-two-column.sh`，喂真实 run 数据直跑验 exit code ／ C 真跑一次 promote
- **REC = A + B 同时做**（脚本承载逻辑与单测，dry_run 证明它在 workflow 里真被调用）
- 依据：`release-gate` 是「一 step 一 `run:`」串行结构，第一步二次确认闸 `confirm != PROMOTE` 就 exit 1（`:59-66`），后续 step 根本不执行；而 `promote-backend` 是 `needs: [release-gate]`，release-gate 一绿就真发版。所以既不能不填 PROMOTE，也不能真填。
- 误判后果：选 C = 为了验闸做一次不可逆生产发布；只做 B 不做 A = 脚本活着但 workflow 里没接线，重演 `release-gate.mjs` 全仓只被自身测试引用的死代码剧本（explore-report.md:101）。

**J10 · ⚠️ 19 个 na 格是否建行**
- 候选：A 只为 37 有效格建行，na 格由页面从规程渲染成灰格 ／ B 56 格全建行、na 格标 `result='na'`
- **REC = A**
- 依据：`pass_rate` 分母不能被 na 污染（生产现存 run `pass_rate=0.182` 就有这个味道，explore-report.md:28）；断言 A1 的"恰 37 行"也依赖此。
- 误判后果：选 B 则「双表绿」的分母天然含 19 个永远不参与判定的格，闸的语义变糊；且四象限页要为 na 格再造一个第五色。

**J11 · ⚠️ 剧场闸（theater_mismatch）与 android 词的冲突规避**
- 候选：A 措辞分区——`sprint-prd.md` 的 `## Golden Path` 段与合同 `[BEHAVIOR]`/`Test:` 行里不出现真机关键词，真机边界写进 `## Gate/范围边界` 等**不被扫描**的段落 ／ B 改 `harness-judge.js` 加白名单例外 ／ C 整条 GP 挂 `windows_wechat` 真机环境
- **REC = A**
- 依据：闸只扫两处——`sprint-prd.md` 的 `## Golden Path` 段（正则 `/##\s*Golden\s*Path[^\n]*\n([\s\S]*?)(?=\n##\s+|$)/i`）与 `contract-draft.md` 含 `[BEHAVIOR]`/`Test:` 的行（`harness-judge.js:783-822`），关键词表含 `真机`/`RPA`/`adb`/`android`（`:185-188`），轻量环境集合 `{local_api, mac_web}`（`:191`）。`THEATER_KEYWORDS_EXTRA` 只能加词不能减词，B 不可行。**关键：A 不是规避而是如实表述**——本 GP 的 AI 打表器确实不碰真机（Gate A），GP 段里本就不该出现真机动作；诚实性由断言 A4 的机械 SQL 保证，不靠措辞。
- 误判后果：不做分区 → 合同一提交 `theater_mismatch` FAIL，整条流水线卡死且原因看起来像"闸误杀"，会诱导下一个人去改闸（B），把一道正确的闸拆了。

**J12 · ⚠️ 冻结锁的校验强度**
- 候选：A 建 run 时记 `backend_sha`，AI 打表与人列提交**都校验**，sha 变了拒收并标 `stale` ／ B 只记录不校验（事后可追溯）
- **REC = A**
- 依据：决策⑥「验收站位=staging 冻结切面」——不校验就没有"切面"，只有"大概那几天的 staging"。前提是先让 health 端点暴露构建号（现在 `backend_sha` 恒 `unknown`，explore-report.md:87），这是 Step 1 的挂片。
- 误判后果：选 B → 验收中途一次部署，两列判的是不同版本，"双表绿"证明的是一个从未存在过的切面；而且这种污染**在数据里完全看不出来**。

---

## 交付物划分（按依赖排序）

> 命名按内容不按代号（记忆 `feedback_no_knife_jargon_rightsize_decomp`）；括号内标注决策 fdeb48aa 原文口径，便于对账。

**D1 · 数据层地基**（原文「刀1」，GP 描述未列但**必须前置**，阻塞其余三件）
AI 四列 migration（J6-A）＋ `check_key` 改规程格号 ＋ `UNIQUE (run_id, check_key)`（J5-A，explore-report.md:175）＋ 规程 YAML → 37 格建单生成器（缺口 1.5）＋ 构建号/版本戳落库（J12）。
对应 Step 1、Step 7；解锁断言 A1/A3/A8。

**D2 · AI 打表器**（原文「刀2」，依赖 D1 的列与格号）
自动触发接线（缺口 2.1）＋ mac_web 真浏览器走 staging UI 判定（J3-A，复用 `capture.mjs` 与 evaluator 视觉自验闭环）＋ `POST /acceptance/ai-results` 回写端点（缺口 2.3）＋ Gate A 三层落实（白名单/unverifiable 恒真/A4 断言）。
对应 Step 2；解锁断言 A4。

**D3 · 背靠背裁剪**（原文「刀3」，依赖 D1 的列存在；可与 D2 并行）
Brain SQL 层列白名单 + `view` 参数（缺口 3.1/3.2）＋ 反代层同步不透传（缺口 3.3）＋ 合看态解锁条件（J2-B）。
对应 Step 3；解锁断言 A2。
（原探索报告列为前置阻塞的 HK `CECELIA_BRAIN_URL`，已由实测解除，见 §0。）

**D4 · 四象限、裁决与放行闸**（原文「刀4」，依赖 D1/D2/D3 全部）
四象限合看页（缺口 4.1，页面落 `apps/staff-hub/src/pages/`）＋ `adjudication` 裁决 API（4.2）＋ 按象限分流建任务并补 `payload.anchor` 三件套（4.4/4.5）＋ 放行闸第三证据项（4.3，落 `promote-all-prod.yml:138` 之后）＋ J9 的 dry_run + 独立脚本。
对应 Step 4/5/6；解锁断言 A5/A6/A7。

**Phase 2（只登记，本提案不展开）**
决策④「连续多轮双绿的格从员工表摘除、标已移交 AI 可抽查」——依赖多轮 run 历史数据，物理上要等 D1-D4 跑满数轮之后；Kernel 融合（proposer 合同 BEHAVIOR 锚格、sprint evaluator 的 L2/L3 findings 产"新格候选"进待审池、格覆盖闸）；其余 GP 的 acceptance-spec YAML 编写（本轮只做 line02-android 一条样板）。

---

## P2 记账（不阻塞，进账本留给实现期）

| # | 事项 | 证据 |
|---|---|---|
| P2-1 | 七环对账巡检棘轮击穿：`RATCHET_PATH` 容器内解析不到 json → 静默 fallback `hard_flaw_max:0` → 生产 `ratchet_breached=true` 恒真且只 console.warn 无人消费 | explore-report.md:100，`seven-ring-audit.js:16,183` |
| P2-2 | `harness-evaluator` skill 三处版本分叉：cecelia 内 1.35.1 / SSOT 1.33.0 / **dist 快照 1.32.2 且不含人形协议段** | explore-report.md:113,188 |
| P2-3 | 员工验收网页部署仍是手工 scp，CI 只保证 repo 内一致、不保证服务器那份 = repo 那份 | explore-report.md:76，`cli.mjs:47` |
| P2-4 | Staff Hub 详情页拉全量 pending 再前端 `find`，已有的 `GET /runs/:run_key` 端点闲置 | explore-report.md:45，`AcceptanceDetailPage.tsx:36` |
| P2-5 | cecelia 根 `playwright.config.ts:4` 指向不存在的 `./sprints/tests`，是死配置 | explore-report.md:117 |
| P2-6 | cecelia 侧 `promote-all-prod.yml` 与 `scripts/release-gate.mjs` 均为事实死代码，建议明确废弃或接线 | explore-report.md:97,101 |
| P2-7 | `line02-android-collect-realmachine-smoke.sh:49` 的 `awk` 只抓第一台设备，多机型矩阵能力缺失 | explore-report.md:163 |
| P2-8 | evaluator `android_realmachine` 分支半成：skill 有派发逻辑但 Brain 侧 `ANDROID_REALMACHINE_WORKFLOW` 零命中，目标 workflow 两个 repo 都不存在，真派必 FAIL | explore-report.md:162 |
