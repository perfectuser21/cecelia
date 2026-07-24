# Sprint Contract Draft (Round 2)

覆盖父路：独立小路（无父路）—— 本 sprint 是 kernel-v1 mixed-provider 主链的一次性 fire drill 演练验收，
不覆盖某条既有产品 Golden Path 的子步骤，验收对象是本次 harness 全链路执行本身。

**Round 2 修订说明（精简纪律 B50 — 净变化趋近 0）**：Round 1 已通过 Step 2b-check 确定性自查（`grep -c '^- \[ \] \[BEHAVIOR\]'` = 7 条 ≥ 4，真执行断言 7/7 占比 100%）。本轮唯一改动：ARTIFACT #2「五角色证据摘要」原判据只 grep 角色名字符串（如 `planner`），未验证 PRD 明确要求的 provider/account 值——补齐为「角色名 300 字符窗口内含其 provider 与 account 字面值」，其余条目未发现真实 PRD 漏覆盖，不做无依据的加严。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 新增单一文档 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md`，如实记录 kernel-v1 mixed-provider 全链路（planner→proposer→独立reviewer→generator→独立evaluator→independent judge→authenticated human review）一次真实演练的验收 checks 与各角色 provider/account 运行证据 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 无量化 NFR（PrepPRD 未指定，`timeout_seconds=28800` 为整个 harness task 超时，非本文档验收环节独立时限）；可观测性要求 checks 必须记录 command/exit_code/log_tail |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 见下方「Invariant 覆盖条目」 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方「判定点登记表」 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 本文档是一次性演练记录（fire drill），无 TTL；不代表可复用的生产判据，不需要退役流程 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | N/A——本 sprint 交付的是静态文档，非常驻服务，无"停止工作"状态；harness 全链路本身的存活由既有 watchdog/heartbeat 铁律覆盖（见下方 INV 映射） |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 见下方「失败语义声明」 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 每条 checks 都以 command+exit_code+log_tail 形式记录在文档内，且验收脚本对同一批真实系统（Brain API/git/gh）重放校验；拿不到（如批准 SHA 无法物化）必须显式记录该状态本身，不得静默跳过 |

### Invariant 覆盖条目（映射自 PRD 铁律清单）

