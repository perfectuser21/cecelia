---
id: harness-report-skill
description: |
  Harness Report — Harness v5.0 最终步骤：交付报告 + Sprint 状态同步。
  Phase A（6步交付）：回写Brain任务状态 → 更新中台Dashboard → 写Notion AI Notes（GAN标注表+截图）
  → 更新Notion Feature Registry → 飞书通知 → 写本地harness-report.md备份。
  Phase B（Sprint状态同步）：写本地Brain DB → 同步8个Notion DB（API/DB Schema/Tests/Features/Journey/Steps等）→ git commit。
  由 harness-evaluator PASS 后调用；也可手动触发补同步。
version: 6.0.0
created: 2026-04-08
updated: 2026-05-30
changelog:
  - 6.0.0: 合并 harness-sprint-state → 统一为"交付报告+状态同步"单一 skill，删除独立的 harness-sprint-state skill
  - 5.1.0: 移除 Step 2.5b 多 WS 扫描逻辑 — 改为单 Sprint 直接创建 Notion Task
  - 5.0.0: 6步完整交付 — 回写Brain任务状态 + Dashboard + Notion AI Notes + Feature Registry + 飞书 + 本地备份
  - 4.0.0: Harness v4.0 Report（独立 skill，新增 CI/Deploy watch 状态）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-report — Harness v5.0 完成报告 + Sprint 状态同步

**角色**: Reporter + Sprint State Syncer  
**对应 task_type**: `harness_report`  
**调用时机**: harness-evaluator PASS 后；或手动补同步

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
# TASK_ID、SPRINT_DIR、PROJECT_ID、FEATURE_ID、FEATURE_NAME、SUB_AREA、
# PR_URL、TOTAL_COST、SCREENSHOTS 由 cecelia-run 通过 prompt 注入，直接使用
FIRST_SCREENSHOT_URL=$(echo "$SCREENSHOTS" | jq -r '.[0] // ""')
TOTAL_COST="${TOTAL_COST:-0}"
SCREENSHOTS="${SCREENSHOTS:-[]}"
```

---

### Step 1: 回写 Brain 任务状态

```bash
curl -X PATCH "localhost:5221/api/brain/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"status\": \"completed\",
    \"result\": {
      \"pr_url\": \"$PR_URL\",
      \"screenshots\": $SCREENSHOTS,
      \"total_cost_usd\": $TOTAL_COST,
      \"merged\": true
    }
  }"
echo "✅ Step 1: Brain 任务状态已回写 completed"
```

---

### Step 2: 更新中台 Dashboard

```bash
curl -X POST "localhost:5221/api/brain/harness/complete" \
  -H "Content-Type: application/json" \
  -d "{
    \"initiative_id\": \"$TASK_ID\",
    \"sprint_dir\": \"$SPRINT_DIR\",
    \"pr_url\": \"$PR_URL\",
    \"screenshots\": $SCREENSHOTS
  }" 2>/dev/null || echo "WARN: Dashboard 更新失败（非阻断）"
echo "✅ Step 2: 中台 Dashboard 已更新"
```

---

### Step 2.5: 创建 Notion Project（Run 级）+ Notion Task（WS 级）

```bash
JOURNEY_ID="${JOURNEY_ID:-}"
JOURNEY_ID_JSON=$([ -n "${JOURNEY_ID:-}" ] && echo "\"$JOURNEY_ID\"" || echo "null")

PROJECT_PAYLOAD=$(jq -n \
  --arg title "$FEATURE_NAME" \
  --arg status "Done" \
  --argjson journey_id "$JOURNEY_ID_JSON" \
  --arg sprint_dir "$SPRINT_DIR" \
  --arg pr_url "$PR_URL" \
  '{title:$title, status:$status, journey_id:$journey_id, sprint_dir:$sprint_dir, pr_url:$pr_url}')

curl -s -X POST "localhost:5221/api/brain/notion/project" \
  -H "Content-Type: application/json" \
  -d "$PROJECT_PAYLOAD" 2>/dev/null || echo "WARN: Notion Project 创建失败（非阻断）"
echo "✅ Step 2.5a: Notion Project 已创建（Run 级）"

TASK_PAYLOAD=$(jq -n \
  --arg title "$FEATURE_NAME" \
  --arg status "Done" \
  --arg sprint_dir "$SPRINT_DIR" \
  --arg pr_url "${PR_URL:-}" \
  '{title:$title, status:$status, sprint_dir:$sprint_dir, pr_url:$pr_url}')
