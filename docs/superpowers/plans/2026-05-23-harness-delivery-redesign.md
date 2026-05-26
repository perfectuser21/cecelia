# Harness 交付层改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改造 harness pipeline 交付层，三处改动：(1) harness-contract-proposer 加 GAN来源标注 + DoD BEHAVIOR:E2E 段 + Playwright 截图调用；(2) harness-evaluator Mode B mac_web 截图处理 + 视觉自验；(3) harness-report 从 2 步扩展到 6 步完整交付。

**Architecture:** 三个 packages/workflows/skills/ 下的 SKILL.md 文件均为 AI 指令文件（Markdown），无可执行代码。改动纯文本追加/修改。验证方式：grep 关键字 artifact 检查。

**Tech Stack:** Bash (grep/git)，无外部依赖

---

## File Structure

| 文件 | 改动类型 | 涉及行 |
|---|---|---|
| `packages/workflows/skills/harness-contract-proposer/SKILL.md` | 新增 3 处内容 + version/changelog | 约 130-250 行区域（合同模板）+ 460-540 行区域（DoD模板）|
| `packages/workflows/skills/harness-evaluator/SKILL.md` | 新增 Step B-2.5 + 更新 B-3 输出格式 | 约 358-490 行区域（Mode B 执行）|
| `packages/workflows/skills/harness-report/SKILL.md` | 执行流程完全重写（2步→6步）+ version/changelog | 全文替换执行流程段 |

---

## Task 1: harness-contract-proposer SKILL.md（v7.10.0 → v7.11.0）

三处新增：GAN来源标注规则 + DoD BEHAVIOR:E2E 段 + mac_web 截图调用

**Files:**
- Modify: `packages/workflows/skills/harness-contract-proposer/SKILL.md`

- [ ] **Step 1: 验证关键词 FROM_PRD 不存在（预期 FAIL）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-delivery-redesign
grep -c 'FROM_PRD' packages/workflows/skills/harness-contract-proposer/SKILL.md || true
```

预期输出：`0`（或命令返回 exit 1，关键词不存在）

- [ ] **Step 2: 在 contract-draft.md 模板的 Step 1 和 Step 2 中加入来源标签**

找到 `### Step 1: {触发描述}` 所在行（约 138 行），在 `**可观测行为**:` 前面加 `**来源**:` 行：

```bash
# 原文（约 138-140 行）：
### Step 1: {触发描述}

**可观测行为**: {外部可见的结果，不写实现}
```

改为：

```bash
### Step 1: {触发描述}
**来源**: `[FROM_PRD]` — PRD 第 X 行/段直接定义（可在 PRD 原文找到对应意图）

**可观测行为**: {外部可见的结果，不写实现}
```

同样对 `### Step 2:` 添加：

```
### Step 2: {系统处理描述}
**来源**: `[AI_ADDED]` — GAN Round N Reviewer/Proposer 加入，理由：{一句话防造假/健壮性理由}

**可观测行为**: {...}
```

使用 Edit 工具修改文件，将原来的 Step 1 模板：

```markdown
### Step 1: {触发描述}

**可观测行为**: {外部可见的结果，不写实现}
```

替换为：

```markdown
### Step 1: {触发描述}
**来源**: `[FROM_PRD]` — PRD 第 X 行/段直接定义（可在 PRD 原文找到对应意图）

**可观测行为**: {外部可见的结果，不写实现}
```

将原来的 Step 2 模板：

```markdown
### Step 2: {系统处理描述}

**可观测行为**: {...}
```

替换为：

```markdown
### Step 2: {系统处理描述}
**来源**: `[AI_ADDED]` — GAN Round N Reviewer/Proposer 加入，理由：{一句话防造假/健壮性理由}

**可观测行为**: {...}
```

将 Step N 模板：

```markdown
### Step N: {出口描述}

**可观测行为**: {...}
**验证命令**: `...`
**硬阈值**: ...
```

替换为：