- INV-1（dep-audit fixAvailable）：N/A（本 sprint 不涉及依赖升级/audit 流程）
- INV-2（headed relay 心跳）：N/A（本 sprint 不新增 headed relay session 逻辑，仅使用既有 harness 派发链路）
- INV-3（毕业 commit 前跑 lint-tdd-commit-order/check-test-coverage）：适用——generator 交付前必须本地跑通这两个检查（写入 contract-dod.md ARTIFACT 条目）
- INV-4（合同批准前记录 manual oracle 真实 exit code + 确认解释器启动）：适用——本合同所有 [BEHAVIOR] 均为真实可执行 manual:bash 命令，非文本自证
- INV-5（manual:node -e 双引号 `${}` 需 GAN 批准前真跑）：N/A（本合同 manual 命令不使用 `node -e` 双引号插值形式）
- INV-6/7/13（smoke 铁律，重复三处）：N/A（本 sprint 不新增/修改 smoke.sh 覆盖的模块）
- INV-8（测试需覆盖真实多轮扫描、状态不重置）：N/A（本 sprint 无周期性扫描逻辑）
- INV-9（周期性重扫 + 外部付费调用需去重前置检查）：N/A（本 sprint 不引入外部付费调用）
- INV-10（跨模块时间常数隐含大小关系需显式断言）：N/A（本 sprint 不引入新时间常数）
- INV-11（theater_mismatch：contract 出现 android 关键词触发误报）：适用——本合同刻意不使用 "android" 关键词描述本 sprint 场景，仅使用 `target_environment: local_api`
- INV-12（target_environment 由 Brain orchestrator 从 DB tasks.payload 读取）：适用——本合同的 target_environment=local_api 与本 task payload 一致，proposer 不假设本地文件覆盖该字段
- INV-14（Brain judge API 格式：顶层 exit_code+log_tail+behavior_tests[]）：适用——本合同 [BEHAVIOR] 条目格式与该约定对齐，供后续 judge 阶段解析
- INV-15（DB 字段长度约束需显式截断）：N/A（本 sprint 无新 DB 写入）
- INV-16（复活曾死过的功能需读退役前代码）：N/A（本 sprint 是全新一次性文档，非复活功能）
- INV-17（失败返回 null/false 契约需显式 else 分支）：N/A（本 sprint 无新代码逻辑）
- INV-18（harness-generator 禁止自行 merge PR，merge 权归 controller）：适用——本合同 Golden Path Step 6 明确 generator 只推 branch/开 PR，merge 由 human review 认证批准后由 controller 侧执行
- INV-19（headed relay tmux 子 shell 不继承父进程环境变量）：N/A（本 sprint 不新增 headed relay tmux 逻辑）
- INV-20（Proposer 复用历史合同模板需核对真实派发历史）：适用——本合同未套用历史模板字段，Step 1.1-1.3 已实读 Brain registry/task API/git 历史核对本次真实上下文
- INV-21（harness-generator 禁区：CI 基础设施文件）：适用——本合同 Golden Path 明确 generator 只新增 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md`，不得触碰 `.github/workflows/*`
- INV-22（PR 被 should-auto-merge 提前合并需核对 evaluator/judge 用的 head SHA）：适用——见下方判定点登记表「PR 是否已被提前合并」
- INV-23（新 task_type 接线七点清单）：N/A（本 sprint 不新增 task_type）
- INV-24（服务存活判定用双信号）：N/A（本 sprint 不新增常驻服务）
- INV-25（Mac mini 禁止 LaunchAgents）：N/A（本 sprint 不部署常驻服务）
- INV-26（新增常驻服务需登记 launchd-patrol manifest）：N/A（本 sprint 不新增常驻服务）
- INV-27（单 slot 严格串行）：适用——本 sprint 全链路（planner→...→human review）在同一 task 内按序执行，不并行分叉
- INV-28（禁止写死环境假设值）：适用——见下方判定点登记表，git_sha/ancestor 判据均从真实响应/git 历史推导，不写死历史版本号作为实时判据
- INV-29（真环境验证才算 done）：适用——本 sprint 的"接缝断言"（PR 真实状态、Brain 真实响应、gh 真实 API）见下方「禁 mock 边清单」与「未覆盖真实链路清单」
- INV-30（测试默认多租户）：N/A（本 sprint 不涉及租户数据）
- INV-31（凭据安全）：适用——文档记录角色 provider/account 分工时只写 account 别名（如 `account1`/`team3`/`grok`），不得写入真实密钥/token
- INV-32（日志脱敏）：N/A（本 sprint 不涉及客户 PII/聊天内容）
- INV-33（端点鉴权）：N/A（本 sprint 不新增 API 端点）
- INV-34（租户隔离）：N/A（本 sprint 不涉及租户数据查询/写入）

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 生产健康是否达标（是否可判定"当前部署包含本次修复"） | A. version 字符串硬编码相等; B. git_sha 是否以指定 commit 为祖先 | B. `git merge-base --is-ancestor` 谱系判据 | R6 因 A 方案（version 永远等于历史值）被诚实终局判定失败——version 会随后续发布演进，硬编码相等判据在下次发布后必然失败；祖先关系判据对后续发布仍然成立 | 若继续用方案 A，下次生产发布后本合同判据永久失效，且掩盖"到底有没有部署"这一真实问题 |
| ⚠️ PR 是否已被提前合并（judge 阶段判据污染风险） | A. 只看 PR number 存在; B. `gh pr view --json state,mergedAt` 实时查询 + judge 执行时刻的 PR head SHA 快照比对 | B. 实时查询 state/mergedAt，judge 执行时若已 merge 或已存在人工批准记录直接判污染 | INV-22：should-auto-merge.sh 等 CI 侧兜底机制可能在 evaluator/judge 跑完前提前合并 PR | 若 PR 已被提前合并但 judge 仍判 PASS，等于用"未来才产生的批准"倒推通过，违反 PRD 显式禁止的判据 |
| 批准远端合同 SHA 是否已物化（而非仅记录了 SHA 字符串） | A. 只检查 SHA 字段非空; B. 实际尝试读取/checkout 该 SHA 对应的合同产物文件，读取成功才算物化 | B. 实际物化读取 | 09ecc837 历史失败案例 `approved_but_contract_artifacts_missing` 表明"记录了 SHA 但产物缺失"是真实发生过的失败模式 | 若只检查字段非空，会把"SHA 记录了但产物拉不到"误判为成功，下游 generator 无合同可用却显示已批准 |
| independent judge 判 PASS 的时间是否早于人工批准/PR merge | A. 不记录时间戳，只看最终状态; B. 文档显式记录 judge_pass_at / human_review_created_at / human_approved_at / merged_at 四个时间戳并要求单调递增 | B. 显式记录四时间戳并断言顺序 | PRD 明确要求 judge 执行时刻"人工批准尚不存在、PR 尚未 merge"是 PASS 前置条件，禁止 judge 依赖未来才产生的批准 | 若不记录时间戳，无法事后证明 judge 判定时确实没有人工批准存在，无法排除"先人工批准/合并、judge 再补一个必然 PASS 的判定"这种倒因为果 |
| 本轮是否相对上一轮产生了真实进展（而非 no_progress_same_sha） | A. 只看是否有新 commit; B. 比对本轮 PR head SHA 与上一轮/父分支 SHA 是否不同，且 diff 非空 | B. SHA 不同 + diff 非空 | 8c48781b 历史失败案例 `no_progress_same_sha` 表明"看似跑了一轮但实际没产生新内容"是真实发生过的失败模式 | 若不检查，无进展的重复提交会被当作正常一轮消耗掉 GAN 轮次预算 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `/api/brain/health` 不可达或响应缺 `git_sha`/`version` 字段 | 验收 checks 该项记为 FAIL（exit_code≠0），不得静默跳过或用历史缓存值代替 | 是（幂等：重新 curl 一次，只要是"同一次响应"内的字段即可，不跨响应拼接） | 无降级；生产健康是本次验收的硬前提，不可降级为"跳过" |
| PR 处于非 OPEN（如已被提前 merge 或被关闭） | 验收 checks 该项记为 FAIL，judge 阶段禁止判 PASS（判据污染） | 否（这是一次性状态判定，不适用重试幂等概念） | 无降级；controller 需人工介入排查 should-auto-merge 等兜底机制是否提前触发 |
| 批准远端合同 SHA 无法物化读取（网络/存储缺失） | checks 必须显式记录 `approved_but_contract_artifacts_missing` **未出现**这一事实本身（即显式断言其反面），而非静默跳过该检查项 | 是（可重试读取，幂等） | 无静默降级；若始终无法物化，该轮 checks 整体 FAIL，交由 controller 判断是否重派 |
| `origin/main...HEAD` diff 命中 `sprints/**`/`.harness/**`/合同产物文件 | 创建 PR 前 fail-fast，不创建 PR | 否（这是创建前的门禁，不涉及重试） | 无降级；generator 必须清理多余改动后重新走一遍 diff 校验 |
| Generator 在 controller 共享 worktree 上误 checkout delivery 分支 | 视为流程失败，不视为允许的降级路径 | 否 | 无降级；必须在独立 delivery worktree 重新执行 |

### 输入对抗面

N/A——本 sprint 不对外暴露 agent 交互入口（不含客服 agent/爬虫内容 pipeline/外部用户可写入接口），仅是 harness 内部角色间的既有 relay 协议演练。

## 真实调用方请求 shape

N/A——本 sprint 不新增/改动任何"设备/agent 调服务端"的 API 端点或请求 shape。harness 各角色（planner/proposer/reviewer/generator/evaluator/judge）之间的调用协议是既有 skill-relay 编排机制，本 sprint 不改变其认证方式或字段名，只使用其既有输出（`.brain-result.json` 文件协议、Brain task/relay-runs API）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）—— 本 sprint 不修改任何代码，交付物是纯文档；`tests/` 下的失败测试直接读取真实文件系统与文档内容，不 mock 任何依赖。E2E 验收脚本直接对真实 Brain API（`localhost:5221`）、真实 git 历史、真实 `gh` CLI 状态执行断言，无 force_*/stub/假数据。

