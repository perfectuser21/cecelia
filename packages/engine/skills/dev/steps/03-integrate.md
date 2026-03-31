---
id: dev-stage-03-integrate
version: 1.4.0
created: 2026-03-20
updated: 2026-03-30
changelog:
  - 1.4.0: 移除 3.3 Playwright Evaluator（改为 post-merge 触发），3.4/3.5 回退为 3.3/3.4
  - 1.3.0: 新增 3.3 Playwright Evaluator（CI 通过后验证 DoD [BEHAVIOR] 条目），原 3.3/3.4 顺延为 3.4/3.5
  - 1.2.0: 新增 3.1.4 Drift Detection（push 前检测改动文件是否偏离 Task Card 声明范围，warning 级）
  - 1.1.0: code_review_gate 前移到 Stage 2（push 前审查），Stage 3 仅负责 push + CI
  - 1.0.0: 从 03-prci.md 重构为 Stage 3 Integrate，删除 4 个 Codex 注册，改为 CI 后 1 个 code_review
---

# Stage 3: Integrate — Push + CI

> Push + 创建 PR + 等 CI 通过（code_review 已在 Stage 2 完成）

---

## 3.1 提交 PR

> commit + push + PR（版本号由 auto-version.yml 自动处理）
> **创建 PR 后继续 3.2 等待 CI，Stop Hook 控制完成条件**

**Task Checkpoint**: `TaskUpdate({ taskId: "3", status: "in_progress" })`

---

### 3.1.1 会话恢复检测

**先检测是否是恢复的会话**：

```bash
EXISTING_PR=$(gh pr list --head "$BRANCH_NAME" --state all --json number,url,state -q '.[0]' 2>/dev/null)

if [ ! -z "$EXISTING_PR" ]; then
  PR_STATE=$(echo "$EXISTING_PR" | jq -r '.state')

  if [ "$PR_STATE" = "MERGED" ]; then
    echo "✅ PR 已合并，跳到 cleanup"
  elif [ "$PR_STATE" = "OPEN" ]; then
    echo "✅ PR 已存在，跳到 CI"
  fi
fi
```

---

### 3.1.2 版本号 — 不要手动 bump

**版本号由 `auto-version.yml` 在合并到 main 后自动处理。PR 里不做任何版本操作。**

auto-version.yml 自动处理的文件（5 个）：
- `packages/brain/package.json`
- `packages/brain/package-lock.json`
- `.brain-versions`
- `DEFINITION.md`（Brain 版本行）
- `packages/brain/VERSION`

**commit 消息前缀决定 bump 类型**（auto-version 从 squash merge 的 commit message 解析）：

| commit 前缀 | 版本变化 |
|-------------|----------|
| fix: | patch (+0.0.1) |
| feat: | minor (+0.1.0) |
| feat!: / BREAKING: | major (+1.0.0) |
| 其他（docs:、test:、chore:） | 不 bump |

**禁止在 PR 中做以下操作**（适用于 Brain/auto-version 管理的包）：
- ❌ `npm version patch/minor/major`
- ❌ 手动改 package.json 版本号
- ❌ 手动改 .brain-versions / VERSION / DEFINITION.md 版本
- ❌ 运行 `check-version-sync.sh`（Brain 由 auto-version 自动处理，无需手动同步）

> **Engine 例外**：Engine 版本需手动 bump（6 个文件），由 3.1.3 自检替代 check-version-sync.sh，
> CI L2 会在合并后验证一致性。

---

### 3.1.2b ⚠️ 并行PR重叠文件检测（commit 前警告）

> **检测当前改动文件是否与近期其他 open PR 存在重叠，预防 squash merge 静默覆盖。**
> 仅输出 warning，不阻塞（因并行 PR 有时是合理的）。

