---
id: harness-report-skill
description: |
  Harness Report — Harness v5.0 最终步骤：6步完整交付。
  1.回写Brain任务状态 2.更新中台Dashboard 3.写Notion AI Notes（含GAN标注表+截图链接）
  4.更新Notion Feature Registry（status→done）5.飞书通知（含PR+截图）6.写本地harness-report.md备份。
version: 5.0.0
created: 2026-04-08
updated: 2026-05-23
changelog:
  - 5.0.0: 6步完整交付 — 回写Brain任务状态 + 更新中台Dashboard + 写Notion AI Notes（GAN标注表+截图链接+DoD结果）+ 更新Notion Feature Registry + 飞书通知（含PR+截图） + 写本地harness-report.md
  - 4.0.0: Harness v4.0 Report（独立 skill，新增 CI/Deploy watch 状态）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-report — Harness v5.0 最终报告（6步完整交付）

**角色**: Reporter  
**对应 task_type**: `harness_report`

---

## 执行流程

### 注入变量

```bash
# TASK_ID、SPRINT_DIR、PROJECT_ID、FEATURE_ID、FEATURE_NAME、SUB_AREA、
# PR_URL、TOTAL_COST、SCREENSHOTS 由 cecelia-run 通过 prompt 注入，直接使用
# SCREENSHOTS: JSON 数组字符串，如 ["http://38.23.47.81:9998/harness-screenshots/sprint-xxx/01-initial.png"]
# FEATURE_NAME: PRD 中的 feature 名称
# SUB_AREA: brain|engine|dashboard|zenithjoy|multi-agent
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

### Step 3: 写 Notion AI Notes（GAN 标注表 + 截图链接 + DoD 结果）

```bash
# 从 contract-draft.md 提取 GAN 标注表（FROM_PRD vs AI_ADDED）
GAN_FROM_PRD=""
GAN_AI_ADDED=""
if [ -f "${SPRINT_DIR}/contract-draft.md" ]; then
  # 提取所有带 [FROM_PRD] 的 Step 行
  while IFS= read -r line; do
    GAN_FROM_PRD+="| FROM_PRD | $line |\n"
  done < <(grep -B1 '\[FROM_PRD\]' "${SPRINT_DIR}/contract-draft.md" | grep '^### Step' | sed 's/### //' | head -10)
  # 提取所有带 [AI_ADDED] 的 Step 行（含理由）
  while IFS= read -r line; do
    GAN_AI_ADDED+="| AI_ADDED | $line |\n"
  done < <(grep -B1 '\[AI_ADDED\]' "${SPRINT_DIR}/contract-draft.md" | grep '^### Step' | sed 's/### //' | head -10)
fi

GAN_TABLE="## GAN 来源标注表\n\n| 来源 | 步骤 |\n|------|------|\n${GAN_FROM_PRD}${GAN_AI_ADDED}"

# 构建截图链接段落
SCREENSHOT_LINKS=""
for url in $(echo "$SCREENSHOTS" | jq -r '.[]' 2>/dev/null); do
  SCREENSHOT_LINKS+="- $url\n"
done

NOTION_BODY=$(printf '%s\n' \
  "# Harness 完成：$FEATURE_NAME" \
  "" \
  "**PR**: $PR_URL" \
  "**总成本**: \$$TOTAL_COST USD" \
  "" \
  "$(printf '%b' "$GAN_TABLE")" \
  "" \
  "## 截图链接" \
  "" \
  "$(printf '%b' "$SCREENSHOT_LINKS")" \
  "" \
  "## DoD 验证结果" \
  "" \
  "所有 ARTIFACT + BEHAVIOR 条目已验证通过（evaluator PASS）。")

curl -X POST "localhost:5221/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Harness 完成：$FEATURE_NAME\",
    \"type\": \"Log\",
    \"sub_area\": \"$SUB_AREA\",
    \"body\": $(echo "$NOTION_BODY" | jq -Rs .)
  }" 2>/dev/null || echo "WARN: Notion Notes 写入失败（非阻断）"
echo "✅ Step 3: Notion AI Notes 已写入（GAN标注表 + 截图链接）"
```

---

### Step 3.5: 文档归档（PrepPRD/PRD/Contract）

```bash
# 分别读取 PrepPRD / PRD / Contract 文档，逐一写入 Notion AI Notes
# 文件不存在时跳过（非阻断）
for DOC_PAIR in "prep-prd.md:PrepPRD" "sprint-prd.md:PRD" "contract-draft.md:Contract"; do
  DOC_FILE="${DOC_PAIR%%:*}"
  DOC_TYPE="${DOC_PAIR##*:}"
  DOC_PATH="${SPRINT_DIR}/${DOC_FILE}"

  if [ ! -f "$DOC_PATH" ]; then
    echo "SKIP: $DOC_FILE 不存在，跳过（非阻断）"
    continue
  fi

  DOC_CONTENT=$(cat "$DOC_PATH")
  curl -X POST "localhost:5221/api/brain/notes" \
    -H "Content-Type: application/json" \
    -d "{
      \"title\": \"${DOC_TYPE} 文档：${FEATURE_NAME}\",
      \"type\": \"Log\",
      \"sub_area\": \"$SUB_AREA\",
      \"body\": $(echo "$DOC_CONTENT" | jq -Rs .)
    }" 2>/dev/null || echo "WARN: Notion Notes 写入失败（$DOC_TYPE，非阻断）"
  echo "✅ 已归档 $DOC_TYPE（$DOC_FILE）到 Notion AI Notes"
done
echo "✅ Step 3.5: 文档归档完成（PrepPRD/PRD/Contract）"
```

---

### Step 4: 更新 Notion Feature Registry

```bash
node ~/.claude/skills/walking-skeleton/scripts/add-feature.js \
  --feature-id "$FEATURE_ID" \
  --status "done" 2>/dev/null || echo "WARN: Feature Registry 更新失败（非阻断）"
echo "✅ Step 4: Notion Feature Registry status → done"
```

---

### Step 5: 飞书通知（一句话 + PR 链接 + 截图）

```bash
FEISHU_MSG="PR: $PR_URL"
if [ -n "$FIRST_SCREENSHOT_URL" ]; then
  FEISHU_MSG="$FEISHU_MSG\n截图: $FIRST_SCREENSHOT_URL"
fi

curl -X POST "localhost:5221/api/brain/notify" \
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

## PRD 目标

$(head -30 "${SPRINT_DIR}/sprint-prd.md" 2>/dev/null || echo "(sprint-prd.md 不存在)")

## GAN 对抗过程

（详见 Notion AI Notes: Harness 完成：$FEATURE_NAME）

## 截图链接

$(echo "$SCREENSHOTS" | jq -r '.[]' 2>/dev/null | while read url; do echo "- $url"; done)

## DoD 验证结果

所有 ARTIFACT + BEHAVIOR 条目验证通过（evaluator PASS）。

## 交付结论

✅ Harness v5.0 完成。PR 已合并，Notion 已更新，飞书已通知。
REPORT

echo "✅ Step 6: harness-report.md 已写入 ${SPRINT_DIR}/harness-report.md"
```

---

**最后一条消息**（Brain 读文件协议）：

```bash
cat > /workspace/.brain-result.json << BREOF
{"verdict":"DONE","task_id":"$TASK_ID","report_path":"${SPRINT_DIR}/harness-report.md","pr_url":"$PR_URL","screenshots":$SCREENSHOTS}
BREOF
echo "[harness-report] 6步交付完成，.brain-result.json 已写入"
```