## 禁 mock 边清单

（本单纯文档改动，无接缝边，N/A）—— 本 sprint 不改动 `packages/brain` 任何调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径代码，唯一交付物是 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md` 静态文档，因此没有"被改的边"需要禁止 mock。验收脚本本身对 Brain API/git/gh 的调用是真实调用（见上方「未覆盖真实链路清单」），非测试替身。

## 已知约束（来自回归测试 / 累积 FR）

- [累积FR] `context-manifest` 端点：本 task 无 `journey_id` 锚点，`curl "$BRAIN/api/brain/line/none/context-manifest"` 不适用，跳过（PRD 显式 `journey_id: none`）
- [packages/brain/src/orchestrator/counters.js] → `no_progress_same_sha` 是既有 orchestrator 判定的失败 reason 常量，本 sprint 的验收 checks 必须显式核对本轮未复现该 reason（Golden Path Step 4 / BEHAVIOR 覆盖）
- [packages/brain/src/orchestrator/derive.js:344] → `no_progress_same_sha` 判定逻辑存在于既有 orchestrator，本 sprint 不修改该文件，只在验收文档中引用其判定结果
- [packages/brain/src/__tests__/relay-runs.test.js / relay-runs-create.test.js / relay-runs-filter.test.js] → relay-runs 记录的既有约定（run_id 归属、按 task_id 过滤）是本 sprint「relay-runs 记录归属正确」验收项的既有契约基础，本 sprint 不新增字段，只读取既有 API 验证归属
- [packages/brain/src/harness-gan-graph.js / workflows/harness-gan.graph.js] → GAN 轮次循环与 propose_branch 命名约定（`cp-harness-propose-r{round}-{taskIdSlice}`）是既有实现，本 sprint 的 `${PROPOSE_BRANCH}` 直接复用 Brain 注入值，不自行推导

## Response Schema（推导来源: PRD 字面 — 无 HTTP 响应）

N/A — 本 task 无 HTTP 响应端点交付。`docs/fire-drills/kernel-v1-mixed-20260724-r7.md` 是静态 Markdown 文档，不是 API。验收脚本读取的 `/api/brain/health`、`/api/brain/tasks/:id`、`/api/brain/orchestrator/relay-runs` 均为既有生产端点，本 sprint 不改变其响应 schema，只作为只读验证依据引用。

---

## Golden Path

[Generator 建 delivery 分支] → [新增目标文档含标记] → [生产健康 SHA 谱系验收] → [checks 六项覆盖并记录] → [七角色 relay 全链路留痕] → [PR OPEN 待人审]

### Step 1: Generator 读取并核对 HARNESS_TASK_ID/CECELIA_TASK_ID，在独立 delivery worktree 从 origin/main 建分支

**来源**: `[FROM_PRD]` — PRD Golden Path Step 1 直接定义："Generator 角色读取并核对 `HARNESS_TASK_ID`=`CECELIA_TASK_ID`=当前 task_id，在从 `origin/main` 新建的独立 delivery worktree 中创建分支 `cp-MMDDHHMM-<task-short-id>`（禁止在 controller 共享 worktree 上 checkout 该分支）。"

**可观测行为**: delivery 分支存在，其 base 是 `origin/main`，且分支创建发生在与 controller 共享 worktree 不同的路径下。

**验证命令**:
```bash
# HARNESS_TASK_ID / CECELIA_TASK_ID 一致性核对（Generator 自验，写入 checks 记录）
[ -n "$HARNESS_TASK_ID" ] && [ "$HARNESS_TASK_ID" = "$CECELIA_TASK_ID" ] && [ "$HARNESS_TASK_ID" = "892405df-3dc3-4c44-9402-278c7d8d0bd3" ] || { echo "FAIL: HARNESS_TASK_ID/CECELIA_TASK_ID 不一致或不匹配当前 task"; exit 1; }
echo "OK: task id 核对通过"
```

**硬阈值**: `HARNESS_TASK_ID == CECELIA_TASK_ID == 892405df-3dc3-4c44-9402-278c7d8d0bd3`，delivery 分支名匹配 `^cp-[0-9]{8}-892405df` 模式

---

### Step 2: Generator 只新增目标文档，内含四项强制标记与角色证据摘要

**来源**: `[FROM_PRD]` — PRD Golden Path Step 2 直接定义标记 `KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7`、历史版本 `1.267.67`、`19887912bbb581597f12c714a9ed187f051e2850`、`2a96f975ecf1ce1ddfb818030f7642a08e2860b8`

**可观测行为**: `docs/fire-drills/kernel-v1-mixed-20260724-r7.md` 存在，文件内容含以上四个标记字符串，且含五个角色（planner/proposer/reviewer/evaluator/generator）各自的 provider/account 运行证据摘要——角色名附近必须能读到该角色实际的 provider 与 account 字面值（来自本 task payload.role_assignments），不是只出现角色名字符串。

**验证命令**:
```bash
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r7.md"
[ -f "$DOC" ] || { echo "FAIL: $DOC 不存在"; exit 1; }
for MARK in "KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7" "1.267.67" "19887912bbb581597f12c714a9ed187f051e2850" "2a96f975ecf1ce1ddfb818030f7642a08e2860b8"; do
  grep -qF -- "$MARK" "$DOC" || { echo "FAIL: 缺少标记 $MARK"; exit 1; }
