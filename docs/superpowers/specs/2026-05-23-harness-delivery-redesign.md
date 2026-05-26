# Harness 交付层改造设计规格

**日期**: 2026-05-23  
**分支**: cp-0523114021-harness-delivery-redesign  
**涉及文件**: packages/workflows/skills/ 下三个 skill

---

## 背景与目标

harness pipeline 现有三个问题：
1. **GAN 对抗无标注**：proposer/reviewer 加的合同条款，用户不知道哪些是自己说的、哪些是 AI 加的
2. **DoD 只有 API 层**：`contract-dod-ws{N}.md` 只有 `[BEHAVIOR]`（Integration 层 curl），没有 E2E 层（Playwright + 截图）
3. **harness-report 近乎空白**：只写 markdown 文件，没有 Brain 状态更新、Notion、Dashboard、飞书通知

---

## 改动 1：harness-contract-proposer（v7.10.0 → v7.11.0）

### 1a. GAN 标注

在 `contract-draft.md` 每个 Golden Path Step 加 **来源标签**：

```markdown
### Step 1: 触发 API 调用
**来源**: `[FROM_PRD]` — PRD 第 3 行直接定义

### Step 2: DB 写入带时间窗口防造假
**来源**: `[AI_ADDED]` — GAN Round 2 Reviewer 加入，理由：防止 generator 利用历史记录绕过验证
```

**规则**：
- `[FROM_PRD]`：能在 PRD 里找到对应原文/意图
- `[AI_ADDED]`：proposer/reviewer 为健壮性/防造假/架构需要添加的，附一句理由

### 1b. DoD 新增 BEHAVIOR:E2E 段

`contract-dod-ws{N}.md` 对 `journey_type=user_facing` 时必须新增第三段：

```markdown
## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 用户完整走完 Golden Path，截图可视化验证
  Screenshots:
    - 01-initial.png   期望：{页面正常加载，描述关键元素}
    - 02-action.png    期望：{用户操作后状态，描述关键变化}
    - 03-result.png    期望：{最终结果，描述成功标志}
  期望：所有截图与期望描述一致，Claude Read 图自验通过
```

### 1c. mac_web Playwright 模板加截图

在 `contract-draft.md` 的 `target_environment = mac_web` E2E 模板里，每个关键操作后加：

```javascript
await page.screenshot({ path: 'screenshots/01-initial.png' });
// ...操作...
await page.screenshot({ path: 'screenshots/02-action.png' });
// ...断言...
await page.screenshot({ path: 'screenshots/03-result.png' });
```

---

## 改动 2：harness-evaluator（v1.8.0 → v1.9.0）

### 模式 B（mac_web）跑完 Playwright 后新增步骤

```bash
# Step B-2.5: 截图处理（仅 mac_web）
SPRINT_BASENAME=$(basename "$SPRINT_DIR")
SCREENSHOT_DEST="$HOME/claude-output/harness-screenshots/$SPRINT_BASENAME"
mkdir -p "$SCREENSHOT_DEST"

# 1. 复制截图到公网目录
if ls screenshots/*.png 2>/dev/null | head -1; then
  cp screenshots/*.png "$SCREENSHOT_DEST/"
fi

# 2. Claude Read 每张截图自验（视觉确认）
# evaluator 必须 Read 每张 PNG，确认画面内容与 DoD [BEHAVIOR:E2E] 期望描述一致
# 不一致 → verdict=FAIL，feedback 说明哪张图与期望不符

# 3. 生成公网链接列表
SCREENSHOT_URLS=()
for f in "$SCREENSHOT_DEST"/*.png; do
  [ -f "$f" ] || continue
  BASENAME=$(basename "$f")
  SCREENSHOT_URLS+=("http://38.23.47.81:9998/harness-screenshots/$SPRINT_BASENAME/$BASENAME")
done
SCREENSHOTS_JSON=$(printf '%s\n' "${SCREENSHOT_URLS[@]}" | jq -R . | jq -s .)

# 4. 写入结果（含截图 URL）
cat > /workspace/.brain-result.json << BREOF
{"verdict":"PASS","task_id":"$TASK_ID","failed_step":null,"log_excerpt":null,"screenshots":$SCREENSHOTS_JSON}
BREOF
```

---

## 改动 3：harness-report（v4.0.0 → v5.0.0）

6 步完整交付流程：

```bash
# Step 1: 回写 Brain 任务状态
curl -X PATCH "localhost:5221/api/brain/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"completed\",\"result\":{
    \"pr_url\":\"$PR_URL\",
    \"screenshots\":$SCREENSHOTS,
    \"total_cost_usd\":$TOTAL_COST,
    \"merged\":true
  }}"

# Step 2: 更新中台 Dashboard
curl -X POST "localhost:5221/api/brain/harness/complete" \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$TASK_ID\",\"sprint_dir\":\"$SPRINT_DIR\",
       \"pr_url\":\"$PR_URL\",\"screenshots\":$SCREENSHOTS}"

# Step 3: 写 Notion AI Notes（含 GAN 标注表 + 截图链接）
curl -X POST "localhost:5221/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Harness 完成：$FEATURE_NAME\",
    \"type\": \"Log\",
    \"sub_area\": \"$SUB_AREA\",
    \"body\": \"$NOTION_BODY\"
  }"
# NOTION_BODY 包含：
#   - GAN 标注表（FROM_PRD vs AI_ADDED 两列）
#   - 截图公网链接（每张一行，带期望描述）
#   - DoD 验证结果汇总
#   - PR 链接 + CI 状态

# Step 4: 更新 Notion Feature Registry
node ~/.claude/skills/walking-skeleton/scripts/add-feature.js \
  --feature-id "$FEATURE_ID" \
  --status "done" 2>/dev/null || true

# Step 5: 飞书通知（一句话 + PR + 截图）
curl -X POST "localhost:5221/api/brain/notify" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"harness_complete\",
    \"title\": \"✅ $FEATURE_NAME 完成\",
    \"message\": \"PR: $PR_URL\n截图: $FIRST_SCREENSHOT_URL\"
  }"

# Step 6: 写本地 harness-report.md（备份）
cat > "${SPRINT_DIR}/harness-report.md" << REPORT
# Harness 完成报告

...（完整内容含 GAN 标注表 + 截图链接 + DoD 结果）...
REPORT
```

---

## 测试策略

**改动类型**：skill 文件（.md 指令），无可执行代码，无需 unit/integration test。

**验证方式**：
- `[ARTIFACT]` 检查：三个 skill 文件包含新增关键词（`FROM_PRD`、`BEHAVIOR:E2E`、`Step 5: 飞书`）
- `[BEHAVIOR]`：下次真实 harness 跑时端到端验证（目前为 spec-only 改动）

---

## 涉及文件

| 文件 | 改动类型 | 版本 |
|---|---|---|
| `packages/workflows/skills/harness-contract-proposer/SKILL.md` | 新增 GAN 标注规则 + [BEHAVIOR:E2E] 模板 + 截图调用 | 7.10.0 → 7.11.0 |
| `packages/workflows/skills/harness-evaluator/SKILL.md` | 新增 B-2.5 截图处理步骤 | 1.8.0 → 1.9.0 |
| `packages/workflows/skills/harness-report/SKILL.md` | 从 2 步扩展到 6 步完整交付 | 4.0.0 → 5.0.0 |

**注**：技能在 `packages/workflows/skills/`，不触发 Engine 5 文件版本 bump（Engine 规则仅限 `packages/engine/`）。
