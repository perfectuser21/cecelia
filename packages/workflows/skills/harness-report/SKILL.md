---
id: harness-report-skill
description: |
  Harness Report — 最终步骤：交付报告 + Sprint 状态同步。
  Phase A（6步交付）：回写Brain任务状态 → 更新中台Dashboard → 写Notion AI Notes（GAN标注表+截图）
  → 更新Notion Feature Registry → 飞书通知 → 写本地harness-report.md备份。
  Phase B（Sprint状态同步）：写本地Brain DB → 通过 db-update skill 触发 notion-push-sync.js 的 8 个 push 函数（journeys/journey_features/issues/skill_registry/journey_steps/journey_step_links/decisions/initiative_contracts）→ git commit。
  由 harness-evaluator PASS 后 Brain reportNode 自动 spawn；relay 模式由 harness-controller 调 Skill 触发（变量走「Relay 入口段」自取）；也可手动触发补同步。
version: 6.9.1
created: 2026-04-08
updated: 2026-07-28
changelog:
  - 6.9.1: Worker-owned GitHub read authority — `execution_surface=fleet-worker` 时 provider 禁止执行 gh、读取 GitHub credential 或实时推断 PR；PR_URL 只从固定的 `HARNESS_GITHUB_READ_AUTHORITY_FILE` 最小事实读取，缺失/不一致 fail-closed
  - 6.9.0: Kernel raw result channel — channel version presence 判 managed，显式 result file 的六字段 claimed JSON 经 runner-owned writer；Phase B 后重算 concern/verdict 并覆写；channel/file 均 unset 保留 git 根 .brain-result.json
  - 6.7.0: 翻牌义务（handoff 0714 刀3 — 台账只点火时写、交付后不翻牌根治）— Phase B 新增三件强制动作：(1) Feature 翻牌：本 sprint 推进的 journey_features 按 evaluator verdict 翻 status（PASS+merged→done / 真机段未验→working+logic-done-pending 备注 / 部分交付→working），禁止交付后仍留 planned；(2) Journey 回写：journey step 状态回写 + journeys.updated_at 刷新；description 与最新 decisions 冲突 → 标待人工确认并开 issue，不静默改写不静默跳过；(3) smoke 一致性核对：journey.e2e_test_path 指向的脚本是否还测现行方案（对照 decisions 近期废弃决策），测已废弃方案 → 开 issue。完成标志追加「翻牌清单」输出。实证：Path2/Path4 journeys.updated_at 停在 05-22、飞书版定义与 07-07 决策打架 46 天、「内容判定门槛」planned 而现实已合并 11 个 PR
  - 6.8.0: EVA v2 四修（背景：a85e0582 全通 run 里 harness-report.md/learning.md/notes 全是 Brain 侧 harness-report.mjs 降级脚本产的英文 Placeholder，本 skill 被架空；mjs 侧修复另立案，本条先修 skill 侧可自防部分）— (a) RP4 占位符守卫指纹扩大：Step 8c 与出口核验各加英文指纹 `grep -qi "placeholder"`（英文 "## Insights (Placeholder)" 字面逃逸中文守卫实证）；(b) RP5 .brain-result.json 落点参数化：BRAIN_RESULT_FILE 优先、默认 git 仓库根，headed mac 无 /workspace 场景出口协议不再无落地痕迹；(c) RP-learn 出口核验追加 learnings 表落库计数（全通 run learnings 表 0 条实证）；(d) RP6 新增「Phase B 核验」小节：journey_features/notes 各查一条本 sprint 记录，查不到记 concern；(e) 触发条件段声明与 mjs 降级脚本共存关系（以本 skill 产物为准 + 必留痕迹供区分来源）
  - 6.6.0: a638f840 两修——(a) TOTAL_COST fallback 端点修正为 /api/brain/orchestrator/relay-runs?task_id=（旧 URL 缺 orchestrator 前缀 Cannot GET，fallback 链空环；brain 1.259.0 起支持 task_id 过滤）；(b) Step 1 回写加降级链：status+result 被拒（老 brain 的 completed 409 / task 卡异常态）→ 纯 result 补写（brain 1.259.0 起合法）→ 仍失败才落 .report-concerns，pr_url/cost 不再静默丢失
  - 6.5.0: 九要素 T11 learning 模板修真 — (a) Step 8 废除 heredoc 静态占位符模板，改为 AI 回顾台账/GAN 轮次/fix 记录/CI 往返后亲自撰写真实复盘，类目无内容写「无（本次未遇到）」，预防清单必须从本次真实问题提炼；(b) Step 8c 占位符守卫：命中「（无 / 填写」或硬编码预防清单三条整段照抄 → CONCERN（关键步），配套 zenithjoy-skills CI 闸门 lint-learning-placeholders 双保险；(c) Step 8e 接通 learnings 数据管道：原子条目提炼进 learning-atoms.json 后 POST /api/brain/learnings-received（必带 task_id，谱系经 task 挂 journey/ability；issues_found 故意不传防多余 fix task）；(d) Step 8f capture_atoms 探测式 best-effort 写入（非关键步，T10 入口落地后自愈）；(e) 运行指标追加 TOTAL_COST，token/耗时留 TODO 挂 T7 phase-event
  - 6.4.0: 跨 repo 化刀3 — Step 3 截图上传宿主与 Step 9 访问地址参数化：新增 REPORT_HOST_SSH（默认 us-vps）/ REPORT_HOST_URL（默认 http://38.23.47.81:9998），正文引用变量，默认值保持现值（cecelia 本机场景零变化），第三方 repo 用 env 覆盖即可换报告宿主；Brain API（localhost:5221）调用不动（主理人拍板：Brain 是唯一中枢）
  - 6.3.0: EVA 提分（GAPS #4）— (a) 新增「Relay 入口段」：注入变量断供时自取而非 WARN 跳过（PR_URL←台账/gh pr view、FEATURE_NAME←sprint-prd 标题、TOTAL_COST←relay-runs API、SCREENSHOTS←sprint 目录扫描、FEATURE_ID/SUB_AREA/HARNESS_INITIATIVE_ID←task API），env 注入与自取二选一；(b) 出口协议改三态：关键步（task.result 回写 / harness-report.md / learning.md）失败 → DONE_WITH_CONCERNS，不再静默 DONE；非关键步（Notion/飞书/Dashboard）失败仍可 DONE 但必须在结果里列明；(c) Phase A 完成标志改为事后核验实际产物（查 task.result、探文件存在）而非信任过程 echo
  - 6.2.0: 链路审计修复 5 项 — (a)「同步 8 个 Notion DB」改为明确清单（notion-push-sync.js 的 8 个 push 函数）+ 注明入口是 db-update skill；(b) journey_steps 措辞改"保留只读兼容（仍同步存量），新增数据禁止写入"；(c) 开头加「触发条件」（evaluator PASS 后 Brain reportNode 自动 spawn；手动用于补同步）；(d) Phase A 开头加前置文件存在性检查（缺失则对应步骤跳过 + WARN）；(e) 路径拼装统一 ${SPRINT_DIR%/}/xxx 防双斜杠
  - 6.1.0: 新增Step6全量Registry回写+Step7结构化Learning+Step8 index.html可视化；截图路径统一到SPRINT_DIR/screenshots/
  - 6.0.0: 合并 harness-sprint-state → 统一为"交付报告+状态同步"单一 skill，删除独立的 harness-sprint-state skill
  - 5.1.0: 移除 Step 2.5b 多 WS 扫描逻辑 — 改为单 Sprint 直接创建 Notion Task
  - 5.0.0: 6步完整交付 — 回写Brain任务状态 + Dashboard + Notion AI Notes + Feature Registry + 飞书 + 本地备份
  - 4.0.0: Harness v4.0 Report（独立 skill，新增 CI/Deploy watch 状态）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-report — Harness Report 完成报告 + Sprint 状态同步