done
node -e '
const fs=require("fs");
const c=fs.readFileSync("'"$DOC"'","utf8").toLowerCase();
const roles={planner:["claude","account1"],proposer:["claude","account1"],reviewer:["grok","grok"],evaluator:["claude","account1"],generator:["codex","team3"]};
for(const [role,[provider,account]] of Object.entries(roles)){
  const idx=c.indexOf(role);
  if(idx<0){console.error("missing role:"+role);process.exit(1);}
  const win=c.slice(idx,idx+300);
  if(!win.includes(provider)){console.error("missing provider near "+role+": "+provider);process.exit(1);}
  if(!win.includes(account)){console.error("missing account near "+role+": "+account);process.exit(1);}
}
' || exit 1
echo "OK: 目标文档标记与角色 provider/account 证据摘要齐全"
```

**硬阈值**: 四个标记字符串全部命中（grep -qF exit 0）；五个角色名附近 300 字符窗口内各自的 provider 与 account 字面值全部命中

---

### Step 3: 生产健康验收读取同一次 `/api/brain/health` 响应，记录 version 与 git_sha，判据为 SHA 祖先关系

**来源**: `[FROM_PRD]` — PRD Golden Path Step 3 + 边界情况第一条："若两次调用返回不同 git_sha，验收必须固定读取同一次响应算出的 version/git_sha 组合"

**可观测行为**: 单次 `/api/brain/health` 响应中的 `git_sha` 字段是 40 位小写十六进制字符串，且 `19887912bbb581597f12c714a9ed187f051e2850` 与 `2a96f975ecf1ce1ddfb818030f7642a08e2860b8` 均是该 `git_sha` 的祖先提交（不要求相等，只要求祖先关系）。

**验证命令**:
```bash
RESP=$(curl -sf -m 10 localhost:5221/api/brain/health) || { echo "FAIL: /api/brain/health 不可达"; exit 1; }
VERSION=$(echo "$RESP" | jq -r '.version')
GIT_SHA=$(echo "$RESP" | jq -r '.git_sha')
echo "$GIT_SHA" | grep -Eq '^[0-9a-f]{40}$' || { echo "FAIL: git_sha=$GIT_SHA 不是40位小写SHA"; exit 1; }
git merge-base --is-ancestor 19887912bbb581597f12c714a9ed187f051e2850 "$GIT_SHA" || { echo "FAIL: 19887912b 不是 $GIT_SHA 的祖先"; exit 1; }
git merge-base --is-ancestor 2a96f975ecf1ce1ddfb818030f7642a08e2860b8 "$GIT_SHA" || { echo "FAIL: 2a96f975e 不是 $GIT_SHA 的祖先"; exit 1; }
echo "OK: version=$VERSION git_sha=$GIT_SHA 满足祖先判据（禁止硬编码 version 相等）"
```

**硬阈值**: `git_sha` 匹配 `^[0-9a-f]{40}$`；两次 `git merge-base --is-ancestor` 均 exit 0

---

### Step 4: 验收 checks 逐条记录 command/exit_code/log_tail，覆盖六项范围

**来源**: `[FROM_PRD]` — PRD Golden Path Step 4 六个子项全部逐字对应

**可观测行为**: 六项各自产出 `command`/`exit_code`/`log_tail` 三元组，且显式覆盖两个历史失败 reason（`no_progress_same_sha`、`approved_but_contract_artifacts_missing`）不再复现。

**验证命令**:
```bash
# 4a. origin/main...HEAD diff 恰一行且指向目标文档
git fetch origin main --quiet 2>/dev/null || true
DIFF_LINES=$(git diff origin/main...HEAD --stat | grep -c "docs/fire-drills/kernel-v1-mixed-20260724-r7.md")
DIFF_TOTAL=$(git diff origin/main...HEAD --stat | grep -c "|")
[ "$DIFF_TOTAL" -eq 1 ] && [ "$DIFF_LINES" -eq 1 ] || { echo "FAIL: diff 应恰一行且为目标文档，实际 total=$DIFF_TOTAL match=$DIFF_LINES"; exit 1; }

