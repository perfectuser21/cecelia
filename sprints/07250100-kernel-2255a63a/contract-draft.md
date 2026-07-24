# Sprint Contract Draft (Round 1)

覆盖父路：独立小路（无父路）—— 本 sprint 是 kernel-v1 mixed-provider fire drill 主链的 R9 收敛续跑，不覆盖某条既有产品 Golden Path 的子步骤，验收对象是本次 harness 全链路（尤其是 pr-state / CI 结构化判据 / 生产 health 祖先判据 / 合同 self-check 冲突处置 / judge-human 顺序闸门）在"合同失效后续跑"场景下的真实执行本身。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 复用现有 OPEN PR #4317（分支 `cp-07250025-892405df`）与唯一 delivery 文件 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md`，只修正文档中 `pr-state` check 的占位（command/exit_code/log_tail）与新增 R9 task/run/角色事实证据段，推新 SHA；`origin/main...HEAD` diff 必须且只能包含该目标文档 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 无量化性能 NFR（PrepPRD 未指定，`timeout_seconds=28800` 为整个 harness task 超时）；可观测性要求：`gh pr view`/生产 health 响应必须记录真实 `command`/`exit_code`/`log_tail`，禁止伪造或省略证据 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 见下方「Invariant 覆盖条目」 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方「判定点登记表」 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 本文档是一次性演练记录（fire drill），无 TTL；不是可复用生产判据，不需要退役流程 |
| **死亡告警（停了谁知道）** | 该功能停止工作后谁知道 | N/A——本 sprint 交付静态文档改动，非常驻服务；harness 全链路自身存活由既有 watchdog/heartbeat 铁律覆盖（见 INV 映射） |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 见下方「失败语义声明」 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 每条 check 都以 `command`+`exit_code`+`log_tail` 三元组记录在目标文档内，且验收脚本对同一批真实系统（Brain API / git / gh）重放校验；拿不到（如批准 SHA 无法物化、生产 health 不可达）必须显式记录该状态本身，不得静默跳过 |

### Invariant 覆盖条目（映射自铁律清单，沿用同 initiative R7 已核对版本）