## Fleet GitHub 只读权限边界（v6.9.1）

当 TaskBundle 的 `execution_surface=fleet-worker`（运行时表现为
`HARNESS_GITHUB_READ_AUTHORITY_FILE` 已设置）时：

- provider **禁止执行 `gh`**，禁止读取 `GH_TOKEN`、`GITHUB_TOKEN` 或
  `~/.config/gh`，禁止用公网查询替代冻结事实。
- PR 事实只能读取固定路径的 Worker-owned GitHub read authority。它只包含冻结
  repo/PR/head/state 轴上的最小观测，且由 Runner 与 TaskBundle 逐字段核对。
- authority 文件缺失、不是普通 mode 0600 文件、JSON 无效或事实不满足任务时必须
  fail-closed；不得回退到 legacy `gh` 路径。评论/checks 等当前 broker 未提供的事实
  必须记 concern，不能自行联网补读。

**角色**: Reporter + Sprint State Syncer  
**对应 task_type**: `harness_report`  
**调用时机**: harness-evaluator PASS 后；或手动补同步

---

## 触发条件

- **自动**：harness-evaluator 输出 `verdict=PASS` 后，由 Brain `reportNode` 自动 spawn 本 skill（`task_type=harness_report`），无需人工介入。
- **手动**：当某次 Sprint 的 Notion/DB 同步漏掉或失败，可手动触发本 skill **补同步**（Phase A 会按文件存在性跳过已无意义的步骤，Phase B 走 db-update 重推）。
- **relay 模式**：harness-controller 单 session 接力时直接调 `Skill(harness-report)`，**不注入 v1 那套变量** → 必须先执行下方「Relay 入口段」自取变量，再进 Phase A。

> **与 Brain 侧降级脚本的共存关系（EVA v2）**：Brain 侧另有 `packages/brain/scripts/harness-report.mjs` 降级脚本（staging-promote 路径 spawn），会产 N/A 降级报告与英文 Placeholder learning——两者共存时**以本 skill 产物为准**；mjs 改「补缺不覆盖」已立案（issue 见 EVA v2 审计）。本 skill 跑完**必须留 `.report-concerns` 或出口三态痕迹**（`.brain-result.json` 的 verdict），供区分产物来源——a85e0582 全通 run 正是因本 skill 无落地痕迹，mjs 的英文 Placeholder 冒充了全部产物而无从发现。

---

## Relay 入口段（变量自取 — Phase A 之前必跑）

**变量供给二选一，禁止第三种状态（变量为空却继续跑）：**

1. **v1 注入路径**（cecelia-run / Brain reportNode spawn）：TASK_ID、SPRINT_DIR、FEATURE_NAME、PR_URL 等已通过 prompt/env 注入 → 核对非空后跳过本段。
2. **v2 relay 自取路径**（controller 调 Skill，或手动补同步）：上述变量部分/全部缺失 → **逐个按下表 fallback 自取**。缺变量不是跳过步骤的理由；只有自取也失败才允许降级，且必须计入 concerns（见「Phase A 完成标志」）。

**判定**：`FEATURE_NAME` 或 `PR_URL` 任一为空 → 走自取。

| 变量 | fallback 来源（按优先级） |
|---|---|
| SPRINT_DIR | ① controller 台账 `.harness/progress.md` 里的 `sprints/<slug>` 路径 ② `sprints/` 下最新目录 |
| TASK_ID | ① 台账 `.harness/progress.md` 里的 task UUID ② 调用方 prompt 里的 BRAIN_TASK_ID |
| FEATURE_NAME | `${SPRINT_DIR}/sprint-prd.md` 的一级标题（`# ` 行） |
| PR_URL | ① 台账里最后一个 GitHub PR 链接 ② `gh pr view --json url`（当前分支） |
| TOTAL_COST | relay-runs API：`/api/brain/orchestrator/relay-runs?task_id=$TASK_ID` 各行 cost_usd 求和（brain ≥1.259.0 支持 task_id 过滤；旧路径 /api/brain/relay-runs 不存在，a638f840 实证 Cannot GET） |
| SCREENSHOTS | 扫描 `${SPRINT_DIR}/screenshots/*.png` 组 JSON 数组 |
| FEATURE_ID / SUB_AREA / HARNESS_INITIATIVE_ID | task API：`/api/brain/tasks/$TASK_ID` 的 ability_id / sub_area / initiative_id |

```bash
# ===== Relay 入口段：变量缺失时自取（v1 注入齐全则整段跳过）=====
if [ -z "$FEATURE_NAME" ] || [ -z "$PR_URL" ]; then
  echo "[relay-entry] 检测到注入变量断供，走自取路径"

  # SPRINT_DIR：台账 → sprints/ 最新目录
  if [ -z "$SPRINT_DIR" ]; then
    SPRINT_DIR=$(grep -oE 'sprints/[0-9]{8}[0-9]*-[A-Za-z0-9._-]+' .harness/progress.md 2>/dev/null | head -1)
    [ -z "$SPRINT_DIR" ] && SPRINT_DIR=$(ls -dt sprints/*/ 2>/dev/null | head -1)
  fi
  SPRINT_DIR="${SPRINT_DIR%/}"

  # TASK_ID：台账里的 UUID
  [ -z "$TASK_ID" ] && TASK_ID=$(grep -oiE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' .harness/progress.md 2>/dev/null | head -1)

  # FEATURE_NAME：sprint-prd.md 一级标题
  [ -z "$FEATURE_NAME" ] && FEATURE_NAME=$(grep -m1 '^# ' "${SPRINT_DIR}/sprint-prd.md" 2>/dev/null | sed 's/^# *//')

  # PR_URL：Fleet 只读 authority；legacy 才允许台账 → gh pr view
  if [ -n "${HARNESS_GITHUB_READ_AUTHORITY_FILE:-}" ]; then
    [ -f "$HARNESS_GITHUB_READ_AUTHORITY_FILE" ] && [ ! -L "$HARNESS_GITHUB_READ_AUTHORITY_FILE" ] \
      || { echo "FATAL: Fleet GitHub read authority 缺失/非法（fail-closed）"; exit 1; }
    PR_URL=$(node -e '
      const fs = require("node:fs");
      const p = process.env.HARNESS_GITHUB_READ_AUTHORITY_FILE;
      const s = fs.statSync(p);
      if ((s.mode & 0o777) !== 0o600) process.exit(2);
      const a = JSON.parse(fs.readFileSync(p, "utf8"));
      if (a.schema_version !== "github-read-authority/v1" || typeof a.pull_request?.url !== "string") process.exit(3);
      process.stdout.write(a.pull_request.url);
    ') || { echo "FATAL: Fleet GitHub read authority 无效（fail-closed）"; exit 1; }
  else
    [ -z "$PR_URL" ] && PR_URL=$(grep -oE 'https://github.com/[^ )>]+/pull/[0-9]+' .harness/progress.md 2>/dev/null | tail -1)
    [ -z "$PR_URL" ] && PR_URL=$(gh pr view --json url -q .url 2>/dev/null || echo "")
  fi

  # TOTAL_COST：relay-runs API 求和
  if [ -z "$TOTAL_COST" ] && [ -n "$TASK_ID" ]; then
    TOTAL_COST=$(curl -s "localhost:5221/api/brain/orchestrator/relay-runs?task_id=$TASK_ID" 2>/dev/null \
      | jq '[.[]?.cost_usd // 0] | add // 0' 2>/dev/null || echo 0)
  fi
  TOTAL_COST="${TOTAL_COST:-0}"

  # SCREENSHOTS：扫描 sprint 截图目录
  if [ -z "$SCREENSHOTS" ] || [ "$SCREENSHOTS" = "[]" ]; then
    SCREENSHOTS=$(ls "${SPRINT_DIR}/screenshots/"*.png 2>/dev/null | jq -R . | jq -sc . 2>/dev/null)
    [ -z "$SCREENSHOTS" ] && SCREENSHOTS="[]"
  fi

  # FEATURE_ID / SUB_AREA / HARNESS_INITIATIVE_ID：task API
  if [ -n "$TASK_ID" ]; then
    TASK_JSON=$(curl -s "localhost:5221/api/brain/tasks/$TASK_ID" 2>/dev/null || echo "{}")
    [ -z "$FEATURE_ID" ] && FEATURE_ID=$(echo "$TASK_JSON" | jq -r '.ability_id // empty' 2>/dev/null)
    [ -z "$SUB_AREA" ] && SUB_AREA=$(echo "$TASK_JSON" | jq -r '.sub_area // "brain"' 2>/dev/null)
    [ -z "$HARNESS_INITIATIVE_ID" ] && HARNESS_INITIATIVE_ID=$(echo "$TASK_JSON" | jq -r '.initiative_id // empty' 2>/dev/null)
  fi

  # 自取结果自检：TASK_ID / SPRINT_DIR 仍为空 = 关键变量断供，记入 concerns（出口不得报纯 DONE）
  RELAY_ENTRY_CONCERNS=""
  [ -z "$TASK_ID" ]    && RELAY_ENTRY_CONCERNS="${RELAY_ENTRY_CONCERNS}TASK_ID自取失败;"
  [ -z "$SPRINT_DIR" ] && RELAY_ENTRY_CONCERNS="${RELAY_ENTRY_CONCERNS}SPRINT_DIR自取失败;"
  echo "[relay-entry] TASK_ID=$TASK_ID SPRINT_DIR=$SPRINT_DIR FEATURE_NAME=$FEATURE_NAME PR_URL=$PR_URL TOTAL_COST=$TOTAL_COST"
  [ -n "$RELAY_ENTRY_CONCERNS" ] && echo "CONCERN: $RELAY_ENTRY_CONCERNS" >> "${SPRINT_DIR:-/tmp}/.report-concerns"
fi
```