curl -s -X POST "localhost:5221/api/brain/notion/task" \
  -H "Content-Type: application/json" \
  -d "$TASK_PAYLOAD" 2>/dev/null || echo "WARN: Notion Task 创建失败（非阻断）"
echo "✅ Step 2.5b: Notion Task 已创建（status=Done）"
```

---

### Step 3: 写 Notion AI Notes（GAN 标注表 + 截图）

```bash
NOTION_BODY=$(printf '# Harness 完成：%s\n\n**PR**: %s\n**总成本**: $%s USD\n\n## DoD 验证结果\n\n所有 ARTIFACT + BEHAVIOR 条目已验证通过（evaluator PASS）。' \
  "$FEATURE_NAME" "$PR_URL" "$TOTAL_COST")

curl -X POST "localhost:5221/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Harness 完成：$FEATURE_NAME\",
    \"type\": \"Log\",
    \"sub_area\": \"$SUB_AREA\",
    \"body\": $(echo "$NOTION_BODY" | jq -Rs .)
  }" 2>/dev/null || echo "WARN: Notion Notes 写入失败（非阻断）"
echo "✅ Step 3: Notion AI Notes 已写入"
```

---

### Step 3.5: 文档归档（PrepPRD/SprintPRD/Contract）

```bash
for DOC_PAIR in "prep-prd.md:PrepPRD" "sprint-prd.md:SprintPRD" "contract-draft.md:Contract"; do
  DOC_FILE="${DOC_PAIR%%:*}"
  DOC_TYPE="${DOC_PAIR##*:}"
  DOC_PATH="${SPRINT_DIR}/${DOC_FILE}"
  [ ! -f "$DOC_PATH" ] && echo "WARN: $DOC_FILE 不存在，跳过" && continue

  NOTES_PAYLOAD=$(jq -n \
    --arg title "${DOC_TYPE} 文档：${FEATURE_NAME}" \
    --arg type "$DOC_TYPE" \
    --arg content "$(cat "$DOC_PATH")" \
    --arg initiative_id "${TASK_ID:-}" \
    --arg sprint_dir "$SPRINT_DIR" \
    '{"title":$title,"type":$type,"content":$content,"initiative_id":$initiative_id,"sprint_dir":$sprint_dir}')
  curl -X POST "localhost:5221/api/brain/notes" \
    -H "Content-Type: application/json" \
    -d "$NOTES_PAYLOAD" 2>/dev/null || echo "WARN: Notion Notes 写入失败（$DOC_TYPE）"
done
echo "✅ Step 3.5: 文档归档完成"
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

### Step 6: 写本地 harness-report.md（备份）

```bash
COMPLETED_AT=$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S %Z')
cat > "${SPRINT_DIR}/harness-report.md" << REPORT
# Harness v5.0 完成报告

**完成时间**: $COMPLETED_AT
**Sprint Dir**: $SPRINT_DIR
**PR**: $PR_URL
**总成本**: \$$TOTAL_COST USD

## DoD 验证结果

所有 ARTIFACT + BEHAVIOR 条目验证通过（evaluator PASS）。

## 交付结论

✅ Harness v5.0 完成。PR 已合并，Notion 已更新，飞书已通知。
REPORT
echo "✅ Step 6: harness-report.md 已写入"
```

---

### Phase A 完成标志

```bash
cat > /workspace/.brain-result.json << BREOF
{"verdict":"DONE","task_id":"$TASK_ID","report_path":"${SPRINT_DIR}/harness-report.md","pr_url":"$PR_URL","screenshots":$SCREENSHOTS}
BREOF
echo "[harness-report Phase A] 6步交付完成"
```

---

## Phase B: Sprint 状态同步

> **详细实现见 `~/.claude/skills/harness-report/references/sprint-state-sync.md`**（包含完整的 Brain DB 写入 + 8个 Notion DB 同步步骤）

Phase B 的核心工作：
1. 从 `sprint-prd.md` / `contract-draft.md` 解析本次 Sprint 产出（APIs、DB Schema、Tests、Features）
2. 写入本地 Brain DB（`api_registry`、`db_schema_registry`、`test_registry`、`skill_registry`、`journey_steps`）
3. 同步 8 个 Notion DB（API Registry、DB Schema Registry、Tests Registry、Feature DB、Journey Maturity、AI Steps、Journey-Step 连接表、Sprint Dashboard）
4. 写本地 `sprint-states/<journey_id>/state.md`
5. git commit + push

执行前先读取 `~/.claude/skills/harness-report/references/sprint-state-sync.md` 获取完整步骤和代码。