```markdown
### Step N: {出口描述}
**来源**: `[FROM_PRD]` 或 `[AI_ADDED]` — {理由}

**可观测行为**: {...}
**验证命令**: `...`
**硬阈值**: ...
```

- [ ] **Step 3: 在 Step 2 验证命令规范段之后新增 GAN 来源标注规则段**

找到以下内容（约 371-378 行）：

```markdown
**验证命令写作规范**（Reviewer 重点检查，GAN 对抗焦点）：

- 命令必须可直接执行（含 $DB/$TASK_ID 等环境变量须可替换）
```

在其**之后**、`### ⚠️ 死规则（v7.5 — 修 Bug 8 proposer 漂 PRD 字段名）` **之前**，插入：

```markdown
### ⚠️ GAN 来源标注规则（v7.11.0 — 来源透明性）

每个 Golden Path Step **必须**在步骤标题行之后立即声明 `**来源**:` 标签：

**规则**：
- `[FROM_PRD]`：能在 PRD 里找到对应原文/意图（必须引用 PRD 具体行号或段落名称）
- `[AI_ADDED]`：proposer/reviewer 为健壮性/防造假/架构需要添加的，**必须附一句理由**（如"防止 generator 利用历史记录绕过时间窗口验证"）
- Reviewer 审查 Step 来源标签是否正确（`[FROM_PRD]` 标注的内容必须能在 PRD 原文找到）
- GAN 收敛后在 Notion AI Notes 写入 GAN 标注表（两列：FROM_PRD 来源步骤 | AI_ADDED 步骤+理由）

**反例（Reviewer 必须打回）**：
- `[FROM_PRD]` 标了但 PRD 里找不到对应文字 → REVISION
- `[AI_ADDED]` 没附理由 → REVISION
- 整个合同没有任何 `[AI_ADDED]` 标注但明显有 GAN 加的防造假逻辑 → REVISION（说明 proposer 没诚实标注）

```

- [ ] **Step 4: 在 contract-dod-ws{N}.md 模板中新增 BEHAVIOR:E2E 段（user_facing 专属）**

找到以下内容（约 538-541 行）：

```markdown
模式B E2E（final-e2e 跑，UI-level，Playwright 真实浏览器）写在 ## E2E 验收 区块（见下方）。

DODEOF
```

将 `DODEOF` 之前插入：

```markdown
## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 用户完整走完 Golden Path，截图可视化验证
  Screenshots:
    - 01-initial.png   期望：{页面正常加载，描述关键 UI 元素可见}
    - 02-action.png    期望：{用户操作后状态变化，描述关键变化}
    - 03-result.png    期望：{最终结果页面，描述成功标志元素}
  期望：所有截图与期望描述一致，Claude Read 图自验通过

```

整个替换区段（原）：

```markdown
模式B E2E（final-e2e 跑，UI-level，Playwright 真实浏览器）写在 ## E2E 验收 区块（见下方）。

DODEOF
```

替换为：

```markdown
模式B E2E（final-e2e 跑，UI-level，Playwright 真实浏览器）写在 ## E2E 验收 区块（见下方）。

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 用户完整走完 Golden Path，截图可视化验证
  Screenshots:
    - 01-initial.png   期望：{页面正常加载，描述关键 UI 元素可见}
    - 02-action.png    期望：{用户操作后状态变化，描述关键变化}
    - 03-result.png    期望：{最终结果页面，描述成功标志元素}
  期望：所有截图与期望描述一致，Claude Read 图自验通过

DODEOF
```

- [ ] **Step 5: 在 mac_web Playwright 模板中加入 page.screenshot() 调用**

找到 mac_web E2E 模板（约 214-249 行）：

```javascript
  // 2. 模拟用户操作（填表 / 点击 / 选择）
  await page.fill('[data-testid="{input_field}"]', '{test_value}');
  await page.click('[data-testid="{submit_button}"]');

  // 3. 断言 UI 响应（必须含显式断言，禁止只 navigate 不断言）
  await expect(page.locator('[data-testid="{result_element}"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="{result_element}"]')).toHaveText('{expected_text}');

  // 4. 交叉验证后端状态（防止前端撒谎）
```