```bash
echo "🔍 检测并行PR重叠文件..."
CHANGED_FILES=$(git diff --name-only origin/main 2>/dev/null || echo "")
OPEN_PRS=$(gh pr list --state open --json number,headRefName,files --jq '.[]' 2>/dev/null || echo "")

if [[ -n "$OPEN_PRS" && -n "$CHANGED_FILES" ]]; then
    BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
    OVERLAP_FOUND=false

    while IFS= read -r pr_json; do
        PR_NUM=$(echo "$pr_json" | jq -r '.number')
        PR_BRANCH=$(echo "$pr_json" | jq -r '.headRefName')
        [[ "$PR_BRANCH" == "$BRANCH_NAME" ]] && continue  # 跳过自己

        PR_FILES=$(echo "$pr_json" | jq -r '.files[].path' 2>/dev/null || echo "")
        if [[ -n "$PR_FILES" ]]; then
            while IFS= read -r my_file; do
                if echo "$PR_FILES" | grep -qF "$my_file"; then
                    echo "⚠️  重叠文件检测：$my_file 也被 PR #${PR_NUM}（${PR_BRANCH}）修改"
                    echo "   风险：squash merge 后发起的 PR 会覆盖先合并的内容"
                    echo "   建议：push 前确认 PR #${PR_NUM} 的合并状态，或协调 review 顺序"
                    OVERLAP_FOUND=true
                fi
            done <<< "$CHANGED_FILES"
        fi
    done <<< "$OPEN_PRS"

    if [[ "$OVERLAP_FOUND" == "false" ]]; then
        echo "✅ 无并行PR重叠文件"
    fi
else
    echo "ℹ️  无 open PR 或无改动文件，跳过重叠检测"
fi
```

---

### 3.1.3 ⛔ 自检：Engine 版本文件完整性（commit 前必须通过）

**如果本次改动涉及 `packages/engine/` 下的任何文件，必须检查 6 个版本文件全部同步更新。**

```bash
CHANGED_ENGINE=$(git diff --name-only origin/main 2>/dev/null | grep "^packages/engine/" | head -1)

if [[ -n "$CHANGED_ENGINE" ]]; then
    echo "🔍 检测到 Engine 改动，验证版本 6 文件同步..."
    ERRORS=0
    CHANGED=$(git diff --name-only origin/main 2>/dev/null)

    check_file() {
        if ! echo "$CHANGED" | grep -q "^${1}$"; then
            echo "❌ 未修改: $1"
            return 1
        fi
        echo "✅ $1"
        return 0
    }

    check_file "packages/engine/package.json"         || ERRORS=1
    check_file "packages/engine/package-lock.json"    || ERRORS=1
    check_file "packages/engine/VERSION"              || ERRORS=1
    check_file "packages/engine/.hook-core-version"   || ERRORS=1
    check_file "packages/engine/regression-contract.yaml" || ERRORS=1
    check_file "packages/engine/features/feature-registry.yml" || ERRORS=1

    if [[ $ERRORS -gt 0 ]]; then
        echo ""
        echo "⛔ Engine 版本文件不完整！"
        echo "   必须同时更新 6 个文件（少一个 L2 Consistency Gate 就失败）"
        exit 1
    fi

    echo "✅ Engine 版本 6 文件全部已修改"
else
    echo "ℹ️  非 Engine 改动，跳过版本文件检查"
fi
```

---

### 3.1.4 ⚠️ Drift Detection：改动文件偏离 DoD 范围检查（push 前 warning）

> **检测当前 git 改动是否包含 Task Card `## 实现方案` 未声明的文件。**
> 仅输出 warning，不阻塞 push——漂移文件可能是合理的副产物，由 AI 判断是否继续。