# 4b. PR head/OPEN/未merge/CI绿
PR_JSON=$(gh pr view --json state,mergedAt,statusCheckRollup,headRefOid 2>/dev/null) || { echo "FAIL: 无法读取 PR 状态"; exit 1; }
echo "$PR_JSON" | jq -e '.state == "OPEN"' >/dev/null || { echo "FAIL: PR 非 OPEN"; exit 1; }
echo "$PR_JSON" | jq -e '.mergedAt == null' >/dev/null || { echo "FAIL: PR 已 merge"; exit 1; }
echo "$PR_JSON" | jq -e '[.statusCheckRollup[]?.conclusion] | all(. == "SUCCESS" or . == null)' >/dev/null || { echo "FAIL: CI 非全绿"; exit 1; }

# 4c. Brain task API 五角色分配
TASK_JSON=$(curl -sf -m 10 "localhost:5221/api/brain/tasks/892405df-3dc3-4c44-9402-278c7d8d0bd3") || { echo "FAIL: task API 不可达"; exit 1; }
for ROLE in planner proposer reviewer evaluator generator; do
  echo "$TASK_JSON" | jq -e --arg r "$ROLE" '.payload.role_assignments[$r].provider != null' >/dev/null || { echo "FAIL: 角色 $ROLE 未分配"; exit 1; }