---

## 两个 Phase，依次执行

```
Phase A: 6步交付报告   → 确认 PR 合并、通知人、存档
Phase B: Sprint 状态同步 → 把本次 Sprint 产出的 API/DB/Tests/Features 同步到 Brain DB + Notion
```

两个 Phase 都要完成，不能只做一个。

---

## Phase A: 6步交付报告

### 注入变量

```bash
# 变量供给二选一（见开头「Relay 入口段」）：
# ① v1：TASK_ID、SPRINT_DIR、PROJECT_ID、FEATURE_ID、FEATURE_NAME、SUB_AREA、
#    PR_URL、TOTAL_COST、SCREENSHOTS、HARNESS_INITIATIVE_ID 由 cecelia-run 通过 prompt 注入，直接使用
# ② v2 relay：controller 不注入上述变量 → 必须已执行「Relay 入口段」自取；进入本 Phase 时变量应已就绪
SPRINT_DIR="${SPRINT_DIR%/}"   # 统一去尾斜杠：后续所有 ${SPRINT_DIR}/xxx 拼装防双斜杠（每个 bash 块开头都应保留此规约）
FIRST_SCREENSHOT_URL=$(echo "$SCREENSHOTS" | jq -r '.[0] // ""')
TOTAL_COST="${TOTAL_COST:-0}"
SCREENSHOTS="${SCREENSHOTS:-[]}"
```

---

### 前置文件存在性检查（Phase A 开头必跑）

报告/归档前先探测 sprint 产出文件，缺失则对应步骤明确**跳过 + WARN**，不让后续步骤因文件不存在而静默失败：

```bash
SPRINT_DIR="${SPRINT_DIR%/}"   # 去掉尾部斜杠，防后续拼装出双斜杠
HAS_PRD=0; HAS_CONTRACT=0; HAS_DOD=0
[ -f "${SPRINT_DIR}/sprint-prd.md" ]     && HAS_PRD=1      || echo "WARN: sprint-prd.md 不存在 → Step 7b(DB registry) 将跳过"
[ -f "${SPRINT_DIR}/contract-draft.md" ] && HAS_CONTRACT=1 || echo "WARN: contract-draft.md 不存在 → Step 3.5(Contract 归档) / Step 7a(API registry) 将跳过"
[ -f "${SPRINT_DIR}/contract-dod.md" ]   && HAS_DOD=1      || echo "WARN: contract-dod.md 不存在 → DOD 对齐章节标注（无 DoD 文件）"
echo "[harness-report] 前置文件：prd=$HAS_PRD contract=$HAS_CONTRACT dod=$HAS_DOD"
```

> 后续 Step 3.5 / Step 7 已各自带 `[ ! -f ... ] && ... continue` 防御；本检查是 Phase A 入口的统一前置探测，便于一眼看清哪些步骤会跳过。

> **WARN 落痕规约（v6.3）**：Phase A 任何步骤打出 `WARN:` 的同时，必须追加一行到 concerns 文件：
> `echo "CONCERN: <StepN>:<原因>" >> "${SPRINT_DIR}/.report-concerns"`
> 出口的「Phase A 完成标志」会汇总该文件决定 DONE / DONE_WITH_CONCERNS。只 echo WARN 不落文件 = 无痕吞掉，禁止。

---

### Step 1: 回写 Brain 任务状态

```bash
RESULT_BODY="{
      \"pr_url\": \"$PR_URL\",
      \"screenshots\": $SCREENSHOTS,
      \"total_cost_usd\": $TOTAL_COST,
      \"merged\": true
    }"
STEP1_RESP=$(curl -s -X PATCH "localhost:5221/api/brain/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "{\"status\": \"completed\", \"result\": $RESULT_BODY}")
if echo "$STEP1_RESP" | grep -q '"success":true'; then
  echo "✅ Step 1: Brain 任务状态已回写 completed"
else
  # brain ≥1.259.0 起 completed→completed 是幂等 200（a638f840 修复），正常不会走到这里。
  # 走到这里 = 老版本 brain 或状态机拒绝（如 task 被打成 blocked）→ 降级纯 result 补写
  # （不带 status 字段，1.259.0 起合法），保住 pr_url/cost 数据不丢。
  echo "⚠️ Step 1 status 回写被拒（$STEP1_RESP），降级纯 result 补写"
  STEP1_RESP2=$(curl -s -X PATCH "localhost:5221/api/brain/tasks/$TASK_ID" \
    -H "Content-Type: application/json" -d "{\"result\": $RESULT_BODY}")
  echo "$STEP1_RESP2" | grep -q '"success":true' \
    && echo "✅ Step 1(降级): result 已补写（status 未变，由上游状态机管）" \
    || echo "CONCERN: Step1:task.result回写两次均失败;" >> "${SPRINT_DIR}/.report-concerns"
fi
```

---

### Step 2: 更新中台 Dashboard

```bash
mkdir -p "$SPRINT_DIR/screenshots"
curl -X POST "localhost:5221/api/brain/harness/complete" \
  -H "Content-Type: application/json" \
  -d "{
    \"initiative_id\": \"${HARNESS_INITIATIVE_ID:-$TASK_ID}\",
    \"sprint_dir\": \"$SPRINT_DIR\",
    \"pr_url\": \"$PR_URL\",
    \"screenshots\": $SCREENSHOTS
  }" 2>/dev/null || echo "WARN: Dashboard 更新失败（非阻断）"
echo "✅ Step 2: 中台 Dashboard 已更新"
```