替换为：

```javascript
  // 2. 模拟用户操作（填表 / 点击 / 选择）
  await page.screenshot({ path: 'screenshots/01-initial.png' });
  await page.fill('[data-testid="{input_field}"]', '{test_value}');
  await page.click('[data-testid="{submit_button}"]');
  await page.screenshot({ path: 'screenshots/02-action.png' });

  // 3. 断言 UI 响应（必须含显式断言，禁止只 navigate 不断言）
  await expect(page.locator('[data-testid="{result_element}"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="{result_element}"]')).toHaveText('{expected_text}');
  await page.screenshot({ path: 'screenshots/03-result.png' });

  // 4. 交叉验证后端状态（防止前端撒谎）
```

- [ ] **Step 6: 更新 version 和 changelog**

将文件头部：

```yaml
version: 7.10.0
```

改为：

```yaml
version: 7.11.0
```

在 changelog 顶部（`- 7.10.0:` 之前）插入：

```yaml
  - 7.11.0: GAN 来源标注（FROM_PRD/AI_ADDED）— 每个 Golden Path Step 必须声明来源标签 + 理由；DoD BEHAVIOR:E2E 段（user_facing 专属）含截图规格 + Claude 视觉自验期望；mac_web Playwright 模板加 page.screenshot() 在关键操作前后
```

- [ ] **Step 7: 验证关键词存在（预期 PASS）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-delivery-redesign
grep -c 'FROM_PRD' packages/workflows/skills/harness-contract-proposer/SKILL.md
grep -c 'BEHAVIOR:E2E' packages/workflows/skills/harness-contract-proposer/SKILL.md
grep -c 'page.screenshot' packages/workflows/skills/harness-contract-proposer/SKILL.md
```

预期：三行均输出 `≥ 1`（非零）

- [ ] **Step 8: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/harness-delivery-redesign
git add packages/workflows/skills/harness-contract-proposer/SKILL.md
git commit -m "feat(harness-contract-proposer): v7.11.0 — GAN来源标注 + BEHAVIOR:E2E DoD段 + Playwright截图调用"
```

---

## Task 2: harness-evaluator SKILL.md（v1.8.0 → v1.9.0）

新增 Step B-2.5 截图处理 + 更新 brain-result.json 包含 screenshots 字段

**Files:**
- Modify: `packages/workflows/skills/harness-evaluator/SKILL.md`

- [ ] **Step 1: 验证关键词不存在（预期 FAIL）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-delivery-redesign
grep -c 'B-2.5' packages/workflows/skills/harness-evaluator/SKILL.md || true
```

预期：`0`

- [ ] **Step 2: 在 Step B-2 和 Step B-3 之间插入 Step B-2.5**

找到（约 471 行）：

```markdown
#### Step B-3: 判断结果
```

在其**之前**插入完整的 Step B-2.5 内容：

```markdown
#### Step B-2.5: 截图处理（仅 mac_web）

```bash
if [[ "$TARGET_ENV" == "mac_web" ]]; then
  SPRINT_BASENAME=$(basename "$SPRINT_DIR")
  SCREENSHOT_DEST="$HOME/claude-output/harness-screenshots/$SPRINT_BASENAME"
  mkdir -p "$SCREENSHOT_DEST"

  # 1. 复制截图到公网目录
  if ls screenshots/*.png 2>/dev/null | head -1 > /dev/null; then
    cp screenshots/*.png "$SCREENSHOT_DEST/"
  fi

  # 2. Claude Read 每张截图自验（视觉确认）
  # evaluator 必须用 Read tool 读取每张 PNG，对照 DoD [BEHAVIOR:E2E] 期望描述逐一确认
  # - 01-initial.png：页面是否正常加载，关键元素是否可见？
  # - 02-action.png：用户操作后状态是否符合期望？
  # - 03-result.png：最终结果是否显示成功标志？
  # 如果任意截图与期望描述不符 → 输出 FAIL，feedback 说明哪张图与期望不符

  # 3. 生成公网链接列表
  SCREENSHOT_URLS=()
  for f in "$SCREENSHOT_DEST"/*.png; do
    [ -f "$f" ] || continue
    BASENAME=$(basename "$f")
    SCREENSHOT_URLS+=("http://38.23.47.81:9998/harness-screenshots/$SPRINT_BASENAME/$BASENAME")
  done
  SCREENSHOTS_JSON=$(printf '%s\n' "${SCREENSHOT_URLS[@]}" | jq -R . | jq -s .)
else
  SCREENSHOTS_JSON="[]"
fi
```