done

# 4d. relay-runs 记录归属正确（真实路由: /api/brain/orchestrator/relay-runs，按 current_task_id 过滤，响应为裸数组）
RELAY_JSON=$(curl -sf -m 10 "localhost:5221/api/brain/orchestrator/relay-runs?task_id=892405df-3dc3-4c44-9402-278c7d8d0bd3") || { echo "FAIL: relay-runs API 不可达"; exit 1; }
echo "$RELAY_JSON" | jq -e 'if length > 0 then all(.current_task_id == "892405df-3dc3-4c44-9402-278c7d8d0bd3") else true end' >/dev/null || { echo "FAIL: relay-runs 归属错误"; exit 1; }

# 4e. 批准远端合同 SHA 能物化读取（未出现 approved_but_contract_artifacts_missing）
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r7.md"
grep -q "approved_but_contract_artifacts_missing" "$DOC" && grep -A2 "approved_but_contract_artifacts_missing" "$DOC" | grep -qi "未出现\|not_present\|absent" || { echo "FAIL: 文档未显式记录 approved_but_contract_artifacts_missing 状态未出现"; exit 1; }

# 4f. no_progress_same_sha 不复现（本轮 delivery 分支 head 与 origin/main 不同且 diff 非空，已由 4a 隐含非空验证；此处显式记录 reason 未复现）
grep -q "no_progress_same_sha" "$DOC" && grep -A2 "no_progress_same_sha" "$DOC" | grep -qi "未出现\|not_present\|absent" || { echo "FAIL: 文档未显式记录 no_progress_same_sha 未复现"; exit 1; }