---

### Step 2.5: 写 Notion Task Notes（关联到被推进的 Ability/Feature Task）

> **架构决策（2026-06-10）**：Sprint/Run 不是 Notion 实体，不创建 Run 级 Notion Project。
> 本 sprint 产出物（PrepPRD / Contract / Report）作为 Notes 关联到对应 Ability/Feature Task。

```bash
TASK_PAYLOAD=$(jq -n \
  --arg title "$FEATURE_NAME" \
  --arg status "Done" \
  --arg sprint_dir "$SPRINT_DIR" \
  --arg pr_url "${PR_URL:-}" \
  '{title:$title, status:$status, sprint_dir:$sprint_dir, pr_url:$pr_url}')
curl -s -X POST "localhost:5221/api/brain/notion/task" \
  -H "Content-Type: application/json" \
  -d "$TASK_PAYLOAD" 2>/dev/null || echo "WARN: Notion Task 创建失败（非阻断）"
echo "✅ Step 2.5: Notion Task Notes 已写入（status=Done）"
```

---

### Step 3: 上传截图 + 写 Report Note

```bash
# 上传截图到报告宿主（跨 repo 化刀3 参数化：默认 us-vps / 38.23.47.81 保持 cecelia 本机场景零变化，
# 第三方 repo 用 env 覆盖 REPORT_HOST_SSH / REPORT_HOST_URL 即可换宿主）
REPORT_HOST_SSH="${REPORT_HOST_SSH:-us-vps}"
REPORT_HOST_URL="${REPORT_HOST_URL:-http://38.23.47.81:9998}"
SPRINT_SLUG=$(basename "$SPRINT_DIR")
VPS_SCREENSHOT_DIR="/opt/zenithjoy/screenshots/${SPRINT_SLUG}"
SCREENSHOT_URLS=""
ssh "$REPORT_HOST_SSH" "mkdir -p ${VPS_SCREENSHOT_DIR}" 2>/dev/null || echo "WARN: 报告宿主目录创建失败（非阻断）"
for f in "${SPRINT_DIR}/screenshots/"*.png; do
  [ -f "$f" ] || continue
  scp "$f" "${REPORT_HOST_SSH}:${VPS_SCREENSHOT_DIR}/" 2>/dev/null || echo "WARN: 截图上传失败 $f（非阻断）"
  FNAME=$(basename "$f")
  SCREENSHOT_URLS="${SCREENSHOT_URLS} https://api.zenithjoy.com/screenshots/${SPRINT_SLUG}/${FNAME}"
done
echo "✅ 截图已上传到 VPS: $SCREENSHOT_URLS"

# 写 Type=Report 的 Note（含 Usage 表 + DOD 对齐 + E2E 截图）
COMPLETED_AT=$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S %Z')
REPORT_CONTENT=$(printf '## Usage\n模型:%s | 时长:- | 成本:$%s\n\n## DOD 结果\n所有 ARTIFACT + BEHAVIOR 条目已验证通过（evaluator PASS）。\n\n## E2E 证明\n%s\n\n## DB 回填\n完成时间: %s' \
  "${MODEL:-sonnet-4-6}" "$TOTAL_COST" "${SCREENSHOT_URLS:-（无截图）}" "$COMPLETED_AT")

curl -X POST "localhost:5221/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Report: $FEATURE_NAME\",
    \"type\": \"Report\",
    \"sub_area\": \"$SUB_AREA\",
    \"content\": $(echo "$REPORT_CONTENT" | jq -Rs .),
    \"initiative_id\": \"${TASK_ID:-}\"
  }" 2>/dev/null || echo "WARN: Report Note 写入失败（非阻断）"
echo "✅ Step 3: Report Note 已写入（Type=Report）"

# 收尾 PATCH：截图上传完成后回写 screenshot_url 到 Brain DB（Step 1 时 URL 还未生成）
if [ -n "$SCREENSHOT_URLS" ] && [ "$SCREENSHOT_URLS" != "[]" ]; then
  # 将空格分隔的 URL 列表转为 JSON 数组
  SCREENSHOT_URLS_JSON=$(echo "$SCREENSHOT_URLS" | tr ' ' '\n' | grep -v '^$' | jq -R . | jq -sc .)
  curl -s -X PATCH "localhost:5221/api/brain/tasks/$TASK_ID" \
    -H "Content-Type: application/json" \
    -d "{\"screenshots\": $SCREENSHOT_URLS_JSON}" \
    >/dev/null 2>&1 || true
  echo "✅ 截图 URL 已回写 Brain DB"
fi
```

---

### Step 3.5: 文档归档（PrepPRD/Contract）

```bash
# PrepPRD → Type=PrepPRD，Contract → Type=Contract
for DOC_PAIR in "prep-prd.md:PrepPRD" "contract-draft.md:Contract"; do
  DOC_FILE="${DOC_PAIR%%:*}"
  DOC_TYPE="${DOC_PAIR##*:}"
  DOC_PATH="${SPRINT_DIR}/${DOC_FILE}"
  [ ! -f "$DOC_PATH" ] && echo "WARN: $DOC_FILE 不存在，跳过" && continue

  NOTES_PAYLOAD=$(jq -n \
    --arg title "${DOC_TYPE}: ${FEATURE_NAME}" \
    --arg type "$DOC_TYPE" \
    --arg content "$(cat "$DOC_PATH")" \
    --arg initiative_id "${TASK_ID:-}" \
    '{"title":$title,"type":$type,"content":$content,"initiative_id":$initiative_id}')
  curl -X POST "localhost:5221/api/brain/notes" \
    -H "Content-Type: application/json" \
    -d "$NOTES_PAYLOAD" 2>/dev/null || echo "WARN: Notes 写入失败（$DOC_TYPE）"
done
echo "✅ Step 3.5: 文档归档完成（PrepPRD + Contract）"
```

---

### Step 4: 更新 Notion Feature Registry

```bash
[ -n "$FEATURE_ID" ] && curl -s -X PATCH "localhost:5221/api/brain/journey_features/$FEATURE_ID" \
  -H "Content-Type: application/json" \
  -d '{"thickness":"done","status":"done"}' >/dev/null 2>&1 || echo "WARN: Feature Registry 更新失败（非阻断）"
echo "✅ Step 4: Notion Feature Registry status → done"
```

---

### Step 5: 飞书通知

```bash
FEISHU_MSG="PR: $PR_URL"
[ -n "$FIRST_SCREENSHOT_URL" ] && FEISHU_MSG="$FEISHU_MSG\n截图: $FIRST_SCREENSHOT_URL"

curl -X POST "localhost:5221/api/brain/harness/notify" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"harness_complete\",
    \"title\": \"✅ $FEATURE_NAME 完成\",
    \"message\": $(echo "$FEISHU_MSG" | jq -Rs .)
  }" 2>/dev/null || echo "WARN: 飞书通知失败（非阻断）"
echo "✅ Step 5: 飞书通知已发送"
```

---

### Step 6: 写本地 harness-report.md（紧凑模板）