```

- [ ] **Step 3: 更新 Step B-3 的 PASS brain-result.json，加入 screenshots 字段**

找到（约 473-478 行）Step B-3 PASS 输出：

```bash
cat > /workspace/.brain-result.json << BREOF
{"verdict":"PASS","task_id":"$TASK_ID","failed_step":null,"log_excerpt":null}
BREOF
```

替换为（**注意**：`SCREENSHOTS_JSON` 变量在 B-2.5 中已设置，非 mac_web 则为 `[]`）：

```bash
cat > /workspace/.brain-result.json << BREOF
{"verdict":"PASS","task_id":"$TASK_ID","failed_step":null,"log_excerpt":null,"screenshots":${SCREENSHOTS_JSON:-[]}}
BREOF
```

- [ ] **Step 4: 更新 version 和 changelog**

将文件头部：

```yaml
version: 1.8.0
```

改为：

```yaml
version: 1.9.0
```

在 changelog 顶部（`- 1.8.0:` 之前）插入：

```yaml
  - 1.9.0: Step B-2.5 截图处理（mac_web 专属）— 复制 screenshots/*.png 到 ~/claude-output/harness-screenshots/$SPRINT/；Claude Read 每张 PNG 视觉自验（对照 BEHAVIOR:E2E 期望描述）；生成公网 URL 列表（38.23.47.81:9998）；PASS brain-result.json 增加 screenshots 字段
```

- [ ] **Step 5: 验证关键词存在（预期 PASS）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-delivery-redesign
grep -c 'B-2.5' packages/workflows/skills/harness-evaluator/SKILL.md
grep -c 'SCREENSHOTS_JSON' packages/workflows/skills/harness-evaluator/SKILL.md
```

预期：两行均 `≥ 1`

- [ ] **Step 6: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/harness-delivery-redesign
git add packages/workflows/skills/harness-evaluator/SKILL.md
git commit -m "feat(harness-evaluator): v1.9.0 — Step B-2.5 mac_web截图处理 + Claude视觉自验 + screenshots字段"
```

---

## Task 3: harness-report SKILL.md（v4.0.0 → v5.0.0）

完整重写执行流程：从 2 步扩展为 6 步完整交付

**Files:**
- Modify: `packages/workflows/skills/harness-report/SKILL.md`

- [ ] **Step 1: 验证关键词不存在（预期 FAIL）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-delivery-redesign
grep -c '飞书' packages/workflows/skills/harness-report/SKILL.md || true
```

预期：`0`

- [ ] **Step 2: 替换 version、description 和 changelog**

将文件头部：

```yaml
version: 4.0.0
created: 2026-04-08
updated: 2026-04-08
changelog:
  - 4.0.0: Harness v4.0 Report（独立 skill，新增 CI/Deploy watch 状态）
```

替换为：

```yaml
version: 5.0.0
created: 2026-04-08
updated: 2026-05-23
changelog:
  - 5.0.0: 6步完整交付 — 回写Brain任务状态 + 更新中台Dashboard + 写Notion AI Notes（GAN标注表+截图链接+DoD结果）+ 更新Notion Feature Registry + 飞书通知（含PR+截图） + 写本地harness-report.md
  - 4.0.0: Harness v4.0 Report（独立 skill，新增 CI/Deploy watch 状态）
```

同时更新 description：

```yaml
description: |
  Harness Report — Harness v5.0 最终步骤：6步完整交付。
  1.回写Brain任务状态 2.更新中台Dashboard 3.写Notion AI Notes（含GAN标注表+截图链接）
  4.更新Notion Feature Registry（status→done）5.飞书通知 6.写本地harness-report.md备份。
```

- [ ] **Step 3: 替换执行流程（2步 → 6步）**

删除原来的 `## 执行流程` 段落（从 `### Step 1: 收集数据` 到文件末尾），替换为以下完整 6 步流程：

```markdown
## 执行流程

### 注入变量

```bash
# TASK_ID、SPRINT_DIR、PROJECT_ID、FEATURE_ID、FEATURE_NAME、SUB_AREA、
# PR_URL、TOTAL_COST、SCREENSHOTS 由 cecelia-run 通过 prompt 注入，直接使用
# SCREENSHOTS: JSON 数组字符串，如 ["http://38.23.47.81:9998/harness-screenshots/sprint-xxx/01-initial.png"]
# FEATURE_NAME: PRD 中的 feature 名称
# SUB_AREA: brain|engine|dashboard|zenithjoy|multi-agent
# FIRST_SCREENSHOT_URL: SCREENSHOTS 数组第一个元素（用于飞书预览）
FIRST_SCREENSHOT_URL=$(echo "$SCREENSHOTS" | jq -r '.[0] // ""')
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
GAN_TABLE=""
if [ -f "${SPRINT_DIR}/contract-draft.md" ]; then
  # 提取所有 [FROM_PRD] 步骤
  FROM_PRD_STEPS=$(grep -A1 'FROM_PRD' "${SPRINT_DIR}/contract-draft.md" | grep '^\*\*Step' | sed 's/\*\*//g' | head -10)
  # 提取所有 [AI_ADDED] 步骤（含理由）
  AI_ADDED_STEPS=$(grep -B1 'AI_ADDED' "${SPRINT_DIR}/contract-draft.md" | grep '^\*\*Step' | sed 's/\*\*//g' | head -10)
  GAN_TABLE="## GAN 来源标注表\n\n| 来源 | 步骤 |\n|------|------|\n"
  while IFS= read -r line; do
    GAN_TABLE+="| FROM_PRD | $line |\n"
  done <<< "$FROM_PRD_STEPS"
  while IFS= read -r line; do
    GAN_TABLE+="| AI_ADDED | $line |\n"
  done <<< "$AI_ADDED_STEPS"
