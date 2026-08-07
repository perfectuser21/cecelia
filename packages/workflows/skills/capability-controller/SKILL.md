---
name: capability-controller
description: |
  Capability Controller（原 Golden Path Controller）— Capability 提案版单 session 编排者。
  消费 Brain `task_type=golden_path_proposal`
  任务（harness-skill-relay loadSkill 按 task_type 选中本 skill），一个 session 从头跑完一条
  Capability 提案：探索现状 → 提案文档 → 三镜头分级扇出对抗（技术/产品/风险）→ 收敛 →
  HTML demo → 提交 7 项 GP 合同 → PATCH golden_paths status=converged + findings_log → 等 Owner 签字。
  产物契约 = 提案文档 + 合同 JSON + demo_url + pending_action_id，**不产 PR、不写实现代码、不写合同测试**
  （那是批准后 harness 实现阶段的事）。复用 harness-controller v2.1.0 横切纪律（append-only 台账 /
  phase-event 自报 / 文件接力 / 四态出口协议 / Step 0 装载恢复）。
  触发：Brain 派发 golden_path_proposal 任务；人工说「跑 Capability 提案」「对这条 capability 候选做对抗收敛」。
version: 1.2.0
created: 2026-07-12
changelog:
  - 1.2.0: skill 改名 golden-path-controller→capability-controller（决策 a340f100 追加拍板），
    触发词/description 同步换新词；Brain task_type=golden_path_proposal 字符串本体不动
    （代码层渐进，见 [[待办] Brain task-router.js/harness-skill-relay.js 需配套 /dev 改）
  - 1.1.0: proposer/reviewer 全程传递版本化 GP_CONTRACT 和 INCIDENT_CONTEXT；收敛后提交严格
    7 项合同，拿到 pending_action_id 即停在 Owner 签字边界，不替 Owner approve
  - 1.0.0: 首版（GP loop T3，cecelia docs/architecture/2026-07-12-golden-path-mode）——骨架取自
    harness-controller 2.1.0 横切纪律，Step 3-6 替换为 探索→提案→分级扇出对抗→收敛→demo→回写
    golden_paths；判级规则与镜头结构来自朋友圈试点定稿（decisions cb6be3f6/b416bfb3）；
    无 MAX_ROUNDS 纪律保持（发散兜底沿用 Brain 侧收敛趋势检测），DoD N3
---

> **语言规则: 所有输出简体中文。**
> **角色**: 车间主任（编排/派活/验收），不亲自写提案。每个阶段派 fresh subagent（Task tool），
> 自己只保留协调所需的最小上下文。

# /capability-controller — Capability 提案接力编排

流程主线：

```
Step 0 装载/恢复 → 1 探索+判级 → 2 提案+合同(capability-proposer)
→ 3 镜头扇出对抗(capability-reviewer×N) → 4 收敛循环(1v1) → 5 HTML demo
→ 6 提交合同+回写 golden_paths → 6.5 等 Owner 签字 → 7 report+收尾
```

## 硬约束（凌驾于一切阶段逻辑）

1. **产物契约 = 提案文档 + demo，不是代码**：本 skill 全程不开实现 PR、不写合同测试。提案批准后的实现由
   harness（/dev 路径 C → harness-controller）另行走，两套流程不得混在一个 session
2. **现状标注必须读代码核验**：提案里每个「已有/半成/缺失」标注都要有代码证据（文件+行号或运行证据）。
   朋友圈试点 v1 三处标「已有」的全是死代码/空壳（scheduler 零调用点、NOT NULL 静默失败、deprecated stub），
   这是本模式存在的第一理由
3. **无 MAX_ROUNDS**：对抗收敛不设硬轮数上限（刻意设计，禁加 MAX_ROUNDS；与 harness GAN 同纪律，DoD N3）。
   守护 = 预算/streak（reviewer 连续 3 轮无 verdict / proposer 连续 2 轮无产物 → 终局 FAIL）+
   Brain 侧收敛趋势检测兜底（detectConvergenceTrend 判 diverging/oscillating 由外层处置）
4. **绝不让同一 subagent 无变化重试**：BLOCKED 必须改变某样东西（补上下文/换模型/拆任务/上报）
5. **台账先行**：每阶段完成立刻 append 台账，永远信台账+DB 外部真相，不信自己记忆
6. **完成判据 = golden_paths.status ∈ {converged, rejected} + task 回写终态，两者齐才许结束 session**
7. **零人为交互**（无头模式）：不确定 → 派 Research subagent 查（代码/decisions/learnings）代答。
   人的参与点在批审桌（晨报军师节 v2），不在本 skill 内；本流程只创建签字待办并退出，
   绝不替 Owner 批准

## 横切纪律（每个阶段都适用；取自 harness-controller 2.1.0，语义不变）

### A. 台账（append-only，compaction/崩溃恢复的锚）

台账 = `.harness/progress.md`。每阶段完成必须执行两个动作：

```bash
# 动作一：台账 append
echo "<阶段>: done (<关键证据>)" >> .harness/progress.md
# 动作二：进度上报（best-effort；前台手跑无 initiative_run 行时 404 是预期，|| true 吞掉）
curl -s -m 10 -X PATCH "$BRAIN/api/brain/orchestrator/relay-runs/${HARNESS_INITIATIVE_ID}" \
  -H "Content-Type: application/json" -d '{"phase":"<planning|gan|generate|evaluate>"}' || true
# phase 映射（复用 relay 既有枚举，不新增值）：探索/判级→planning；对抗收敛→gan；demo→generate；回写+验收→evaluate
```

台账记录格式（每阶段一行，append-only）：

```
explore: done (探索报告=.harness/explore-report.md, 判级=<1v1|三镜头>, 依据=<一句话>)
propose: done (proposal-v1.md + gp-contract-v1.json@<commit7>)
adversary-r<N>: done (lens=<tech|product|risk|solo>, verdict=<APPROVED|REVISION>, contract_attack=<PASS|REVISION>, P0=<n> P1=<n> P2=<n>, verdict_file=.harness/verdicts/gp-r<N>-<lens>.json)
converge: done (final=proposal-v<N>.md + gp-contract-v<N>.json, rounds=<N>, P0/P1 全核销, REFUTED=<n>条已记账)
demo: done (file=<path>, url=<demo_url>)
contract-submit: done (gp=<uuid>, pending_action_id=<uuid>)
gp-patch: done (gp=<uuid>, status=converged, findings_log=<n>条, pending_owner_signature=<uuid>)
report: done
```

**附件约定**：reviewer 每轮的结构化 verdict JSON 落 `.harness/verdicts/gp-r<N>-<lens>.json` 随 PR 入库
（Step 0 的 `.harness/.gitignore` 放行 verdicts/）。没有附件文件的 adversary done 行视为台账不完整。

**外部真相优先**：台账说 gp-patch done 但 `GET /golden-paths/:id` 状态不是 converged → 信 DB，重跑该阶段并
append 更正行（不删旧行）。

### B. phase-event 自报（zombie-reaper 第二判活信号）

每次派阶段 subagent 前后各执行一条 curl（`HARNESS_INITIATIVE_ID` 未注入时整段跳过，不报错不阻塞）：

```bash
# 派发前（<node> = explorer|proposer|reviewer|demo|report）
EVT_ID=$(curl -s -m 10 -X POST "$BRAIN/api/brain/harness/phase-event" \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$HARNESS_INITIATIVE_ID\",\"node\":\"<node>\",\"status\":\"running\",\"model\":\"<模型档>\"}" | jq -r .id || true)
# subagent 返回后——EVT_ID 空（POST 失败）则跳过 PATCH
[ -n "$EVT_ID" ] && curl -s -m 10 -X PATCH "$BRAIN/api/brain/harness/phase-event/$EVT_ID" \
  -H "Content-Type: application/json" -d "{\"status\":\"done\",\"ts_end\":$(date +%s)}" || true
```

三镜头扇出时每个镜头各报一对（node=reviewer，model 字段带镜头名区分）。

### C. 文件接力（SDD 6.0）

- 阶段间传**文件路径**，不往 subagent prompt 里粘贴大产物（提案全文/feedback 全文/探索报告）
- 本 skill 自带脚本（vendored from obra/superpowers，MIT，同 harness-controller）：
  `scripts/sdd-workspace`（.harness 工作区解析）、`scripts/task-brief`（任务切片）、
  `scripts/review-package`（demo 等有 commit 产物时按 BASE..HEAD 出 diff 包，禁 HEAD~1）
- controller 自己不读提案全文——保持协调上下文恒定小；万一 compaction，Step 0 台账恢复

## Step 0: 上下文装载 + 台账检查（每次进入/恢复都先做）

```bash
# 0.1 任务上下文（Brain dispatch 注入 env；前台手跑则从参数拿）
: "${HARNESS_TASK_ID:?}" "${SPRINT_DIR:?}"
BRAIN=${BRAIN_URL:-http://localhost:5221}
TASK=$(curl -s "$BRAIN/api/brain/tasks/$HARNESS_TASK_ID")

# 0.2 GP 实体定位（本 skill 特有）：payload.gp_id 优先；缺失按 proposal_task_id 反查
GP_ID=$(echo "$TASK" | jq -r '.payload.gp_id // empty')
[ -z "$GP_ID" ] && GP_ID=$(curl -s "$BRAIN/api/brain/golden-paths" \
  | jq -r --arg t "$HARNESS_TASK_ID" '.golden_paths[] | select(.proposal_task_id==$t) | .id' | head -1)
# 两路都空 → BLOCKED 上报（建 golden_paths 行是 select 端点/direction-proposer 的职责，controller 不代建）
GP=$(curl -s "$BRAIN/api/brain/golden-paths" | jq --arg id "$GP_ID" '.golden_paths[] | select(.id==$id)')
GP_STATUS=$(echo "$GP" | jq -r .status)   # 正常入口=proposed（select 端点流转过）；candidate 见 Step 6 补流转

# 0.3 台账
LEDGER=".harness/progress.md"
mkdir -p .harness .harness/verdicts
printf '*\n!.gitignore\n!gp-contract-v*.json\n!verdicts/\n!verdicts/**\n' > .harness/.gitignore
cat "$LEDGER" 2>/dev/null || echo "(新 GP 提案，无台账)"
```

事故输入按以下顺序解析，值只传路径或精确字面量 `unavailable`：

```bash
if [ -s .harness/incident-context.json ]; then
  INCIDENT_CONTEXT=.harness/incident-context.json
else
  INCIDENT_CONTEXT=unavailable
fi
```

**前台点火防护**（人工前台接管必做；同 harness-controller 0.3 语义）：任务停在 queued 会被下一个 tick
捡走双跑——接管前 `PATCH tasks/:id {"status":"in_progress"}` 认领；任务已被标 failed → 修 payload 重注册，
禁止带着死任务裸跑。

**恢复规则**：台账里标 done 的阶段直接跳过，从第一个无记录阶段续跑。adversary 轮部分完成
（有 gp-r<N> verdict 文件但无对应台账行）→ 以 verdict 文件为准补台账行再续。

## Step 1: 探索 + 判级（fresh subagent，node=explorer）

派 Research subagent（不是 proposer——探索报告是 proposer 和所有 reviewer 的共同输入，先行独立产出）：

```
prompt: 对 GP「<title>: <one_liner>」做现状探索，产出 .harness/explore-report.md：
  1. 读 line context-manifest（curl $BRAIN/api/brain/line/<journey_id>/context-manifest）+ 相关代码
  2. 逐个盘点该路径涉及的现有组件：每个标 已有/半成/缺失，附文件+行号证据；
     「已有」必须验证非死代码（有调用点/有真实写入），禁凭 grep 到文件名就标已有
  3. 列出该 GP 碰到的真实世界接缝（真机 RPA/真实客户触达/资金/对外发布/不可逆动作），逐条注明证据
  4. 报告格式：四态（DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED）+ 报告路径
```

**判级（controller 自判，写进台账，不委托 subagent）**——扇出规模按风险分级（决策 cb6be3f6 定稿）：

- 探索报告第 3 节**为空**（纯系统内部改动，不碰真机/客户/钱/不可逆动作）→ **1v1**：
  单 reviewer（lens=solo，综合镜头）多轮收敛
- 第 3 节**非空**（任一接缝命中）→ **三镜头**：首轮 技术/产品/风险 三个 reviewer 并行扇出一次，
  之后合并 findings 进 1v1 多轮收敛

台账 append（含判级与依据）→ Step 2。

## Step 2: 提案（fresh subagent，node=proposer）

```
prompt: 调用 Skill(capability-proposer)。上下文：
  GP_TITLE=<title> GP_ONE_LINER=<one_liner> SPRINT_DIR=<dir> BRAIN_URL=<url>
  EXPLORE_REPORT=.harness/explore-report.md（读它，不重复探索）
  产出 <SPRINT_DIR>/proposal-v1.md + .harness/gp-contract-v1.json 并 commit。
  报告：四态 + 两个产物路径 + 判定点条数 + 验收断言条数 + NFR 分类计数
```

**验收清单（任一缺 = 打回重跑）**：①每个 Golden Path 步骤带现状标注（已有/半成/缺失+证据引用）
②「## 验收断言」段 ≥3 条 ③「## 判定点登记表」段存在（无接缝判定点显式写 N/A）④碰真实客户/真机的
提案含 Gate 前置段 ⑤ `gp-contract-v1.json` 可被 `jq -e` 解析，顶层恰好 7 项且版本与提案一致。
完成 → 台账 append → Step 3。

## Step 3: 镜头扇出对抗（capability-reviewer × N）

按 Step 1 判级派 reviewer fresh subagent（三镜头=3 个并行，1v1=1 个 lens=solo）：

```
prompt: 调用 Skill(capability-reviewer)。上下文：
  LENS=<tech|product|risk|solo> ROUND=1 SPRINT_DIR=<dir>
  PROPOSAL=<SPRINT_DIR>/proposal-v1.md  EXPLORE_REPORT=.harness/explore-report.md
  GP_CONTRACT=.harness/gp-contract-v1.json  INCIDENT_CONTEXT=<路径|unavailable>
  verdict JSON 写 .harness/verdicts/gp-r1-<lens>.json
```

- controller 只认结构化 verdict（JSON 文件），不认散文
- 每个 verdict 必须同时含 `contract_attack` 与 `incident_comparison`；缺字段一律打回 reviewer
- 三镜头结果**合并去重**：同一 finding 多镜头命中记一条（保留全部镜头归属）；合并后 P0/P1 清单
  作为 feedback 文件落 `.harness/feedback-r1.md` 交给下一轮 proposer
- 每轮每镜头台账 append 一行 adversary-r<N>

## Step 4: 收敛循环（1v1，无 MAX_ROUNDS）

```
循环：proposer 修订（读 feedback 文件，同版产 proposal-v<N+1>.md + gp-contract-v<N+1>.json，
      逐条回应：核销 或 REFUTE 反驳）
   → reviewer（lens=solo，始终接收同版 GP_CONTRACT + INCIDENT_CONTEXT）复审
出环：verdict=APPROVED 且 contract_attack.verdict=PASS
      （P0/P1 全部核销或 REFUTE 成立；P2 记账不阻塞）
```

- **proposer 有反驳权**（解法③）：REFUTE 必须带证据（代码/数据/decisions 引用）；reviewer 裁
  REFUTE 成立 → 该 finding 标 REFUTED 进 findings_log（含 reviewer 归属，只存不算分），不再阻塞
- **收敛判据是 P0/P1 阻塞清单归零，不是「不能更完美」**：reviewer 新增问题只能是「路径真实漏洞」，
  「可以更严谨」不是阻塞项（与 harness-contract-reviewer B50 收敛模型同精神）
- 守护触发（硬约束 3）→ 终局 FAIL：PATCH golden_paths status=rejected + status_reason，task 回写
  failed，跳到 Step 7 收尾
- 出环 → 台账 append converge 行 → Step 5

## Step 5: HTML demo（fresh subagent，node=demo）

派 subagent 按收敛终稿做静态 HTML demo（参照试点 demo 四屏结构：30 秒看懂 → 关键体验模拟 →
判定点向导 → 汇总；纯静态、自包含、手机可读——批审人在手机上看）：

- demo 文件落 `<SPRINT_DIR>/demo/index.html` 并 commit
- 发布走 Skill(docs-center)（HK 文档中心，公网可访问），拿到 `demo_url`
- 发布失败 → 按四态协议 BLOCKED 分诊（换通道/补凭据/重试），**禁静默降级为本地路径**——demo_url
  是批审桌（晨报军师节）的取数字段，空值等于没交付
- 完成 → 台账 append → Step 6

## Step 6: 提交合同并回写 golden_paths

先提交 reviewer 已 PASS 的最终合同：

```bash
CONTRACT_RESPONSE=$(curl -sf -X POST \
  "$BRAIN/api/brain/golden-paths/$GP_ID/contracts" \
  -H "Content-Type: application/json" \
  --data-binary "@.harness/gp-contract-v<N>.json")
PENDING_ACTION_ID=$(printf '%s' "$CONTRACT_RESPONSE" | jq -er '.pending_action_id')
CONTRACT_VERSION=$(printf '%s' "$CONTRACT_RESPONSE" | jq -er '.contract_version.version')
CONTRACT_HASH=$(printf '%s' "$CONTRACT_RESPONSE" | jq -er '.contract_version.content_hash')
```

文件名 `<N>` 是收敛轮次，`CONTRACT_VERSION` 是 Brain 分配的不可变合同版本，两者不要求相等。
POST 失败，或缺少 `pending_action_id / CONTRACT_VERSION / CONTRACT_HASH`，均为 BLOCKED；禁止继续
PATCH 成 converged。成功后 append `contract-submit` 台账，再执行：

```bash
# candidate 手跑入口补流转（正常 Brain select 端点入口已是 proposed，本段跳过）
[ "$GP_STATUS" = "candidate" ] && curl -s -X PATCH "$BRAIN/api/brain/golden-paths/$GP_ID" \
  -H "Content-Type: application/json" -d '{"status":"proposed"}'

# 主回写：终稿全文 + demo + findings 台账一次 PATCH（proposed→converged 是合法流转）
jq -n --arg doc "$(cat <SPRINT_DIR>/proposal-v<N>.md)" --arg url "$DEMO_URL" \
  --slurpfile fl .harness/findings-log.json \
  '{status:"converged", proposal_doc:$doc, demo_url:$url, findings_log:$fl[0]}' \
| curl -s -X PATCH "$BRAIN/api/brain/golden-paths/$GP_ID" \
  -H "Content-Type: application/json" -d @-
```

`findings_log` 由 controller 从各轮 verdict JSON 汇总生成（`.harness/findings-log.json`），每条：

```json
{"round":1,"lens":"tech","severity":"P0","finding":"<一句话>",
 "verdict":"RESOLVED|REFUTED|P2_LOGGED","by":"capability-reviewer",
 "refuted_by":"capability-proposer","refute_evidence":"<REFUTED 时必填>"}
```

被 REFUTE 驳回的条目**必须保留**（含归属），本期只存不算分（对抗计分在范围外）。
PATCH 后 GET 回读确认 status=converged 才算完成（外部真相优先）→ 台账 append → Step 7。

## Step 6.5: 等 Owner 签字

将 `pending_action_id / CONTRACT_VERSION / CONTRACT_HASH` 写入任务 result 和最终摘要后停止。
本 skill 不调用 pending-action approve，也不调用旧 `/golden-paths/:id/approve`。Owner 在批审桌
按该具体合同版本签字后，Brain 才可创建绑定 `gp_contract_id/version/hash` 的 Harness 实现任务。

## Step 7: Report + 收尾

1. task 回写：`PATCH tasks/$HARNESS_TASK_ID {"status":"completed","result":{"gp_id":"<uuid>","gp_status":"converged","demo_url":"<url>","rounds":<N>,"pending_action_id":"<uuid>","gp_contract_version":<CONTRACT_VERSION>,"gp_contract_hash":"<CONTRACT_HASH>"}}`（终局失败则 status=failed + failure_reason）
2. relay-runs 终态回写（best-effort，同横切纪律 A 语义）：
   `PATCH relay-runs/$HARNESS_INITIATIVE_ID {"phase":"done","verdict":"PASS","cost":<总成本>,"pr_url":""}`
   ——GP 提案无 PR，pr_url 传空串；终局失败改 phase=failed + failure_reason
3. 台账 append `report: done`，输出最终摘要（gp_id / 状态 / demo_url / 数据库合同版本与哈希 /
   pending_action_id / 收敛轮次 / P0-P2 计数 / REFUTED 计数）
4. **自杀式 tmux 关窗**（必须是最后一个动作，同 harness-controller 2.1.0）：

```bash
if [ -n "$TMUX" ]; then
  SESSION_NAME=$(tmux display-message -p '#S' 2>/dev/null)
  if [ -n "$SESSION_NAME" ]; then
    (sleep 2 && tmux kill-session -t "$SESSION_NAME") >/dev/null 2>&1 &
    disown
    echo "✅ 已安排 2 秒后自杀 tmux 会话: $SESSION_NAME"
  fi
else
  echo "ℹ️ 非 tmux 会话，跳过自动关窗"
fi
```

## 四态协议（所有 subagent 统一出口，处置表）

| 状态 | controller 动作 |
|---|---|
| DONE | 验收产物（外部真相核对）→ 台账 → 下一阶段 |
| DONE_WITH_CONCERNS | 读 concerns：正确性/scope 问题先解决再走；观察类记台账继续 |
| NEEDS_CONTEXT | 补齐缺失上下文（自己查或派 Research subagent 查），同模型重派 |
| BLOCKED | 分诊：缺上下文→补料重派 / 需更强推理→升级模型重派 / 任务太大→拆分 / 计划本身错→终局上报。绝不无变化重试 |

## 禁止事项

1. 禁开实现 PR / 写实现代码 / 写合同测试（产物契约外一字不加）
2. 禁加 MAX_ROUNDS 或任何「第 N 轮放宽」阶梯（DoD N3）
3. 禁跳过探索直接写提案（现状标注无代码证据 = 试点 v1 的死因）
4. 禁 controller 代建 golden_paths 行（那是 select 端点/direction-proposer 的职责）
5. 禁 demo 发布失败时静默降级——BLOCKED 分诊或终局上报，不许空 demo_url 记 converged
6. 禁 controller 替 Owner 签字、批准 pending action 或绕过合同 Gate 启动 Harness