```bash
DATE_SHORT=$(TZ=Asia/Shanghai date '+%Y-%m-%d')
PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$' || echo "-")
GAN_ROUNDS=$(curl -s "localhost:5221/api/brain/tasks/$TASK_ID" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('payload',{}).get('gan_rounds',0))" \
  2>/dev/null || echo 0)
PHASES="A+B+C"

cat > "${SPRINT_DIR}/harness-report.md" << REPORT
━━━ Sprint: ${FEATURE_NAME}  PR #${PR_NUMBER}  ${DATE_SHORT} ━━━

PIPELINE  ${PHASES} phases · ${GAN_ROUNDS} eval rounds · - · \$${TOTAL_COST}

Phase          Time    Cost    Result
Proposer       -       -       ✅
Planner        -       -       ✅
Generator      -       -       ✅
Evaluator×${GAN_ROUNDS}    -       -       ✅
Reporter       -       -       ✅

DOD -/- ✅  FAIL: 无

E2E 截图: ${SCREENSHOT_URLS:-（无截图）}
Learning: （从本次 Sprint 提炼的洞察见 learning.md）
DB sync: journey_features · api_registry ✅ · Notion pushed ✅
# journey_steps 保留只读兼容（notion-push-sync 仍同步存量数据），新增数据禁止写入；Ability/Feature 一律写 journey_features
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REPORT
echo "✅ Step 6: harness-report.md 已写入（紧凑模板）"
```

---

### Step 7: 全量回写 Registry（闭环）

```bash
# 提取 API endpoints 并写 registry
if [ -f "${SPRINT_DIR}/contract-draft.md" ]; then
  grep -oE '(GET|POST|PUT|DELETE|PATCH) /[a-zA-Z0-9/_:-]+' "${SPRINT_DIR}/contract-draft.md" | while read -r METHOD PATH_; do
    ENDPOINT="${METHOD} ${PATH_}"
    PAYLOAD=$(jq -n \
      --arg type "api" \
      --arg status "active" \
      --arg name "$ENDPOINT" \
      --arg endpoint "$ENDPOINT" \
      --arg sprint_dir "$SPRINT_DIR" \
      --arg pr_url "${PR_URL:-}" \
      '{"type":$type,"status":$status,"name":$name,"endpoint":$endpoint,"metadata":{"sprint_dir":$sprint_dir,"pr_url":$pr_url}}')
    curl -s -X POST "localhost:5221/api/brain/registry" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" >/dev/null 2>&1 || echo "WARN: registry 写入失败（$ENDPOINT）"
  done
  echo "✅ Step 7a: API endpoints 已回写 Registry"
else
  echo "WARN: contract-draft.md 不存在，跳过 API registry"
fi

# 提取 DB 表名并写 registry
if [ -f "${SPRINT_DIR}/sprint-prd.md" ]; then
  grep -oE 'Table: [a-zA-Z_]+' "${SPRINT_DIR}/sprint-prd.md" | awk '{print $2}' | while read -r TABLE; do
    PAYLOAD=$(jq -n \
      --arg type "db_schema" \
      --arg status "active" \
      --arg name "$TABLE" \
      --arg table "$TABLE" \
      --arg sprint_dir "$SPRINT_DIR" \
      --arg pr_url "${PR_URL:-}" \
      '{"type":$type,"status":$status,"name":$name,"table":$table,"metadata":{"sprint_dir":$sprint_dir,"pr_url":$pr_url}}')
    curl -s -X POST "localhost:5221/api/brain/registry" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" >/dev/null 2>&1 || echo "WARN: registry 写入失败（table: $TABLE）"
  done
  echo "✅ Step 7b: DB 表名已回写 Registry"
else
  echo "WARN: sprint-prd.md 不存在，跳过 DB schema registry"
fi

# 提取测试文件并写 registry（包含 content 字段，供 proposer Step 1.2 读取历史约束）
if [ -d "${SPRINT_DIR}/tests" ]; then
  find "${SPRINT_DIR}/tests" -name "*.test.ts" -o -name "*.spec.ts" | while read -r TEST_FILE; do
    PAYLOAD=$(jq -n \
      --arg type "test" \
      --arg status "active" \
      --arg name "$TEST_FILE" \
      --arg content "$(cat "$TEST_FILE" 2>/dev/null || echo "")" \
      --arg sprint_dir "$SPRINT_DIR" \
      --arg pr_url "${PR_URL:-}" \
      '{"type":$type,"status":$status,"name":$name,"content":$content,"metadata":{"sprint_dir":$sprint_dir,"pr_url":$pr_url}}')
    curl -s -X POST "localhost:5221/api/brain/registry" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" >/dev/null 2>&1 || echo "WARN: registry 写入失败（test: $TEST_FILE）"
  done
  echo "✅ Step 7c: 测试文件已回写 Registry（含 content 字段）"
else
  echo "WARN: ${SPRINT_DIR}/tests 目录不存在，跳过 test registry"
fi
```

---

### Step 8: 生成结构化 Learning（真实复盘，禁止占位符模板）

> **修真规约（v6.5，九要素 T11）**：learning.md 是**你（AI）基于本次 sprint 真实记录写的复盘**，
> 不是 heredoc 模板填充。占位符 learning = 假总结，会被 Step 8c 守卫和 CI 闸门
> （lint-learning-placeholders）双双拦下，直接导致出口降级 DONE_WITH_CONCERNS。

**Step 8a — 收集真实素材：**

```bash
# 统计 GAN 轮次和 Evaluator fix 次数
GAN_ROUNDS=$(curl -s "localhost:5221/api/brain/tasks/$TASK_ID" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('payload',{}).get('gan_rounds',0))" \
  2>/dev/null || echo 0)
EVAL_FIX_COUNT=$GAN_ROUNDS
SPRINT_NAME=$(basename "$SPRINT_DIR")
COMPLETED_AT_SHORT=$(TZ=Asia/Shanghai date '+%m%d%H%M')
```

写作前**必须回顾**以下素材（存在才读，读不到的在 learning 里如实说明）：

1. 进度台账 / relay 各 phase 记录（GAN 对抗轮次、reviewer 挑了什么、proposer 怎么改的）
2. generator / evaluator 阶段的失败与修复过程（本 session 上下文、fix commit 记录）
3. PR 的 CI 失败与 review 往返（Fleet 仅使用已有本地记录；非 Fleet legacy
   才可用 `gh pr view "$PR_URL" --comments`，Fleet 不得执行）
4. `${SPRINT_DIR}/contract-draft.md` 对抗批注与 `${SPRINT_DIR}/.report-concerns`（如有）

**Step 8b — AI 亲自撰写 learning.md**（用 Write 工具写 `${SPRINT_DIR}/learning.md`，骨架如下）：

```markdown
# Learning — <FEATURE_NAME>

## 运行指标

- GAN 轮次：<GAN_ROUNDS>
- Evaluator Fix 次数：<EVAL_FIX_COUNT>
- 总成本：<TOTAL_COST，Relay 入口段已自取；无值写「未采集」>
- PR：<PR_URL>
- Sprint Dir：<SPRINT_DIR>
<!-- TODO(九要素 T7): phase-event 复活后追加 token 用量 / 各 phase 耗时字段 -->

## 发现的问题

### [PROMPT] Prompt 类问题
### [BUG] 代码缺陷
### [INFRA] 基础设施问题
### [DESIGN] 设计缺陷

## 下次预防清单
```

硬规则（违反任何一条 = learning 无效）：

- 每个类目：有真实问题 → 写「现象 → 根因 → 修法」一条一行；确实没有 → 写「无（本次未遇到）」。
- **禁止出现占位符原文**「（无 / 填写」——这是旧模板指纹，CI 见到即红。
- 「下次预防清单」必须从**本次真实问题**提炼 `- [ ]` 条目；四类目全为「无」时写「-（本次无新增预防项）」。
  禁止照抄历史通用三条（contract-draft 格式检查 / DoD [BEHAVIOR] 对应测试 / GAN>2 复盘 evaluator prompt 同时出现 = CI 红）。
- 内容里禁止再用尖括号占位（`<GAN_ROUNDS>` 等骨架变量必须替换为真实值）。

**Step 8c — 占位符守卫（关键步，proven-to-fire）：**