fi

# 构建 Notion body
SCREENSHOT_LINKS=""
for url in $(echo "$SCREENSHOTS" | jq -r '.[]'); do
  SCREENSHOT_LINKS+="- $url\n"
done

NOTION_BODY=$(cat << NOTEOF
# Harness 完成：$FEATURE_NAME

**PR**: $PR_URL
**总成本**: \$$TOTAL_COST USD

$GAN_TABLE

## 截图链接

$SCREENSHOT_LINKS

## DoD 验证结果

所有 ARTIFACT + BEHAVIOR 条目已验证通过（evaluator PASS）。
NOTEOF
)

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

$(cat "${SPRINT_DIR}/sprint-prd.md" 2>/dev/null | head -20 || echo "(sprint-prd.md 不存在)")

## GAN 对抗过程

（详见 Notion AI Notes: Harness 完成：$FEATURE_NAME）

## 截图链接

$(for url in $(echo "$SCREENSHOTS" | jq -r '.[]'); do echo "- $url"; done)

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
```

- [ ] **Step 4: 验证关键词存在（预期 PASS）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-delivery-redesign
grep -c '飞书' packages/workflows/skills/harness-report/SKILL.md
grep -c 'Step 5' packages/workflows/skills/harness-report/SKILL.md
grep -c 'SCREENSHOTS' packages/workflows/skills/harness-report/SKILL.md
```

预期：三行均 `≥ 1`