```bash
echo "🔍 Drift Detection：检查改动文件是否在 Task Card 范围内..."
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
TASK_CARD=".task-${BRANCH_NAME}.md"

if [[ ! -f "$TASK_CARD" ]]; then
    echo "ℹ️  Task Card 不存在，跳过 drift 检查"
else
    # 从 Task Card 提取 "## 实现方案" 部分声明的文件路径
    SCOPE_SECTION=$(awk '/^## 实现方案/,/^## /' "$TASK_CARD" 2>/dev/null | grep -E '^\s*[-*`]|`[^`]+`' || true)
    DECLARED_FILES=$(echo "$SCOPE_SECTION" | grep -oE '`[^`]+`' | tr -d '`' | grep '/' || true)

    # 获取实际改动文件（相对于 origin/main），排除 task card / dev-mode / learnings
    CHANGED_FILES=$(git diff --name-only origin/main 2>/dev/null | grep -v '^\.task-\|^\.dev-\|^docs/learnings/' || true)

    DRIFT_FILES=""
    while IFS= read -r changed_file; do
        [[ -z "$changed_file" ]] && continue
        MATCHED=false
        while IFS= read -r declared; do
            [[ -z "$declared" ]] && continue
            # 支持前缀匹配（如声明 packages/engine/ 则覆盖该目录所有文件）
            if [[ "$changed_file" == "$declared" || "$changed_file" == ${declared%/}/* ]]; then
                MATCHED=true
                break
            fi
        done <<< "$DECLARED_FILES"
        if [[ "$MATCHED" == "false" ]]; then
            DRIFT_FILES="${DRIFT_FILES}  ⚠️  ${changed_file}\n"
        fi
    done <<< "$CHANGED_FILES"

    if [[ -n "$DRIFT_FILES" ]]; then
        echo ""
        echo "⚠️  Drift Detection 警告：以下文件改动未在 Task Card 实现方案中声明："
        printf "%b" "$DRIFT_FILES"
        echo ""
        echo "   请确认这些文件的改动是必要的，或更新 Task Card 的实现方案范围。"
        echo "   （不阻塞 push，继续执行）"
    else
        echo "✅ Drift Detection 通过：所有改动文件均在声明范围内"
    fi
fi
```

---

### 3.1.5 提交

```bash
git add -u
# 显式 add 新建文件（git add -u 不会 stage 未跟踪文件）
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
git add ".task-cp-${BRANCH_NAME}.md" ".prd-cp-${BRANCH_NAME}.md" "docs/learnings/" 2>/dev/null || true
TASK_ID=$(grep "^brain_task_id:" ".dev-mode.${BRANCH_NAME}" 2>/dev/null | awk "{print \$2}")
[[ -z "$TASK_ID" ]] && TASK_ID=$(grep "^task_id:" ".dev-mode.${BRANCH_NAME}" 2>/dev/null | awk "{print \$2}")
TASK_LINE=$([ -n "$TASK_ID" ] && echo "
Task-ID: $TASK_ID" || echo "")
git commit -m "feat: <功能描述>${TASK_LINE}

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### 3.1.6 推送

```bash
/usr/bin/git push -u origin HEAD
```

---

### 3.1.7 创建 PR

```bash
BASE_BRANCH=$(git branch -r | grep -q 'origin/develop' && echo "develop" || echo "main")
gh pr create --base $BASE_BRANCH --title "feat: <功能描述>" --body "## Summary
- <主要改动>

## Test
- [x] 本地测试通过

## SYSTEM BEHAVIOR CHANGE
Before: [系统之前怎么跑 / 此处填写变更前的系统行为，若无行为变化填 N/A]
After:  [系统现在怎么跑 / 此处填写变更后的系统行为]
Log:    [关键日志事件 / 如 task dispatched, brain tick, API response 等]

## UNIMPLEMENTED
- [本 PR 故意不做的事，明确范围边界]

---
Generated by /dev workflow"
```

**行为声明规则**：
- `delivery_type=behavior-change` → SYSTEM BEHAVIOR CHANGE 必须填写实际内容（不能填 N/A）
- `delivery_type=code-only` → SYSTEM BEHAVIOR CHANGE 可填 N/A，但 UNIMPLEMENTED 必须填写
- 所有 PR 必须包含 `## SYSTEM BEHAVIOR CHANGE` 和 `## UNIMPLEMENTED` 两段

---

### 3.1.8 标记 PR 已创建

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
sed -i '' "s/^step_3_integrate: pending/step_3_integrate: in_progress/" "$DEV_MODE_FILE" 2>/dev/null || \
sed -i "s/^step_3_integrate: pending/step_3_integrate: in_progress/" "$DEV_MODE_FILE"
echo "✅ PR 已创建，进入 CI 监控阶段"
```

---

## 3.2 CI 监控

> 等待 CI 通过（code_review 已在 Stage 2 完成）

---

### 3.2.1 检查 CI 状态

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)

# 等待 CI 启动
sleep 30

# 查询 CI 状态
RUN_INFO=$(gh run list --branch "$BRANCH_NAME" --limit 1 --json status,conclusion,databaseId)
RUN_COUNT=$(echo "$RUN_INFO" | jq 'length')

if [[ "$RUN_COUNT" -eq 0 ]]; then
    echo "⏳ CI 尚未启动，继续等待..."
    CI_STATUS="queued"
    CI_CONCLUSION="null"
else
    CI_STATUS=$(echo "$RUN_INFO" | jq -r '.[0].status')
    CI_CONCLUSION=$(echo "$RUN_INFO" | jq -r '.[0].conclusion')
fi
```

### 3.2.2 CI 状态处理

| CI 状态 | 动作 |
|---------|------|
| queued / in_progress | 等待，继续检查 |
| failure | **先本地复现**，修复后才 push（见 3.2.3） |
| success | CI 通过，devloop-check 自动放行进入 Stage 4 |

### 3.2.3 CI 失败修复（本地优先规则）

> **核心规则：CI 失败后，禁止直接 push 修复。必须先本地复现，本地全绿后才 push。**

#### 强制执行顺序

```
① 分析 CI 失败原因
  ↓
② 本地复现（运行对应本地检查）
  ↓
③ 修复代码
  ↓
④ 本地验证通过（才允许 push）
  ↓
⑤ push
```

#### ① 分析失败原因 + 写入 Incident Log

```bash
RUN_ID=$(echo "$RUN_INFO" | jq -r '.[0].databaseId')
FAIL_LOG=$(gh run view "$RUN_ID" --log-failed 2>&1 | head -80)
echo "$FAIL_LOG"

# 写入 .dev-incident-log.json（Stage 4 Learning 会读取）
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
INCIDENT_FILE=".dev-incident-log.json"
FAIL_SUMMARY=$(echo "$FAIL_LOG" | head -5 | tr '\n' ' ' | sed 's/"/\\"/g')
CI_WORKFLOW=$(echo "$RUN_INFO" | jq -r '.[0].name // "unknown"')
TIMESTAMP=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)

# 读取现有记录（如无则初始化为空数组）
if [[ ! -f "$INCIDENT_FILE" ]]; then
    echo "[]" > "$INCIDENT_FILE"
fi

# 追加新的 CI 失败记录
NEW_ENTRY=$(jq -n \
    --arg step "Stage 3 CI" \
    --arg type "ci_failure" \
    --arg workflow "$CI_WORKFLOW" \
    --arg run_id "$RUN_ID" \
    --arg error "$FAIL_SUMMARY" \
    --arg ts "$TIMESTAMP" \
    '{step: $step, type: $type, description: ("CI workflow 失败: " + $workflow), run_id: $run_id, error: $error, resolution: "pending", timestamp: $ts}')

jq --argjson entry "$NEW_ENTRY" '. + [$entry]' "$INCIDENT_FILE" > "${INCIDENT_FILE}.tmp" && mv "${INCIDENT_FILE}.tmp" "$INCIDENT_FILE"
echo "📝 CI 失败已记录到 $INCIDENT_FILE（共 $(jq length "$INCIDENT_FILE") 条）"
```

#### ② 本地复现

| CI 失败 check | 本地复现命令 |
|---------------|-------------|
| `facts-check` | `node scripts/facts-check.mjs` |
| `brain-test` | `cd packages/brain && npm test` |
| `version-check`（engine） | `cd packages/engine && npm run version-check` |
| `dod-check` | `node packages/engine/scripts/devgate/check-dod-mapping.cjs` |
| **Brain 相关** | `bash scripts/local-precheck.sh --force` |
| **通用兜底** | 先 `bash scripts/local-precheck.sh`，再跑对应 package 的 `npm test` |

#### ③-⑤ 修复 → 本地验证 → push

```bash
bash scripts/local-precheck.sh
git add -u
git commit -m "fix: <具体修复内容>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin HEAD
```

---

## 3.3 Playwright Evaluator — 端到端行为验证

> CI 通过后自动触发。对照 Task Card [BEHAVIOR] DoD 条目逐条执行 Test: 命令，
> 始终包含 Brain API `/api/brain/health` 基线检查。
> 评估失败 → 修复代码 → 重新 push → 等 CI → 再次 evaluator（循环）。

```bash
# 执行 Playwright Evaluator
node packages/engine/scripts/devgate/playwright-evaluator.cjs --run
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
    echo "❌ Playwright Evaluator FAIL — 分析失败条目，修复后重新 push"
    # 修复策略：
    # 1. 读取失败输出，定位哪条 [BEHAVIOR] 未通过
    # 2. 修复对应代码或确认服务是否运行
    # 3. git add -u && git commit && git push origin HEAD
    # 4. 等待 CI 通过后再次运行 evaluator
    exit 1
fi

echo "✅ Playwright Evaluator PASS — 所有行为验证通过"
```

**跳过条件**：如果 Task Card 没有 [BEHAVIOR] 条目且 Brain 无需验证，evaluator 仍会运行基线检查。

**调试命令**（先 dry-run 查看清单再执行）：
```bash
node packages/engine/scripts/devgate/playwright-evaluator.cjs --dry-run
```

---

## 3.4 CI 通过 → 进入 Stage 4

> code_review_gate 已在 Stage 2 完成（push 前审查）。
> CI 全部通过 + Playwright Evaluator PASS 后，进入 Stage 4。

---

## 3.5 Stop Hook 完成条件

| 条件 | 状态 | Stop Hook 行为 |
|------|------|---------------|
| PR 未创建 | ❌ | exit 2（继续创建 PR）|
| CI 失败 | ❌ | exit 2（继续修复）|
| CI 进行中 | ⏳ | exit 2（继续等待）|
| CI 通过 + Evaluator PASS | ✅ | exit 2（继续 Stage 4）|

---

### 禁止行为

- ❌ CI 失败后不本地复现就直接 push 修复
- ❌ CI 失败后停止不管
- ❌ PR 创建后就结束
- ❌ 等待用户处理
- ❌ **`gh pr merge --admin` 绕过 CI**
- ❌ 跳过 code_review 直接合并（code_review 在 Stage 2 完成，不可绕过）

### 正确行为

- ✅ CI 失败 → 分析原因 → **本地复现** → 修复 → 本地全绿 → push → 继续等待
- ✅ CI 通过 → 自动放行进入 Stage 4（code_review 已在 Stage 2 完成）

---

### 完成后

**CI 通过后，标记完成并执行 Stage 4**

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
sed -i '' "s/^step_3_integrate: in_progress/step_3_integrate: done/" "$DEV_MODE_FILE" 2>/dev/null || \
sed -i "s/^step_3_integrate: in_progress/step_3_integrate: done/" "$DEV_MODE_FILE"
echo "✅ Stage 3 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "3", status: "completed" })`

**继续 → Stage 4 (Ship)**

读取 `skills/dev/steps/04-ship.md` 并执行。