```bash
if grep -q "（无 / 填写" "${SPRINT_DIR}/learning.md" 2>/dev/null; then
  echo "WARN: learning.md 含占位符原文，视为无效复盘"
  echo "CONCERN: Step8:learning.md含占位符" >> "${SPRINT_DIR}/.report-concerns"
fi
# EVA v2 RP4：英文指纹同罪——a85e0582 实证英文 "## Insights (Placeholder)" 字面逃逸了中文守卫
if grep -qi "placeholder" "${SPRINT_DIR}/learning.md" 2>/dev/null; then
  echo "WARN: learning.md 含英文占位符指纹 placeholder，视为无效复盘"
  echo "CONCERN: Step8:learning.md含英文placeholder" >> "${SPRINT_DIR}/.report-concerns"
fi
if grep -q "检查 contract-draft.md 格式是否符合 evaluator 预期" "${SPRINT_DIR}/learning.md" 2>/dev/null \
   && grep -q "确认 DoD 所有 \[BEHAVIOR\] 条目有对应测试" "${SPRINT_DIR}/learning.md" 2>/dev/null \
   && grep -q "GAN 轮次 > 2 时复盘 evaluator prompt 是否过严" "${SPRINT_DIR}/learning.md" 2>/dev/null; then
  echo "WARN: learning.md 下次预防清单为硬编码模板照抄，视为无效复盘"
  echo "CONCERN: Step8:预防清单模板照抄" >> "${SPRINT_DIR}/.report-concerns"
fi
```

**Step 8d — 复制到 docs/learnings/ 永久保留：**

```bash
REPO_ROOT=$(git -C "$SPRINT_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -n "$REPO_ROOT" ]; then
  mkdir -p "${REPO_ROOT}/docs/learnings"
  LEARNING_DEST="${REPO_ROOT}/docs/learnings/cp-${COMPLETED_AT_SHORT}-${SPRINT_NAME}.md"
  cp "${SPRINT_DIR}/learning.md" "$LEARNING_DEST"
  echo "✅ Step 8d: learning.md 已复制到 $LEARNING_DEST"
else
  echo "WARN: 无法定位 git 根目录，跳过 docs/learnings 复制"
  echo "CONCERN: Step8:docs/learnings复制跳过" >> "${SPRINT_DIR}/.report-concerns"
fi
```

**Step 8e — 写入 Brain learnings 表（关键步）：**

先把 learning.md 里的结论提炼成**原子条目**写入 `${SPRINT_DIR}/learning-atoms.json`
（用 Write 工具；每条 = 一句可独立成立的经验/预防措施，1–5 条；四类目全「无」且无预防项 → 空数组）：

```json
{"next_steps_suggested": ["<原子经验条目1>", "<原子经验条目2>"]}
```

然后 POST 到 Brain（learnings 表无 journey/ability 列，谱系经 `task_id` 挂载——task 行携带
journey_id/ability_id，migration 271 对缺 task_id 有告警防御，**必须带**）：

```bash
BRANCH_NAME=$(git -C "$SPRINT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$' || echo "")
REPO_NAME=$(basename "$(git -C "$SPRINT_DIR" remote get-url origin 2>/dev/null)" .git 2>/dev/null || echo "cecelia")

ATOM_COUNT=$(python3 -c "import json;print(len(json.load(open('${SPRINT_DIR}/learning-atoms.json')).get('next_steps_suggested',[])))" 2>/dev/null || echo 0)
if [ "$ATOM_COUNT" -gt 0 ]; then
  LR_RESP=$(python3 -c "
import json
atoms = json.load(open('${SPRINT_DIR}/learning-atoms.json')).get('next_steps_suggested', [])
print(json.dumps({'next_steps_suggested': atoms, 'task_id': '$TASK_ID',
                  'branch_name': '$BRANCH_NAME' or None, 'pr_number': '$PR_NUMBER' or None,
                  'repo': '$REPO_NAME'}))" \
    | curl -s -X POST "localhost:5221/api/brain/learnings-received" \
        -H "Content-Type: application/json" -d @- 2>/dev/null)
  INSERTED=$(echo "$LR_RESP" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('results',{}).get('learnings_inserted',[])))" 2>/dev/null || echo 0)
  if [ "$INSERTED" -gt 0 ]; then
    echo "✅ Step 8e: $INSERTED 条 learning 已写入 Brain learnings 表（task_id=$TASK_ID）"
  else
    echo "WARN: learnings-received 写入失败或 0 条入库（resp: $(echo "$LR_RESP" | head -c 200)）"
    echo "CONCERN: Step8e:learnings表写入失败" >> "${SPRINT_DIR}/.report-concerns"
  fi
else
  echo "ℹ️ Step 8e: 本次无原子经验条目，跳过 learnings 表写入"
fi
```

> ⚠️ `issues_found` 字段**故意不传**：harness 的问题在 merge 前已修完，传了会开多余的 P1 fix task。

**Step 8f — capture_atoms 顺手写（非关键步，best-effort）：**

统一收件箱入口（九要素 T10）在 Brain 侧建设中：Brain 现无 `POST /api/brain/capture-atoms`。
探测式写入，非 2xx 只 WARN 不降级，T10 落地兼容入口后自愈：

```bash
if [ "$ATOM_COUNT" -gt 0 ]; then
  CA_CODE=$(python3 -c "
import json
atoms = json.load(open('${SPRINT_DIR}/learning-atoms.json')).get('next_steps_suggested', [])
print(json.dumps({'atoms': [{'content': a, 'target_type': 'knowledge',
                             'target_subtype': 'harness_learning', 'confidence': 0.8,
                             'ai_reason': 'harness-report Step8 真实复盘提炼'} for a in atoms],
                  'task_id': '$TASK_ID'}))" \
    | curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:5221/api/brain/capture-atoms" \
        -H "Content-Type: application/json" -d @- 2>/dev/null || echo 000)
  case "$CA_CODE" in
    2*) echo "✅ Step 8f: capture_atoms 已写入" ;;
    *)  echo "WARN: capture_atoms 写入不可用（HTTP $CA_CODE，T10 入口未落地属预期）"
        echo "CONCERN: Step8f:capture_atoms未写入(HTTP $CA_CODE)" >> "${SPRINT_DIR}/.report-concerns" ;;
  esac
fi
```

---

### Step 9: 生成 index.html（单文件可视化页面）