- [ ] **Step 5: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/harness-delivery-redesign
git add packages/workflows/skills/harness-report/SKILL.md
git commit -m "feat(harness-report): v5.0.0 — 2步→6步完整交付（Brain+Dashboard+Notion+FeatureRegistry+飞书+本地报告）"
```

---

## Task 4: DoD 文件 + 完整验收

- [ ] **Step 1: 确认三个文件的 artifact 检查全部通过**

```bash
cd /Users/administrator/worktrees/cecelia/harness-delivery-redesign

echo "=== harness-contract-proposer ==="
grep -c 'FROM_PRD' packages/workflows/skills/harness-contract-proposer/SKILL.md
grep -c 'BEHAVIOR:E2E' packages/workflows/skills/harness-contract-proposer/SKILL.md
grep -c 'page.screenshot' packages/workflows/skills/harness-contract-proposer/SKILL.md
grep 'version:' packages/workflows/skills/harness-contract-proposer/SKILL.md | head -1

echo "=== harness-evaluator ==="
grep -c 'B-2.5' packages/workflows/skills/harness-evaluator/SKILL.md
grep -c 'SCREENSHOTS_JSON' packages/workflows/skills/harness-evaluator/SKILL.md
grep 'version:' packages/workflows/skills/harness-evaluator/SKILL.md | head -1

echo "=== harness-report ==="
grep -c '飞书' packages/workflows/skills/harness-report/SKILL.md
grep -c 'Step 5' packages/workflows/skills/harness-report/SKILL.md
grep 'version:' packages/workflows/skills/harness-report/SKILL.md | head -1
```

所有输出均非 0，版本号符合预期（7.11.0 / 1.9.0 / 5.0.0）。

- [ ] **Step 2: 检查 git log 三条 commit 已存在**

```bash
cd /Users/administrator/worktrees/cecelia/harness-delivery-redesign
git log --oneline -5
```

预期看到：
```
feat(harness-report): v5.0.0 — ...
feat(harness-evaluator): v1.9.0 — ...
feat(harness-contract-proposer): v7.11.0 — ...
```

- [ ] **Step 3: Push 分支，提 PR**

```bash
cd /Users/administrator/worktrees/cecelia/harness-delivery-redesign
git push origin cp-0523114021-harness-delivery-redesign
```

然后创建 PR：

```bash
gh pr create \
  --title "feat(harness-pipeline): 交付层改造 — GAN标注 + DoD BEHAVIOR:E2E + 截图自验 + 6步报告 (v7.11/v1.9/v5.0)" \
  --body "$(cat <<'EOF'
## Summary

- **harness-contract-proposer v7.10.0 → v7.11.0**：Golden Path 每步加 `[FROM_PRD]/[AI_ADDED]` 来源标注；DoD 新增 `## BEHAVIOR:E2E` 段（user_facing，含截图规格）；mac_web Playwright 模板加 `page.screenshot()` 关键操作前后

- **harness-evaluator v1.8.0 → v1.9.0**：Mode B mac_web 新增 Step B-2.5，复制截图到 `~/claude-output/harness-screenshots/`，Claude Read PNG 视觉自验，截图公网 URL 写入 brain-result.json

- **harness-report v4.0.0 → v5.0.0**：2步→6步完整交付（①Brain任务回写 ②Dashboard更新 ③Notion AI Notes含GAN标注表+截图 ④Feature Registry done ⑤飞书通知 ⑥本地报告备份）

## Test plan

- [ ] `grep -c 'FROM_PRD' packages/workflows/skills/harness-contract-proposer/SKILL.md` ≥ 1
- [ ] `grep -c 'BEHAVIOR:E2E' packages/workflows/skills/harness-contract-proposer/SKILL.md` ≥ 1
- [ ] `grep -c 'page.screenshot' packages/workflows/skills/harness-contract-proposer/SKILL.md` ≥ 1
- [ ] `grep -c 'B-2.5' packages/workflows/skills/harness-evaluator/SKILL.md` ≥ 1
- [ ] `grep -c '飞书' packages/workflows/skills/harness-report/SKILL.md` ≥ 1
- [ ] CI 通过

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