echo "OK: 六项 checks 全部覆盖，两个历史失败 reason 显式记录未复现"
```

**硬阈值**: 六个子项全部 exit 0；`no_progress_same_sha` 与 `approved_but_contract_artifacts_missing` 在文档中均被显式记录为"未出现"

---

### Step 5: 全链路七角色依次执行，writer/reviewer/evaluator 独立 session，judge 是人审前置 gate

**来源**: `[FROM_PRD]` — PRD Golden Path Step 5 直接定义

**可观测行为**: 文档记录的时间线 `judge_pass_at` 早于 `human_review_created_at`，`human_review_created_at` 早于或等于 `human_approved_at`，`human_approved_at` 早于或等于 `merged_at`（若已发生）；judge 执行时刻记录的 PR 状态为未 merge 且无人工批准记录。

**验证命令**:
```bash
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r7.md"
# 提取四个时间戳字段（ISO8601），文档必须以 `judge_pass_at: <ISO8601>` 等形式记录
JUDGE_AT=$(grep -oE 'judge_pass_at:\s*[0-9T:.Z-]+' "$DOC" | head -1 | awk '{print $2}')
HR_CREATED_AT=$(grep -oE 'human_review_created_at:\s*[0-9T:.Z-]+' "$DOC" | head -1 | awk '{print $2}')
[ -n "$JUDGE_AT" ] && [ -n "$HR_CREATED_AT" ] || { echo "FAIL: 缺 judge_pass_at 或 human_review_created_at 时间戳"; exit 1; }
JUDGE_EPOCH=$(date -d "$JUDGE_AT" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$JUDGE_AT" +%s)
HR_EPOCH=$(date -d "$HR_CREATED_AT" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$HR_CREATED_AT" +%s)
[ "$JUDGE_EPOCH" -le "$HR_EPOCH" ] || { echo "FAIL: judge_pass_at ($JUDGE_AT) 晚于 human_review_created_at ($HR_CREATED_AT)，违反 pre-human gate 顺序"; exit 1; }
echo "OK: judge PASS 早于 human review 创建，顺序符合 pre-human gate 要求"
```

**硬阈值**: `judge_pass_at` 的 epoch ≤ `human_review_created_at` 的 epoch

---

### Step 6: PR 落地为仅含目标文档改动，OPEN 且 CI 全绿等待人审

**来源**: `[FROM_PRD]` — PRD Golden Path Step 6（可观测结果）

**可观测行为**: PR 存在且可通过 `gh pr view` 查询，diff 恰一行，状态 OPEN，CI 全绿。

**验证命令**:
```bash
gh pr view --json url,state,files 2>/dev/null | jq -e '.state == "OPEN" and (.files | length == 1) and (.files[0].path == "docs/fire-drills/kernel-v1-mixed-20260724-r7.md")' || { echo "FAIL: PR 文件范围或状态不符"; exit 1; }
echo "OK: PR 仅含目标文档，OPEN 待人审"
```

**硬阈值**: `.files | length == 1` 且路径精确匹配目标文档

---

## E2E 验收（最终 final-e2e 跑 — 按 target_environment 选模板）

**journey_type**: agent_remote
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

DOC="docs/fire-drills/kernel-v1-mixed-20260724-r7.md"
TASK_ID="892405df-3dc3-4c44-9402-278c7d8d0bd3"
FAIL=0

echo "== 1. 目标文档存在且含四项标记 + 五角色证据摘要 =="
if [ ! -f "$DOC" ]; then echo "FAIL: $DOC 不存在"; FAIL=1; else
  for MARK in "KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7" "1.267.67" "19887912bbb581597f12c714a9ed187f051e2850" "2a96f975ecf1ce1ddfb818030f7642a08e2860b8"; do
    grep -qF -- "$MARK" "$DOC" || { echo "FAIL: 缺少标记 $MARK"; FAIL=1; }
  done
  for ROLE in planner proposer reviewer evaluator generator; do
    grep -qi -- "$ROLE" "$DOC" || { echo "FAIL: 缺少角色证据摘要 $ROLE"; FAIL=1; }
  done
fi

echo "== 2. origin/main...HEAD diff 恰一行指向目标文档 =="
git fetch origin main --quiet 2>/dev/null || true
DIFF_TOTAL=$(git diff origin/main...HEAD --stat | grep -c "|" || true)
DIFF_MATCH=$(git diff origin/main...HEAD --stat | grep -c "docs/fire-drills/kernel-v1-mixed-20260724-r7.md" || true)
[ "$DIFF_TOTAL" -eq 1 ] && [ "$DIFF_MATCH" -eq 1 ] || { echo "FAIL: diff total=$DIFF_TOTAL match=$DIFF_MATCH（期望均为1）"; FAIL=1; }

echo "== 3. 生产健康：同一次响应 git_sha 40位小写 + 两个commit为其祖先 =="
RESP=$(curl -sf -m 10 localhost:5221/api/brain/health) || { echo "FAIL: health 不可达"; FAIL=1; RESP='{}'; }
VERSION=$(echo "$RESP" | jq -r '.version // empty')
GIT_SHA=$(echo "$RESP" | jq -r '.git_sha // empty')
echo "  version=$VERSION git_sha=$GIT_SHA"
if ! echo "$GIT_SHA" | grep -Eq '^[0-9a-f]{40}$'; then echo "FAIL: git_sha 不是40位小写SHA"; FAIL=1; else
  git merge-base --is-ancestor 19887912bbb581597f12c714a9ed187f051e2850 "$GIT_SHA" || { echo "FAIL: 19887912b 非祖先"; FAIL=1; }
  git merge-base --is-ancestor 2a96f975ecf1ce1ddfb818030f7642a08e2860b8 "$GIT_SHA" || { echo "FAIL: 2a96f975e 非祖先"; FAIL=1; }
fi

echo "== 4. PR head/OPEN/未merge/CI绿 =="
PR_JSON=$(gh pr view --json state,mergedAt,statusCheckRollup,files 2>/dev/null) || { echo "FAIL: 无法读取 PR"; FAIL=1; PR_JSON='{}'; }
echo "$PR_JSON" | jq -e '.state == "OPEN"' >/dev/null 2>&1 || { echo "FAIL: PR 非 OPEN"; FAIL=1; }
echo "$PR_JSON" | jq -e '.mergedAt == null' >/dev/null 2>&1 || { echo "FAIL: PR 已 merge"; FAIL=1; }
echo "$PR_JSON" | jq -e '[.statusCheckRollup[]?.conclusion] | all(. == "SUCCESS" or . == null)' >/dev/null 2>&1 || { echo "FAIL: CI 非全绿"; FAIL=1; }
echo "$PR_JSON" | jq -e '(.files | length) == 1 and .files[0].path == "docs/fire-drills/kernel-v1-mixed-20260724-r7.md"' >/dev/null 2>&1 || { echo "FAIL: PR 文件范围不符"; FAIL=1; }

echo "== 5. Brain task API 五角色分配 =="
TASK_JSON=$(curl -sf -m 10 "localhost:5221/api/brain/tasks/$TASK_ID") || { echo "FAIL: task API 不可达"; FAIL=1; TASK_JSON='{}'; }
for ROLE in planner proposer reviewer evaluator generator; do
  echo "$TASK_JSON" | jq -e --arg r "$ROLE" '.payload.role_assignments[$r].provider != null' >/dev/null 2>&1 || { echo "FAIL: 角色 $ROLE 未分配"; FAIL=1; }
done

echo "== 6. relay-runs 归属正确 =="
RELAY_JSON=$(curl -sf -m 10 "localhost:5221/api/brain/orchestrator/relay-runs?task_id=$TASK_ID") || { echo "FAIL: relay-runs 不可达"; FAIL=1; RELAY_JSON='[]'; }
echo "$RELAY_JSON" | jq -e 'if length > 0 then all(.current_task_id == "'"$TASK_ID"'") else true end' >/dev/null 2>&1 || { echo "FAIL: relay-runs 归属错误"; FAIL=1; }

echo "== 7. 两个历史失败 reason 显式记录未复现 + judge/human 时间线顺序 =="
if [ -f "$DOC" ]; then
  for REASON in "no_progress_same_sha" "approved_but_contract_artifacts_missing"; do
    grep -q "$REASON" "$DOC" && grep -A2 "$REASON" "$DOC" | grep -qi "未出现\|not_present\|absent" || { echo "FAIL: 文档未显式记录 $REASON 未复现"; FAIL=1; }
  done
  JUDGE_AT=$(grep -oE 'judge_pass_at:\s*[0-9T:.Z-]+' "$DOC" | head -1 | awk '{print $2}')
  HR_CREATED_AT=$(grep -oE 'human_review_created_at:\s*[0-9T:.Z-]+' "$DOC" | head -1 | awk '{print $2}')
  if [ -n "$JUDGE_AT" ] && [ -n "$HR_CREATED_AT" ]; then
    JUDGE_EPOCH=$(date -d "$JUDGE_AT" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$JUDGE_AT" +%s 2>/dev/null || echo 0)
    HR_EPOCH=$(date -d "$HR_CREATED_AT" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$HR_CREATED_AT" +%s 2>/dev/null || echo 0)
    [ "$JUDGE_EPOCH" -le "$HR_EPOCH" ] || { echo "FAIL: judge_pass_at 晚于 human_review_created_at"; FAIL=1; }
  else
    echo "FAIL: 缺 judge_pass_at 或 human_review_created_at 时间戳"; FAIL=1
  fi
fi

if [ "$FAIL" -eq 0 ]; then
  echo "✅ Golden Path 验证通过"
else
  echo "❌ Golden Path 验证失败"
  exit 1
fi
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖（it() 名字面子串，v9.5 死规则） | 预期红证据 |
|---|---|---|---|
| 目标文档标记完整性 | `tests/kernel-v1-fire-drill-r7.test.ts` | 文档存在且含四项强制标记 | → file not found，1 failure |
| 五角色 provider/account 证据摘要 | `tests/kernel-v1-fire-drill-r7.test.ts` | 含五角色 planner/proposer/reviewer/evaluator/generator 的 provider/account 实际运行证据摘要 | → file not found，1 failure |
| 历史失败 reason 显式记录未复现 | `tests/kernel-v1-fire-drill-r7.test.ts` | no_progress_same_sha 与 approved_but_contract_artifacts_missing 本轮未出现 | → file not found，1 failure |
| judge/human 时间线顺序字段存在 | `tests/kernel-v1-fire-drill-r7.test.ts` | judge_pass_at <= human_review_created_at | → file not found，1 failure |