```bash
SPRINT_NAME=$(basename "$SPRINT_DIR")

node -e "
const fs = require('fs');
const path = require('path');

const sprintDir = process.env.SPRINT_DIR || '$SPRINT_DIR';
const sprintName = path.basename(sprintDir);
const prUrl = process.env.PR_URL || '$PR_URL';
const featureName = process.env.FEATURE_NAME || '$FEATURE_NAME';

function readMd(name) {
  const p = path.join(sprintDir, name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

const docs = [
  { id: 'prep-prd', label: 'PrepPRD', file: 'prep-prd.md' },
  { id: 'sprint-prd', label: 'PRD', file: 'sprint-prd.md' },
  { id: 'contract', label: 'D-Contract', file: 'contract-draft.md' },
  { id: 'dod', label: 'DOD', file: 'contract-dod.md' },
  { id: 'report', label: 'Report', file: 'harness-report.md' },
  { id: 'learning', label: 'Learning', file: 'learning.md' },
];

// 截图 base64
const screenshotDir = path.join(sprintDir, 'screenshots');
let screenshotHtml = '';
if (fs.existsSync(screenshotDir)) {
  const pngs = fs.readdirSync(screenshotDir).filter(f => f.endsWith('.png'));
  for (const png of pngs) {
    const data = fs.readFileSync(path.join(screenshotDir, png));
    const b64 = data.toString('base64');
    screenshotHtml += \`<div class=\"screenshot\"><p>\${escapeHtml(png)}</p><img src=\"data:image/png;base64,\${b64}\" style=\"max-width:100%;\"/></div>\`;
  }
}

const navItems = docs.map(d => \`<li><a href=\"#\" onclick=\"show('\${d.id}');return false;\">\${d.label}</a></li>\`).join('');
const sections = docs.map(d => {
  const content = readMd(d.file);
  const body = content ? \`<pre style=\"white-space:pre-wrap;word-break:break-word;\">\${escapeHtml(content)}</pre>\` : '<p>（文件不存在）</p>';
  return \`<div id=\"\${d.id}\" class=\"section\" style=\"display:none;\">\${body}</div>\`;
}).join('');

const html = \`<!DOCTYPE html>
<html lang=\"zh\">
<head><meta charset=\"UTF-8\"><title>\${escapeHtml(featureName)} — Sprint Report</title>
<style>
body{font-family:sans-serif;margin:0;display:flex;flex-direction:column;height:100vh;}
header{background:#1a1a2e;color:#fff;padding:12px 24px;display:flex;align-items:center;gap:16px;}
header a{color:#adf;text-decoration:none;}
main{display:flex;flex:1;overflow:hidden;}
nav{width:160px;background:#f4f4f4;border-right:1px solid #ddd;padding:16px 0;overflow-y:auto;}
nav ul{list-style:none;margin:0;padding:0;}
nav li a{display:block;padding:8px 16px;color:#333;text-decoration:none;}
nav li a:hover{background:#e0e0e0;}
.content{flex:1;overflow-y:auto;padding:24px;}
.section pre{background:#f8f8f8;border:1px solid #ddd;padding:16px;border-radius:4px;}
.screenshot{margin-bottom:16px;}
</style>
</head>
<body>
<header>
  <span><strong>\${escapeHtml(featureName)}</strong> Sprint Report</span>
  \${prUrl ? \`<a href=\"\${prUrl}\" target=\"_blank\">PR</a>\` : ''}
</header>
<main>
<nav><ul>
\${navItems}
<li><a href=\"#\" onclick=\"show('screenshots');return false;\">截图</a></li>
</ul></nav>
<div class=\"content\">
\${sections}
<div id=\"screenshots\" class=\"section\" style=\"display:none;\">\${screenshotHtml || '<p>无截图</p>'}</div>
</div>
</main>
<script>
function show(id){document.querySelectorAll('.section').forEach(s=>s.style.display='none');var el=document.getElementById(id);if(el)el.style.display='block';}
// 默认显示第一个有内容的 section
var first = document.querySelector('.section');if(first)first.style.display='block';
</script>
</body></html>\`;

fs.writeFileSync(path.join(sprintDir, 'index.html'), html, 'utf8');
console.log('index.html generated');
" && echo "✅ Step 9a: index.html 已生成到 ${SPRINT_DIR}/index.html"

echo "📎 访问地址: ${REPORT_HOST_URL:-http://38.23.47.81:9998}/sprints/${SPRINT_NAME}/index.html"
```

---

### Phase A 完成标志（三态出口：事后核验产物，禁止「全 WARN 仍 DONE」）

**关键步 vs 非关键步：**

- **关键步**（失败 → 出口降级 `DONE_WITH_CONCERNS`，不许静默 DONE）：Step 1 task.result 回写、Step 6 本地 harness-report.md、Step 8 learning.md（存在 + 无占位符）、Step 8e learnings 表写入、以及「Relay 入口段」关键变量自取失败。
- **非关键步**（失败仍可 DONE，但必须在 concerns 里列明，不许无痕吞掉）：Step 2 Dashboard、Step 2.5/3/3.5 Notion Notes、Step 4 Feature Registry、Step 5 飞书。

核验方式是**事后查实际产物**（curl 查 task.result、探文件存在），不信任各步骤的 `✅ echo`：

```bash
CONCERNS=""

# 关键步核验
TASK_RESULT=$(curl -s "localhost:5221/api/brain/tasks/$TASK_ID" 2>/dev/null | jq -r '.result // empty' 2>/dev/null)
[ -z "$TASK_RESULT" ]                       && CONCERNS="${CONCERNS}Step1:task.result未回写;"
[ ! -f "${SPRINT_DIR}/harness-report.md" ]  && CONCERNS="${CONCERNS}Step6:harness-report.md缺失;"
[ ! -f "${SPRINT_DIR}/learning.md" ]        && CONCERNS="${CONCERNS}Step8:learning.md缺失;"
grep -q "（无 / 填写" "${SPRINT_DIR}/learning.md" 2>/dev/null && CONCERNS="${CONCERNS}Step8:learning.md含占位符;"
# EVA v2 RP4：英文指纹（a85e0582 实证 "## Insights (Placeholder)" 逃逸中文守卫）
grep -qi "placeholder" "${SPRINT_DIR}/learning.md" 2>/dev/null && CONCERNS="${CONCERNS}Step8:learning.md含英文placeholder;"

# EVA v2 RP-learn：learnings 表真实落库计数（a85e0582 全通 run learnings 表 0 条实证，过程 ✅ echo 不可信）
LEARN_N=$(curl -s "localhost:5221/api/brain/learnings?task_id=$TASK_ID" 2>/dev/null \
  | jq 'if type=="array" then length else ((.learnings // .results // []) | length) end' 2>/dev/null || echo 0)
[ "${LEARN_N:-0}" -ge 1 ] || CONCERNS="${CONCERNS}Step8e:learnings表零落地;"

# 汇入过程中记录的 concerns（含 Relay 入口段变量自取失败、非关键步 WARN）
[ -f "${SPRINT_DIR}/.report-concerns" ] && CONCERNS="${CONCERNS}$(tr '\n' ';' < "${SPRINT_DIR}/.report-concerns")"

if [ -n "$CONCERNS" ]; then VERDICT="DONE_WITH_CONCERNS"; else VERDICT="DONE"; fi

# report-result-writer:start
write_report_result() {
  RAW_RESULT_JSON=$(jq -cn \
    --arg verdict "${REPORT_VERDICT:-$VERDICT}" \
    --arg task_id "$TASK_ID" \
    --arg report_path "${SPRINT_DIR}/harness-report.md" \
    --arg pr_url "$PR_URL" \
    --argjson screenshots "${SCREENSHOTS_JSON:-${SCREENSHOTS:-[]}}" \
    --arg concerns "${CONCERNS:-}" \
    '{verdict:$verdict,task_id:$task_id,report_path:$report_path,
      pr_url:$pr_url,screenshots:$screenshots,concerns:$concerns}')
  if [ "${BRAIN_RESULT_CHANNEL_VERSION+x}" = x ] || [ "${BRAIN_RESULT_FILE+x}" = x ]; then
    printf '%s' "$RAW_RESULT_JSON" | node /usr/local/bin/raw-result-writer.cjs
  else
    LEGACY_RESULT_FILE="$(git rev-parse --show-toplevel 2>/dev/null || echo /workspace)/.brain-result.json"
    printf '%s\n' "$RAW_RESULT_JSON" > "$LEGACY_RESULT_FILE"
  fi
}
write_report_result
# report-result-writer:end
echo "[harness-report Phase A] 交付完成，verdict=${REPORT_VERDICT:-$VERDICT}${CONCERNS:+，concerns: $CONCERNS}"
```

`BRAIN_RESULT_CHANNEL_VERSION` 存在时是 managed Kernel；空值/未知值或缺
result file 必须 fail closed。channel version unset 但 `BRAIN_RESULT_FILE`
存在时是 headed/relay override，仍经中央 helper；两者都 unset 才使用 git 根
目录的角色 fallback。