- INV-1（dep-audit fixAvailable）：N/A（本 sprint 不涉及依赖升级/audit 流程）
- INV-2（headed relay 心跳）：N/A（本 sprint 不新增 headed relay session 逻辑，仅复用既有 harness 派发链路）
- INV-3（毕业 commit 前跑 lint-tdd-commit-order/check-test-coverage）：适用——generator 交付前必须本地跑通这两个检查（写入 contract-dod.md ARTIFACT 条目）
- INV-4（合同批准前记录 manual oracle 真实 exit code）：适用——本合同所有 `[BEHAVIOR]` 均为真实可执行 `manual:bash` 命令，非文本自证
- INV-11（theater_mismatch：contract 关键词误报）：适用——本合同不使用 `android` 等无关关键词，`target_environment` 固定 `local_api`
- INV-12（target_environment 由 Brain orchestrator 从 DB tasks.payload 读取）：适用——本合同 `target_environment=local_api` 与本 task payload 一致
- INV-14（Brain judge API 格式：顶层 exit_code+log_tail+behavior_tests[]）：适用——本合同 `[BEHAVIOR]` 条目格式与该约定对齐
- INV-18（harness-generator 禁止自行 merge PR）：适用——本合同 Golden Path 明确 generator 只推 commit，merge 由认证人工 approve 后由 controller 侧执行
- INV-20（Proposer 复用历史合同模板需核对真实派发历史）：适用——本合同已实读 R7 已批准合同（`GET /api/brain/harness/initiative/892405df-.../detail`）、本 task API、`gh pr view`、git 历史，核对真实上下文而非凭记忆套模板
- INV-21（harness-generator 禁区：CI 基础设施文件）：适用——本合同明确 generator 只改 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md`，不得触碰 `.github/workflows/*`
- INV-22（PR 被 should-auto-merge 提前合并需核对 evaluator/judge 用的 head SHA）：适用——见判定点登记表「PR 是否已被提前合并」
- INV-27（单 slot 严格串行）：适用——本 sprint 全链路在同一 task 内按序执行，不并行分叉
- INV-28（禁止写死环境假设值）：适用——见判定点登记表，git_sha/ancestor 判据、CI 结论集合均从真实响应/写死枚举推导，不假设实时版本号
- INV-29（真环境验证才算 done）：适用——本 sprint 的接缝断言（PR 真实状态、Brain 真实响应、gh 真实 API、生产 health 真实响应）见下方「禁 mock 边清单」与「未覆盖真实链路清单」
- INV-31（凭据安全）：适用——文档记录角色 provider/account 分工时只写别名（`account1`/`team3`/`grok`），不得写入真实密钥/token
- 其余 INV（headed relay tmux/新 task_type/常驻服务/多租户/端点鉴权等）：N/A（本 sprint 不涉及对应场景，与 R7 已核对结论一致）

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ CI 单项结论如何归入 pending/失败/成功三态 | A. 只要非 SUCCESS 一律判失败; B. 按写死枚举分类：`status≠COMPLETED`或`conclusion`为空=pending；`conclusion∈{FAILURE,CANCELLED,TIMED_OUT,ACTION_REQUIRED,STALE,STARTUP_FAILURE}`=失败；`conclusion∈{SUCCESS,SKIPPED,NEUTRAL}`=成功 | B（PRD 字面写死枚举） | PRD 明确"SUCCESS、SKIPPED、NEUTRAL 都是合法完成结论，docs-only 的 SKIPPED 不得判失败"——本次 delivery 是纯文档改动，多条 CI job（如 `brain-unit`/`workspace-test` 等）会因 path-filter 合法 SKIPPED，方案 A 会把这些合法跳过误判为失败 | 若继续用方案 A，纯文档 PR 永远无法通过 CI 判据，堵死本 sprint 唯一交付路径；反过来若把真失败（FAILURE/TIMED_OUT）也算作可放行，会掩盖真实 CI 红灯 |
| ⚠️ pr-state 必须核验哪个 PR（评估者可能不在该分支 worktree） | A. `gh pr view`（依赖当前 checkout 分支自动推断）; B. `gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup`（显式带 PR 号） | B（PRD 字面要求显式 4317） | evaluator/judge 可能在与 delivery 分支不同的 worktree 或 detached HEAD 下运行，`gh pr view` 不带参数会因当前分支无法关联 PR 而报错或误关联到别的 PR | 若用 A，evaluator 在非 delivery 分支下核验会直接失败或核验错误目标 PR，产生误判 |
| ⚠️ 生产健康是否达标（是否可判定"当前部署包含本次修复"） | A. version 字符串硬编码相等; B. git_sha 是否以指定 commit 为祖先 | B. `git merge-base --is-ancestor` 谱系判据 | R6 因方案 A（version 永远等于历史值）被诚实终局判定失败——version 会随后续发布演进，硬编码相等判据在下次发布后必然失败；祖先关系判据对后续发布仍然成立 | 若继续用方案 A，下次生产发布后本合同判据永久失效，且掩盖"到底有没有部署"这一真实问题 |
| ⚠️ PR 是否已被提前合并（judge 阶段判据污染风险） | A. 只看 PR number 存在; B. `gh pr view --json state,mergedAt` 实时查询 + judge 执行时刻的 PR head SHA 快照比对 | B. 实时查询 `state`/`mergedAt`，judge 执行时若已 merge 或已存在人工批准记录直接判污染 | INV-22：should-auto-merge 等 CI 侧兜底机制可能在 evaluator/judge 跑完前提前合并 PR | 若 PR 已被提前合并但 judge 仍判 PASS，等于用"未来才产生的批准"倒推通过，违反 PRD 显式禁止的判据 |
| ⚠️ 合同 self-check 自身 oracle 与 PRD 新规则冲突时如何处置 | A. evaluator 自行按新规则"聪明地"重新解释旧合同并放行; B. 标记 `failure_class=contract_invalid`，不派 generator 修改已冻结（GAN 批准）的不可变合同，上报 controller 重新走 propose | B（PRD 字面要求） | 合同一旦 GAN 批准即视为不可变契约；若允许 evaluator 临场重新解释，等于绕开 GAN 对抗机制单方面改判据，且历史故障 `approved_but_contract_artifacts_missing` 正是"合同/证据不一致却被放行"的同类模式 | 若选 A，会掩盖"合同本身已过期需要重新走 propose"的真实问题；若合同确已过期还硬闯着让 generator 去改一个已批准冻结的合同，破坏 GAN 不可变性保证，且后续轮次无法追溯"改的是判据还是实现" |
| 批准远端合同 SHA 是否已物化（而非仅记录了 SHA 字符串或文档文本自称"未出现"） | A. 只检查 SHA 字段非空；B. 查文档文本是否写了"未出现"字样；C. 实查 Brain 真实落库结果——`GET /api/brain/harness/initiative/:id/detail` 的 `contract_content`/`prd_content` 非空，且 `GET /api/brain/orchestrator/relay-runs?task_id=...` 的 `failure_reason` 不含 `approved_but_contract_artifacts_missing`/`no_progress_same_sha` | C（沿用 R7 round3 已核对结论，源码：`packages/brain/src/orchestrator/loop.js` 的 `frozenContractArtifacts()`/`materializeApprovedContract()`） | 成功时写 `initiative_runs.contract_content`/`prd_content`，失败时 `markRunFailed(...,'approved_but_contract_artifacts_missing')` 写 `failure_reason`；两端点均为已验证可用的既有生产端点 | 若继续只查文档文本，generator 可以不触发任何真实物化、直接手写"未出现"四个字骗过验收 |
| 本轮相对上一轮是否产生真实进展（而非 no_progress_same_sha） | A. 只看是否有新 commit; B. 比对本轮 PR head SHA 与推送前起点（Green SHA `d6fce497...`）是否不同，且 diff 非空 | B. SHA 不同 + diff 非空 | 历史失败案例 `no_progress_same_sha` 表明"看似跑了一轮但实际没产生新内容"是真实发生过的失败模式；PRD 明确本轮必须"推新 SHA" | 若不检查，无进展的重复提交会被当作正常一轮消耗掉 GAN/relay 轮次预算 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `gh pr view 4317` 不可达或返回非预期字段（如缺字段/JSON 解析失败） | checks 该项记为 FAIL（`exit_code≠0`），不得静默跳过 | 是（只读重跑，幂等） | 无降级；pr-state 是本次验收硬前提 |
| `/api/brain/health` 不可达或响应缺 `git_sha`/`version` | checks 该项记为 FAIL，不得用历史缓存值代替 | 是（只读重跑） | 无降级 |
| PR 处于非 OPEN（已提前 merge 或被关闭） | checks 该项记为 FAIL，judge 阶段禁止判 PASS（判据污染） | 否（一次性状态判定） | 无降级；需人工介入排查 should-auto-merge 等兜底机制 |
| CI 某 check `conclusion` 落入失败集合（`FAILURE`/`CANCELLED`/`TIMED_OUT`/`ACTION_REQUIRED`/`STALE`/`STARTUP_FAILURE`） | 判定失败，不得因"docs-only"豁免 | 是（等待重跑该 check） | 无降级 |
| CI 某 check `status≠COMPLETED` 或 `conclusion` 为空 | 判定 pending，不得当作失败也不得当作成功放行 | 是（轮询等待） | 无降级；必须等到 COMPLETED |
| `origin/main...HEAD` diff 命中 `packages/brain/`、`sprints/**`、`.harness/**`、合同产物、合同测试、迁移或产品逻辑文件 | fail-fast，不得因"顺手改了"而放行 | 否（创建前门禁） | 无降级；generator 必须清理多余改动后重跑 diff 校验 |
| 批准远端合同 SHA 无法物化读取（网络/存储缺失） | checks 必须显式记录 `approved_but_contract_artifacts_missing` **未出现**这一事实本身，而非静默跳过 | 是（可重试读取） | 无降级；若始终无法物化，该轮 checks 整体 FAIL |
| 合同 self-check 自身 oracle 与 PRD 判据规则冲突 | evaluator 标记 `failure_class=contract_invalid`，不修改本合同、不派 generator 修复不可变合同 | 否（需重新走 propose 轮） | 无降级；上报 controller |
| judge 尚未 PASS 但已存在人工 approve 记录 | 视为流程违规，不得放行 merge | 否 | 无降级；controller 排查为何提前出现人工批准记录 |

### 输入对抗面

N/A——本 sprint 不对外暴露 agent 交互入口（不含客服 agent/爬虫内容 pipeline/外部用户可写入接口），仅是 harness 内部角色间的既有 relay 协议演练续跑。

## 真实调用方请求 shape

N/A（规则 A 不适用）——本 sprint 不新增/改动任何"设备/agent 调服务端"的 API 端点或请求 shape。harness 各角色（planner/proposer/reviewer/generator/evaluator/judge/human）之间的调用协议是既有 skill-relay 编排机制，本 sprint 不改变其认证方式或字段名。

真实第三方依赖是 GitHub API（经 `gh` CLI）与生产 Brain `/api/brain/health` 端点，按**规则 B（第三方真调一次）**覆盖：下方 `[BEHAVIOR]` 中至少 3 条使用真实 `gh pr view 4317`/真实 `curl localhost:5221/api/brain/health` 请求并对响应字段做 `jq -e` 断言，非 mock/stub/假数据。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）—— 本 sprint 不修改任何代码，交付物是纯文档；`tests/` 下的失败测试直接读取真实文件系统/git 历史/Brain API，不 mock 任何依赖。E2E 验收脚本直接对真实 `gh` CLI、真实 Brain API（`localhost:5221`）、真实生产 health 响应、真实 git 历史执行断言。

## 禁 mock 边清单

（本单纯文档改动，无接缝边，N/A）—— 本 sprint 不改动 `packages/brain` 任何调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径代码，唯一交付物是 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md` 静态文档修正。验收脚本本身对 gh/Brain API/git 的调用是真实调用，非测试替身。

## 已知约束（来自回归测试 / 累积 FR / 同类归档）

- [累积FR] 本 line 无 `journey_id` 锚定的累积 FR 数据；参考同 initiative 历史 run `892405df`：已产出 OPEN PR #4317 + 分支 `cp-07250025-892405df` + delivery 文件，Red/Green SHA 已固化，本 sprint 须在此基础上续跑而非重新生成（PRD 字面要求）
- [同类归档] `GET /api/brain/harness/initiative/892405df-3dc3-4c44-9402-278c7d8d0bd3/detail` 返回的 R7 Round 3 已批准合同（`contract_content` 非空）与本任务高度同构，本合同结构直接沿用其判定点登记表/Invariant 映射，仅针对 R9 PRD 新增的 CI 结构化判据枚举、显式 PR 号、contract_invalid 处置、judge-human 顺序做增量调整
- [当前实测] `gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup` 返回：`state=OPEN`、`mergedAt=null`、`headRefName=cp-07250025-892405df`、`headRefOid=d6fce4971c40b67c2fb793290949fc1b2a664ae7`（等于既有 Green SHA，尚未推新 SHA）、`statusCheckRollup` 全部 `status=COMPLETED` 且 `conclusion∈{SUCCESS,SKIPPED}`
- [当前实测] `curl localhost:5221/api/brain/health` 返回 `git_sha=2a96f975ecf1ce1ddfb818030f7642a08e2860b8`，与两个历史 ancestor SHA 之一字面相等（自身是自身祖先，`git merge-base --is-ancestor X X` exit 0）；`19887912bbb581597f12c714a9ed187f051e2850` 经 `git merge-base --is-ancestor` 验证是其祖先
- [当前实测] `curl localhost:5221/api/brain/orchestrator/relay-runs?task_id=2255a63a-2152-47c3-aa89-301cae2445ad` 返回本轮 run `e9ef9dde-fab9-47ff-b5b3-61d519af2ac6`，`phase=planning`，`failure_reason=null`（未命中两个历史失败 reason）
- [当前实测] `curl localhost:5221/api/brain/tasks/2255a63a-2152-47c3-aa89-301cae2445ad` 返回 `payload.continue_branch=cp-07250025-892405df`、`payload.continue_pr_url=.../pull/4317`、`payload.prior_run_id=61d67ca8-22f5-4ca6-afa7-7b4030d148b8`、`payload.prior_task_id=50bd54d0-b160-4d5d-97cb-98adeaeb8990`、`payload.role_assignments` 五角色齐全，与 R7 一致
- [git 实测] `50291fbba314a3fd736249b4cb2014277dccff41`（Red）与 `d6fce4971c40b67c2fb793290949fc1b2a664ae7`（Green）均为本仓库可解析的真实 commit（`git cat-file -t` 返回 `commit`），`d6fce497...` 当前即为 PR #4317 的 `headRefOid`

## Response Schema（推导来源: PRD 字面 — 无新增 HTTP 响应）

N/A — 本 task 无新增 HTTP 响应端点交付。`docs/fire-drills/kernel-v1-mixed-20260724-r7.md` 是静态 Markdown 文档，不是 API。验收脚本读取的 `/api/brain/health`、`/api/brain/tasks/:id`、`/api/brain/orchestrator/relay-runs`、`/api/brain/harness/initiative/:id/detail` 均为既有生产端点，本 sprint 不改变其响应 schema，只作为只读验证依据引用；`gh pr view` 的 JSON 输出 schema 由 GitHub CLI 自身固定，不受本 sprint 影响。

---

## Golden Path

[控制面产物在 sprint_dir 生成、不进入 delivery PR] → [Generator 起点校验=Green SHA，独立 delivery worktree 复用 PR #4317] → [Generator 只改占位+R9证据，推新 SHA，diff 仅含目标文档] → [Evaluator pr-state 真实核验（显式 PR 号）] → [Evaluator CI 结构化判据（写死三态枚举）] → [Evaluator 生产 health 祖先判据] → [合同 self-check 冲突 → contract_invalid，不改不可变合同] → [Judge PASS 早于人工批准，PR 未 merge] → [认证人工 approve 后才 merge/report] → [批准远端合同 SHA 物化成功]

### Step 1: 控制面产物（PRD/合同）在 controller worktree sprint_dir 内生成、提交、可推送到各自 branch，不进入 delivery PR

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 点直接定义。

**可观测行为**: `sprints/07250100-kernel-2255a63a/` 下存在 `sprint-prd.md`/`contract-draft.md`/`contract-dod.md`/`tests/`/`task-plan.json`，这些产物提交在 proposer 自己的 `cp-harness-propose-r*` 分支上，不出现在 PR #4317 的 diff 中。

**验证命令**:
```bash
[ -f "sprints/07250100-kernel-2255a63a/contract-draft.md" ] || { echo "FAIL: contract-draft.md 不存在"; exit 1; }
[ -f "sprints/07250100-kernel-2255a63a/contract-dod.md" ] || { echo "FAIL: contract-dod.md 不存在"; exit 1; }
PR_FILES=$(gh pr view 4317 --json files --jq '.files[].path')
echo "$PR_FILES" | grep -q "^sprints/07250100-kernel-2255a63a/" && { echo "FAIL: sprint_dir 产物泄漏进 delivery PR"; exit 1; }
echo "OK: 控制面产物在 sprint_dir，未进入 delivery PR"
```

**硬阈值**: 控制面产物文件存在；PR #4317 files 列表不含任何 `sprints/07250100-kernel-2255a63a/` 前缀路径。

---

### Step 2: Generator 起点校验——独立 delivery worktree fetch/checkout 分支 `cp-07250025-892405df`，起点 headRefOid 等于既有 Green SHA

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点 + 边界情况第一条（"若 `gh pr view` 返回非预期字段，如 `headRefOid` 与既有 Green SHA 不一致 → 视为证据不匹配"，应用于 Generator 动手改动前的起点校验）。

**可观测行为**: Generator 开始编辑前，PR #4317 的 `headRefOid` 等于既有 Green SHA `d6fce4971c40b67c2fb793290949fc1b2a664ae7`；且该 checkout 发生在独立 delivery worktree（非 controller 共享 worktree）。

**验证命令**:
```bash
PR_JSON=$(gh pr view 4317 --json headRefOid,headRefName) || { echo "FAIL: 无法读取 PR"; exit 1; }
echo "$PR_JSON" | jq -e '.headRefOid == "d6fce4971c40b67c2fb793290949fc1b2a664ae7"' >/dev/null || { echo "FAIL: 起点 headRefOid 与既有 Green SHA 不一致，证据不匹配"; exit 1; }
echo "$PR_JSON" | jq -e '.headRefName == "cp-07250025-892405df"' >/dev/null || { echo "FAIL: 分支名不匹配"; exit 1; }
git cat-file -t 50291fbba314a3fd736249b4cb2014277dccff41 >/dev/null 2>&1 || { echo "FAIL: Red SHA 不可解析"; exit 1; }
git cat-file -t d6fce4971c40b67c2fb793290949fc1b2a664ae7 >/dev/null 2>&1 || { echo "FAIL: Green SHA 不可解析"; exit 1; }
echo "OK: 起点校验通过，Red/Green SHA 均可解析"
```

**硬阈值**: `headRefOid == d6fce4971c40b67c2fb793290949fc1b2a664ae7`（推新 SHA 前）；`headRefName == cp-07250025-892405df`；Red/Green 两 SHA 均 `git cat-file -t` 返回 `commit`。

---

### Step 3: Generator 只修正 pr-state 占位 + 新增 R9 task/run/角色事实证据，推新 SHA；`origin/main...HEAD` diff 仅含目标文档

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点 + 范围限定"不在范围内：另开新 PR 或新增 delivery 文件"。

**可观测行为**: 推送后 `headRefOid` 变为不同于 Green SHA 的新 commit（证明产生真实进展，非 `no_progress_same_sha`）；`origin/main...HEAD` diff 只有一个文件，即 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md`；diff 中不出现 `packages/brain/`、`sprints/**`、`.harness/**`、合同产物、合同测试、迁移或产品逻辑文件。

**验证命令**:
```bash
git fetch origin main --quiet 2>/dev/null || true
git fetch origin cp-07250025-892405df --quiet 2>/dev/null || true
NEW_OID=$(gh pr view 4317 --json headRefOid --jq '.headRefOid')
[ "$NEW_OID" != "d6fce4971c40b67c2fb793290949fc1b2a664ae7" ] || { echo "FAIL: headRefOid 未变化，疑似 no_progress_same_sha"; exit 1; }
DIFF_STAT=$(git diff origin/main...origin/cp-07250025-892405df --stat)
DIFF_TOTAL=$(echo "$DIFF_STAT" | grep -c "|")
DIFF_MATCH=$(echo "$DIFF_STAT" | grep -c "docs/fire-drills/kernel-v1-mixed-20260724-r7.md")
[ "$DIFF_TOTAL" -eq 1 ] && [ "$DIFF_MATCH" -eq 1 ] || { echo "FAIL: diff 应恰一行且为目标文档，实际 total=$DIFF_TOTAL match=$DIFF_MATCH"; exit 1; }
echo "$DIFF_STAT" | grep -qE 'packages/brain/|sprints/|\.harness/' && { echo "FAIL: diff 命中禁止路径"; exit 1; }
echo "OK: 新 SHA=$NEW_OID，diff 仅含目标文档"
```

**硬阈值**: `headRefOid` 与 Green SHA 不同；`origin/main...origin/cp-07250025-892405df` diff `--stat` 恰一行且路径精确匹配目标文档；不命中禁止路径正则。

---

### Step 4: Evaluator pr-state 真实核验（显式带 PR 号，四字段全断言）

**来源**: `[FROM_PRD]` — PRD 明确"pr-state check 必须真实执行 `gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup`，记录 command、exit_code=0 与真实 log_tail，断言 OPEN、mergedAt=null、分支匹配、所有 checks 完成且结论均在成功集合"。

**可观测行为**: 该命令 `exit_code=0`；`state=OPEN`；`mergedAt=null`；`headRefName=cp-07250025-892405df`；`statusCheckRollup` 每一项 `status=COMPLETED` 且 `conclusion` 属于成功集合 `{SUCCESS,SKIPPED,NEUTRAL}`。

**验证命令**:
```bash
PR_JSON=$(gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup)
GH_EXIT=$?
[ "$GH_EXIT" -eq 0 ] || { echo "FAIL: gh pr view exit=$GH_EXIT"; exit 1; }
echo "$PR_JSON" | jq -e '.state == "OPEN"' >/dev/null || { echo "FAIL: state 非 OPEN"; exit 1; }
echo "$PR_JSON" | jq -e '.mergedAt == null' >/dev/null || { echo "FAIL: mergedAt 非 null"; exit 1; }
echo "$PR_JSON" | jq -e '.headRefName == "cp-07250025-892405df"' >/dev/null || { echo "FAIL: headRefName 不匹配"; exit 1; }
echo "$PR_JSON" | jq -e '[.statusCheckRollup[]? | select(.__typename == "CheckRun")] | all(.status == "COMPLETED")' >/dev/null || { echo "FAIL: 存在未 COMPLETED 的 check"; exit 1; }
echo "$PR_JSON" | jq -e '[.statusCheckRollup[]? | select(.__typename == "CheckRun") | .conclusion] | all(. == "SUCCESS" or . == "SKIPPED" or . == "NEUTRAL")' >/dev/null || { echo "FAIL: 存在结论不在成功集合的 check"; exit 1; }
echo "OK: pr-state 四字段全部核验通过 exit_code=$GH_EXIT"
```

**硬阈值**: `exit_code=0`；`state=OPEN`；`mergedAt=null`；`headRefName` 精确匹配；所有 `CheckRun` 均 `status=COMPLETED` 且 `conclusion∈{SUCCESS,SKIPPED,NEUTRAL}`。

---

### Step 5: Evaluator CI 结构化判据——写死三态枚举，docs-only SKIPPED 不判失败

**来源**: `[FROM_PRD]` — PRD 明确"`status≠COMPLETED` 或 `conclusion` 为空 = pending；`conclusion∈{FAILURE,CANCELLED,TIMED_OUT,ACTION_REQUIRED,STALE,STARTUP_FAILURE}` = 失败；`SUCCESS`、`SKIPPED`、`NEUTRAL` 都是合法完成结论，docs-only 的 `SKIPPED` 不得判失败"。

**可观测行为**: 对 Step 4 同一次 `statusCheckRollup` 响应，按三态枚举分类后，`失败` 类计数为 0；本次 delivery 是 docs-only 改动，多个因 path-filter 而 `SKIPPED` 的 check（如 `brain-unit`/`workspace-test`/`engine-tests` 等）被正确归入成功集合，不产生误判失败。

**验证命令**:
```bash
PR_JSON=$(gh pr view 4317 --json statusCheckRollup)
PENDING=$(echo "$PR_JSON" | jq '[.statusCheckRollup[]? | select(.__typename == "CheckRun") | select(.status != "COMPLETED" or .conclusion == null or .conclusion == "")] | length')
FAILED=$(echo "$PR_JSON" | jq '[.statusCheckRollup[]? | select(.__typename == "CheckRun") | select(.conclusion == "FAILURE" or .conclusion == "CANCELLED" or .conclusion == "TIMED_OUT" or .conclusion == "ACTION_REQUIRED" or .conclusion == "STALE" or .conclusion == "STARTUP_FAILURE")] | length')
SUCCEEDED=$(echo "$PR_JSON" | jq '[.statusCheckRollup[]? | select(.__typename == "CheckRun") | select(.conclusion == "SUCCESS" or .conclusion == "SKIPPED" or .conclusion == "NEUTRAL")] | length')
echo "pending=$PENDING failed=$FAILED succeeded=$SUCCEEDED"
[ "$FAILED" -eq 0 ] || { echo "FAIL: 存在 $FAILED 个失败集合 check"; exit 1; }
[ "$PENDING" -eq 0 ] || { echo "FAIL: 存在 $PENDING 个 pending check，尚未 COMPLETED"; exit 1; }
[ "$SUCCEEDED" -ge 1 ] || { echo "FAIL: 成功集合计数异常"; exit 1; }
SKIPPED_COUNT=$(echo "$PR_JSON" | jq '[.statusCheckRollup[]? | select(.__typename == "CheckRun") | select(.conclusion == "SKIPPED")] | length')
echo "OK: 三态分类 failed=0 pending=0，SKIPPED($SKIPPED_COUNT) 已正确计入成功集合"
```

**硬阈值**: `failed==0` 且 `pending==0`（两者均要求 exit 0 才放行）；`succeeded>=1`。

---

### Step 6: Evaluator 生产 health 祖先判据——同一次响应记录 version/git_sha，两个历史 merge SHA 均为其祖先

**来源**: `[FROM_PRD]` — PRD 明确"生产 health 只记录同一次响应的实际 `version`/`git_sha`，稳定判据是两个历史 merge SHA 都是实际 `git_sha` 的祖先，不硬编码实时版本"；边界情况"若生产 health 端点不可达或响应缺 `git_sha` → 无法核验祖先关系，evaluator 判 pending/contract_invalid，不得假设祖先关系成立"。

**可观测行为**: 单次 `GET /api/brain/health` 响应的 `git_sha` 字段是 40 位小写十六进制字符串；`19887912bbb581597f12c714a9ed187f051e2850` 与 `2a96f975ecf1ce1ddfb818030f7642a08e2860b8` 均是该 `git_sha` 的祖先提交（不要求相等，只要求祖先关系）。

**验证命令**:
```bash
RESP=$(curl -sf -m 10 "${BRAIN_URL:-http://localhost:5221}/api/brain/health") || { echo "FAIL: /api/brain/health 不可达"; exit 1; }
VERSION=$(echo "$RESP" | jq -r '.version // empty')
GIT_SHA=$(echo "$RESP" | jq -r '.git_sha // empty')
[ -n "$GIT_SHA" ] || { echo "FAIL: 响应缺 git_sha"; exit 1; }
echo "$GIT_SHA" | grep -Eq '^[0-9a-f]{40}$' || { echo "FAIL: git_sha=$GIT_SHA 不是40位小写SHA"; exit 1; }
git merge-base --is-ancestor 19887912bbb581597f12c714a9ed187f051e2850 "$GIT_SHA" || { echo "FAIL: 19887912b 不是 $GIT_SHA 的祖先"; exit 1; }
git merge-base --is-ancestor 2a96f975ecf1ce1ddfb818030f7642a08e2860b8 "$GIT_SHA" || { echo "FAIL: 2a96f975e 不是 $GIT_SHA 的祖先"; exit 1; }
echo "OK: version=$VERSION git_sha=$GIT_SHA 满足祖先判据（禁止硬编码 version 相等）"
```

**硬阈值**: `git_sha` 非空且匹配 `^[0-9a-f]{40}$`；两次 `git merge-base --is-ancestor` 均 exit 0。

---

### Step 7: 合同 self-check 冲突处置——oracle 冲突时 evaluator 标记 `failure_class=contract_invalid`，不修改不可变合同

**来源**: `[FROM_PRD]` — PRD 明确"若合同 self-check 自身 oracle 与以上规则冲突，evaluator 必须 `failure_class=contract_invalid`，不得派 generator 修不可变合同"。此条为流程性策略声明（`[AI_ADDED]` 部分：把 PRD 的这句话固化为 DoD 中的显式 Invariant 登记，理由——这是对 evaluator 自身行为的约束，无法通过检查目标文档内容来验证，只能作为合同附带的不可变政策条目登记，供 judge/human 审查时对照）。

**可观测行为**: 本合同（`contract-dod.md`）显式登记该处置策略为 Invariant 条目；本合同自身所有验证命令（Step 4/5/6）均与 PRD 字面规则一致，不存在需要临场重新解释的 oracle 冲突。

**验证命令**:
```bash
grep -q "failure_class=contract_invalid" sprints/07250100-kernel-2255a63a/contract-dod.md || { echo "FAIL: contract-dod.md 未登记 contract_invalid 处置策略"; exit 1; }
echo "OK: 合同 self-check 冲突处置策略已登记为不可变 Invariant"
```

**硬阈值**: `contract-dod.md` 含 `failure_class=contract_invalid` 字面登记。

---

### Step 8: Judge PASS 先于人工批准且 PR 未 merge；认证人工 approve 后才创建 merge_gate / merge / report；批准远端合同 SHA 物化成功

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4/5/6 点直接定义。

**可观测行为**: judge PASS 时刻 PR 仍未 merge 且无人工批准记录；`merge_gate` review 只在 judge PASS 之后创建；批准远端 contract SHA 的动作使 `GET /api/brain/harness/initiative/:id/detail` 的 `contract_content`/`prd_content` 非空，且本轮 `relay-runs` 的 `failure_reason` 不含 `approved_but_contract_artifacts_missing`。

**验证命令**:
```bash
TASK_ID="2255a63a-2152-47c3-aa89-301cae2445ad"
PR_JSON=$(gh pr view 4317 --json mergedAt) || { echo "FAIL: 无法读取 PR"; exit 1; }
echo "$PR_JSON" | jq -e '.mergedAt == null' >/dev/null || { echo "FAIL: PR 已 merge，judge/human 顺序无法核验（判据污染）"; exit 1; }
RELAY_JSON=$(curl -sf -m 10 "${BRAIN_URL:-http://localhost:5221}/api/brain/orchestrator/relay-runs?task_id=${TASK_ID}&limit=100") || { echo "FAIL: relay-runs 不可达"; exit 1; }
echo "$RELAY_JSON" | jq -e --arg rid "e9ef9dde-fab9-47ff-b5b3-61d519af2ac6" '[.[] | select(.id == $rid) | .judge_verdict] | length >= 0' >/dev/null || { echo "FAIL: 无法读取本轮 judge_verdict"; exit 1; }
echo "$RELAY_JSON" | jq -e '[.[].failure_reason] | index("approved_but_contract_artifacts_missing") == null' >/dev/null || { echo "FAIL: 命中 approved_but_contract_artifacts_missing"; exit 1; }
echo "OK: PR 未 merge，judge/human 顺序前提成立，历史故障未复现（materialization 由 Step 8.1 独立核验）"
```

**硬阈值**: `mergedAt==null`；`failure_reason` 数组不含 `approved_but_contract_artifacts_missing`。批准合同真实物化的独立核验见下方 Test Contract / DoD BEHAVIOR「批准合同真实物化」。

---

## E2E 验收（最终 final-e2e 跑 — 按 target_environment 选模板）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

TASK_ID="2255a63a-2152-47c3-aa89-301cae2445ad"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r7.md"
FAIL=0

echo "== 1. 控制面产物未泄漏进 delivery PR =="
PR_FILES=$(gh pr view 4317 --json files --jq '.files[].path') || { echo "FAIL: 无法读取 PR files"; FAIL=1; PR_FILES=""; }
echo "$PR_FILES" | grep -q "^sprints/07250100-kernel-2255a63a/" && { echo "FAIL: sprint_dir 产物泄漏"; FAIL=1; }

echo "== 2. pr-state 真实核验（显式 PR 号，四字段） =="
PR_JSON=$(gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup) || { echo "FAIL: gh pr view 失败"; FAIL=1; PR_JSON='{}'; }
echo "$PR_JSON" | jq -e '.state == "OPEN"' >/dev/null 2>&1 || { echo "FAIL: state 非 OPEN"; FAIL=1; }
echo "$PR_JSON" | jq -e '.mergedAt == null' >/dev/null 2>&1 || { echo "FAIL: mergedAt 非 null"; FAIL=1; }
echo "$PR_JSON" | jq -e '.headRefName == "cp-07250025-892405df"' >/dev/null 2>&1 || { echo "FAIL: headRefName 不匹配"; FAIL=1; }
echo "$PR_JSON" | jq -e '[.statusCheckRollup[]? | select(.__typename == "CheckRun")] | all(.status == "COMPLETED")' >/dev/null 2>&1 || { echo "FAIL: 存在未 COMPLETED 的 check"; FAIL=1; }

echo "== 3. CI 结构化判据三态分类 =="
FAILED=$(echo "$PR_JSON" | jq '[.statusCheckRollup[]? | select(.__typename == "CheckRun") | select(.conclusion == "FAILURE" or .conclusion == "CANCELLED" or .conclusion == "TIMED_OUT" or .conclusion == "ACTION_REQUIRED" or .conclusion == "STALE" or .conclusion == "STARTUP_FAILURE")] | length' 2>/dev/null || echo 1)
PENDING=$(echo "$PR_JSON" | jq '[.statusCheckRollup[]? | select(.__typename == "CheckRun") | select(.status != "COMPLETED" or .conclusion == null or .conclusion == "")] | length' 2>/dev/null || echo 1)
[ "$FAILED" -eq 0 ] || { echo "FAIL: failed=$FAILED"; FAIL=1; }
[ "$PENDING" -eq 0 ] || { echo "FAIL: pending=$PENDING"; FAIL=1; }

echo "== 4. 生产 health 祖先判据 =="
RESP=$(curl -sf -m 10 "$BRAIN_URL/api/brain/health") || { echo "FAIL: health 不可达"; FAIL=1; RESP='{}'; }
GIT_SHA=$(echo "$RESP" | jq -r '.git_sha // empty')
if ! echo "$GIT_SHA" | grep -Eq '^[0-9a-f]{40}$'; then echo "FAIL: git_sha 缺失或格式错误"; FAIL=1; else
  git merge-base --is-ancestor 19887912bbb581597f12c714a9ed187f051e2850 "$GIT_SHA" || { echo "FAIL: 19887912b 非祖先"; FAIL=1; }
  git merge-base --is-ancestor 2a96f975ecf1ce1ddfb818030f7642a08e2860b8 "$GIT_SHA" || { echo "FAIL: 2a96f975e 非祖先"; FAIL=1; }
fi

echo "== 5. diff 仅含目标文档 =="
git fetch origin main --quiet 2>/dev/null || true
git fetch origin cp-07250025-892405df --quiet 2>/dev/null || true
DIFF_STAT=$(git diff origin/main...origin/cp-07250025-892405df --stat 2>/dev/null || echo "")
DIFF_TOTAL=$(echo "$DIFF_STAT" | grep -c "|" || true)
DIFF_MATCH=$(echo "$DIFF_STAT" | grep -c "docs/fire-drills/kernel-v1-mixed-20260724-r7.md" || true)
[ "$DIFF_TOTAL" -eq 1 ] && [ "$DIFF_MATCH" -eq 1 ] || { echo "FAIL: diff total=$DIFF_TOTAL match=$DIFF_MATCH"; FAIL=1; }

echo "== 6. 目标文档 pr-state 段已从占位替换为真实 exit_code=0 =="
if [ -f "$DOC" ] || git show "origin/cp-07250025-892405df:$DOC" >/tmp/r9-doc.md 2>/dev/null; then
  DOC_SRC="/tmp/r9-doc.md"; [ -f "$DOC" ] && DOC_SRC="$DOC"
  grep -q "pending_until_pr_created" "$DOC_SRC" && { echo "FAIL: pr-state 仍是占位符"; FAIL=1; }
  grep -qE "gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup" "$DOC_SRC" || { echo "FAIL: pr-state command 未显式带 PR 号"; FAIL=1; }
else
  echo "FAIL: 无法读取目标文档"; FAIL=1
fi

echo "== 7. 批准合同真实物化 + 历史失败 reason 未复现 =="
DETAIL_JSON=$(curl -sf -m 10 "$BRAIN_URL/api/brain/harness/initiative/$TASK_ID/detail") || { echo "FAIL: initiative detail 不可达"; FAIL=1; DETAIL_JSON='{}'; }
echo "$DETAIL_JSON" | jq -e '.contract_content != null and .prd_content != null' >/dev/null 2>&1 || { echo "FAIL: 批准合同未真实物化"; FAIL=1; }
RELAY_JSON=$(curl -sf -m 10 "$BRAIN_URL/api/brain/orchestrator/relay-runs?task_id=$TASK_ID&limit=100") || { echo "FAIL: relay-runs 不可达"; FAIL=1; RELAY_JSON='[]'; }
echo "$RELAY_JSON" | jq -e '[.[].failure_reason] | (index("approved_but_contract_artifacts_missing") == null) and (index("no_progress_same_sha") == null)' >/dev/null 2>&1 || { echo "FAIL: 命中历史失败 reason"; FAIL=1; }

if [ "$FAIL" -eq 0 ]; then
  echo "✅ Golden Path 验证通过"
else
  echo "❌ Golden Path 验证失败"
  exit 1
fi
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖（it() 名字面子串） | 预期红证据 |
|---|---|---|---|
| pr-state 占位替换为真实 exit_code=0 + 显式 PR 号 | `tests/kernel-v1-fire-drill-r9.test.ts` | 目标文档 pr-state check 段已替换为显式 PR 号命令且 exit_code 不再是占位符 | → 占位符仍在，1 failure |
| R9 续跑证据段四值齐全 | `tests/kernel-v1-fire-drill-r9.test.ts` | 目标文档新增 R9 续跑证据段含当前与 prior 的 task_id/run_id 四值 | → 该段不存在，1 failure |
| CI 结构化判据三态枚举写入文档 | `tests/kernel-v1-fire-drill-r9.test.ts` | 目标文档记录 CI 结构化判据的三态枚举集合 | → 枚举文本不存在，1 failure |
| 历史四项标记仍完整保留 | `tests/kernel-v1-fire-drill-r9.test.ts` | 目标文档历史标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7 与两个祖先 SHA 仍完整保留 | → 若被误删则 FAIL（当前应 PASS） |
| pr-state 真实核验 | `tests/kernel-v1-fire-drill-r9.test.ts` | gh pr view 4317 真实返回 OPEN 未合并且分支与CI结论集合匹配 | → 依赖真实 gh，环境不可达时 FAIL |
| 生产 health 祖先判据 | `tests/kernel-v1-fire-drill-r9.test.ts` | 生产 health 响应 git_sha 满足两个历史 SHA 祖先判据 | → 依赖真实 Brain，不可达时 FAIL |
| 批准合同物化 + 历史失败 reason 未复现 | `tests/kernel-v1-fire-drill-r9.test.ts` | 批准合同真实物化且本轮 relay-runs 未命中两个历史失败 reason | → 依赖真实 Brain API |
| Red/Green SHA 历史可查 | `tests/kernel-v1-fire-drill-r9.test.ts` | Red 与 Green 两个历史 SHA 在提交历史中保留可查 | → 依赖真实 git，SHA 不可解析时 FAIL |