> **给调用方（controller / Brain）的约定**：`DONE_WITH_CONCERNS` ≠ 失败，PR 已合并、流程可收尾，但表示交付报告不完整——controller 应把 concerns 原样写入台账，最终报告必须列明，不得折叠成 DONE。非关键步（Notion/飞书）失败同样要出现在最终报告的列明清单里。

---

## Phase B: Sprint 状态同步

> **调用 `/db-update` skill 执行全部 Brain DB 写入。**
> 详细实现参考见 `~/.claude/skills/harness-report/references/sprint-state-sync.md`（保留作为底层参考）。

**执行方式**：

```
调用 Skill("db-update")
```

`db-update` skill 负责：
1. 读取 `$SPRINT_DIR/sprint-prd.md` + `contract-draft.md` 解析本次产出
2. 按 Output Template 写入 Brain DB（journey_features / api_registry / db_schema_registry / test_registry / skill_registry）
   # journey_steps 保留只读兼容（notion-push-sync 仍同步存量数据），新增数据禁止写入；Ability/Feature 一律写 journey_features
3. 触发 Notion push sync（Brain → Notion 自动同步）
4. 更新 Journey Maturity

**`db-update` 是数据写入的唯一门控**，所有表的 Output Template 和禁止规则都在该 skill 里定义。不允许绕过它直接写 Brain DB 或 Notion。

### 翻牌义务（v6.7 强制清单 — 「台账只点火时写、交付后不翻牌」根治）

> 实证（handoff 0714）：journeys 表 Path2/Path4 的 updated_at 停在 2026-05-22（Path2 定义还是已废弃的飞书版，与用户 07-07「去飞书改本地」决策打架 46 天）；journey_features「视频/图文内容判定门槛」status=planned 而现实已合并 11 个 PR；「Step3 绑飞书」status=done 而方案已废。报告阶段不翻牌 = 台账永久漂移、arch-review 巡检失去数据源。

Phase B 调用 db-update 时，以下三件事是**强制动作**（属关键步：做不到 → DONE_WITH_CONCERNS 并写明原因，禁止静默跳过）：

1. **Feature 翻牌**：本 sprint 推进的 journey_features 条目，status 按 evaluator verdict 翻——PASS 且 PR 已 merge → `done`（若合同「未覆盖真实链路清单」显示真机段未验 → `working` + 备注 `logic-done-pending`）；部分交付 → `working`。**禁止交付后仍留 `planned`**。找不到对应 feature 条目 → 按 db-update 模板补建后再翻。
2. **Journey 回写**：对应 journey step 状态回写 + `journeys.updated_at` 刷新（哪怕本次只推进一小步也要刷，给「台账新鲜度」探针真实信号）。若 journey description 与 decisions 表最新决策冲突（如描述还是已废弃方案）→ **不要静默改写也不要静默跳过**：在报告里标注「待人工确认」并开 issue（走 db-update issues 模板，注明冲突的 decision id）。
3. **smoke 一致性核对**：读该 journey 的 `e2e_test_path` 指向的 smoke 脚本内容，核对它测的还是不是现行方案（对照 decisions 表近 60 天「废弃 / 去X / 改Y」决策关键词）；测已废弃方案 → 开 issue，写明脚本路径 + 冲突 decision id。

**完成标志追加**：Phase B 结束输出「翻牌清单」——本次翻了哪些 feature（`<id>: planned→done`）、刷新了哪个 journey、smoke 核对结论（一致 / 已开 issue #N）。三项都无内容时显式写「本 sprint 无关联 feature/journey（原因：…）」，空清单无原因 = 关键步失败。
---

### Phase B 核验（EVA v2）

Phase B 跑完后**事后查实际产物**（与 Phase A 出口核验同风格，不信任 db-update 的过程输出）：journey_features 与 notes 各查一条本 sprint 记录，任一查不到 → 追加 concern。核验结束必须重新汇总全部 concern、重算 verdict，并调用 Phase A 定义的唯一 writer 覆写结果；禁止让 Phase A 的早期 DONE 吞掉 Phase B 失败。

```bash
# journey_features：本 sprint 推进的 feature 应真实存在（FEATURE_ID 为空 = 无从核验，同样记 concern）
JF_OK=0
if [ -n "$FEATURE_ID" ]; then
  curl -s "localhost:5221/api/brain/journey_features/$FEATURE_ID" 2>/dev/null | grep -q '"id"' && JF_OK=1
fi
[ "$JF_OK" -eq 1 ] || echo "CONCERN: PhaseB:journey_features无本 sprint 记录" >> "${SPRINT_DIR}/.report-concerns"

# notes：Step 3 写入的 Report Note 应真实落库
NOTES_OK=0
curl -s "localhost:5221/api/brain/notes?limit=100" 2>/dev/null | grep -q "Report: $FEATURE_NAME" && NOTES_OK=1
if [ "$NOTES_OK" -eq 0 ] && command -v psql >/dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
  # GET 端点不可用时 psql 等价核验
  NOTE_N=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM notes WHERE title LIKE 'Report: %' AND created_at > now() - interval '1 day'" 2>/dev/null || echo 0)
  [ "${NOTE_N:-0}" -ge 1 ] && NOTES_OK=1
fi
[ "$NOTES_OK" -eq 1 ] || echo "CONCERN: PhaseB:notes无本 sprint 记录" >> "${SPRINT_DIR}/.report-concerns"

# Phase B 结束后从当前真实证据完整重算，不能沿用 Phase A 的内存字符串。
CONCERNS=""
TASK_RESULT=$(curl -s "localhost:5221/api/brain/tasks/$TASK_ID" 2>/dev/null | jq -r '.result // empty' 2>/dev/null)
[ -z "$TASK_RESULT" ]                       && CONCERNS="${CONCERNS}Step1:task.result未回写;"
[ ! -f "${SPRINT_DIR}/harness-report.md" ]  && CONCERNS="${CONCERNS}Step6:harness-report.md缺失;"
[ ! -f "${SPRINT_DIR}/learning.md" ]        && CONCERNS="${CONCERNS}Step8:learning.md缺失;"
grep -q "（无 / 填写" "${SPRINT_DIR}/learning.md" 2>/dev/null && CONCERNS="${CONCERNS}Step8:learning.md含占位符;"
grep -qi "placeholder" "${SPRINT_DIR}/learning.md" 2>/dev/null && CONCERNS="${CONCERNS}Step8:learning.md含英文placeholder;"
LEARN_N=$(curl -s "localhost:5221/api/brain/learnings?task_id=$TASK_ID" 2>/dev/null \
  | jq 'if type=="array" then length else ((.learnings // .results // []) | length) end' 2>/dev/null || echo 0)
[ "${LEARN_N:-0}" -ge 1 ] || CONCERNS="${CONCERNS}Step8e:learnings表零落地;"
[ -f "${SPRINT_DIR}/.report-concerns" ] && CONCERNS="${CONCERNS}$(tr '\n' ';' < "${SPRINT_DIR}/.report-concerns")"
if [ -n "$CONCERNS" ]; then VERDICT="DONE_WITH_CONCERNS"; else VERDICT="DONE"; fi
REPORT_VERDICT="$VERDICT"
export REPORT_VERDICT
write_report_result

echo "[harness-report Phase B 核验] journey_features=$JF_OK notes=$NOTES_OK（0 项已记 .report-concerns）"
```

> a85e0582 全通 run 实证：notes 里只有 mjs 降级脚本产的英文 Placeholder 记录——本核验用于抓住「Phase B 看似跑完但真实表无本 sprint 痕迹」的静默失效。
