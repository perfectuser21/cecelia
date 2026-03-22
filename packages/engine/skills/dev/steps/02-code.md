---
id: dev-step-02-code
version: 4.2.0
created: 2026-03-14
updated: 2026-03-22
changelog:
  - 4.2.0: 删除 blocked 降级路径+无限重试+深入 root cause；push 前新增强制垃圾清理步骤；code-review-gate FAIL 涉及测试覆盖时自动触发补充测试 subagent
  - 4.1.0: 删除降级 pass 逻辑（code_review_gate_degraded），3次 FAIL 改为写入 blocked 等待人工
  - 4.0.0: code_review_gate 改为 Agent subagent 同步调用（删除 Codex async dispatch），修复有头模式卡死
  - 3.1.0: 新增 2.3.5 本地 CI 镜像检查（npm test + check-learning + check-dod-mapping）
  - 3.0.0: 砍掉所有假 subagent 模板，加入自验证 + Codex 验证双保险
  - 2.0.0: TDD 两阶段探索
  - 1.0.0: 初始版本
---

# Stage 2: Code — 写代码 + 自验证

> 探索代码 → 写实现 → 逐条验证 DoD → 本地测试 → 计算 Task Card hash

---

## 2.1 探索代码

读 PRD/Task Card，理解要改什么。自己探索代码库：

1. 找相关文件（grep/glob）
2. 读关键文件（最多 5-8 个）
3. 理解现有架构和模式
4. 输出实现方案（要改哪些文件、怎么改）

**不需要 subagent**——主 agent 自己探索就行。

---

## 2.2 写代码

### 原则

1. **只做 Task Card 里说的** — 不过度设计
2. **保持简单** — 能用简单方案就不用复杂方案
3. **遵循项目规范** — 看已有代码怎么写的
4. **测试是代码的一部分** — 写功能代码时同步写测试

### 逐条实现 DoD

对 Task Card 中每一条 `- [ ]` 条目：

```
当前 DoD 条目
  ↓
写实现代码
  ↓
自己运行 Test 命令验证
  ↓
PASS → 勾 [x]，进入下一条
FAIL → 读错误信息，修代码，再验证
```

**关键：每条 DoD 完成后必须自己运行 Test 命令确认 PASS，不能跳过。**

---

## 2.3 自验证（CRITICAL — 不可跳过）

> 所有 DoD 条目 [x] 后，执行完整的自验证。这是你自己的检查，Step 3 push 后 Codex 会独立再验一遍。

### 2.3.1 跑自动化测试

```bash
if [[ -f "package.json" ]]; then
    HAS_TEST=$(node -e "const p=require('./package.json'); console.log(p.scripts?.test ? 'yes' : 'no')" 2>/dev/null)
    HAS_QA=$(node -e "const p=require('./package.json'); console.log(p.scripts?.qa ? 'yes' : 'no')" 2>/dev/null)
fi

if [[ "$HAS_QA" == "yes" ]]; then
    npm run qa
elif [[ "$HAS_TEST" == "yes" ]]; then
    npm test
fi
```

| 结果 | 动作 |
|------|------|
| 通过 | 继续 2.3.2 |
| 失败 | 修复代码 → 重跑 |

### 2.3.2 本地 CI 镜像检查

```bash
CHANGED=$(git diff --name-only main...HEAD 2>/dev/null || git diff --name-only origin/main...HEAD)

# Workspace 改动 → npm run build
if echo "$CHANGED" | grep -q "^apps/"; then
    APP_DIR=$(echo "$CHANGED" | grep "^apps/" | head -1 | cut -d'/' -f1-2)
    [[ -f "$APP_DIR/package.json" ]] && (cd "$APP_DIR" && npm run build 2>&1)
fi

# Brain 改动 → local-precheck
if echo "$CHANGED" | grep -qE "^packages/brain/|^DEFINITION\.md$"; then
    bash scripts/local-precheck.sh
fi

# Engine 改动 → version-sync
if echo "$CHANGED" | grep -q "^packages/engine/"; then
    bash packages/engine/ci/scripts/check-version-sync.sh 2>&1
fi
```

### 2.3.3 逐条重跑 DoD Test（最终确认）

> **由 verify-step.sh Gate 2 自动强制执行**，不依赖 AI 自觉。
> 当 AI 标记 `step_2_code: done` 时，`verify-step.sh step2` 会自动：
> 1. 读取 Task Card（`.task-{BRANCH}.md`）
> 2. 提取所有 `[BEHAVIOR]` 条目的 Test 字段
> 3. 对 `manual:` 开头的 Test，执行该命令（在项目根目录）
> 4. 对 `contract:` 开头的 Test，标记 DEFERRED 跳过
> 5. 对 `tests/` 开头的 Test，检查文件是否存在
> 6. 任一 Test 失败 → verify-step 返回 exit 1 → 不允许标记完成

```bash
# verify-step.sh 会在 step_2_code: done 写入时被 branch-protect 自动调用
# 也可以手动运行确认：
bash packages/engine/hooks/verify-step.sh step2 "$BRANCH" "$(pwd)"
```

**这是你 push 前的最后防线。Gate 2 确保每条 DoD [BEHAVIOR] Test 都被真实执行过，不能只靠 npm test。**

### 2.3.4 计算 Task Card Hash（TDD 锁定）

```bash
TASK_CARD=$(ls .task-cp-*.md 2>/dev/null | head -1)
if [[ -n "$TASK_CARD" ]]; then
    TC_HASH=$(shasum -a 256 "$TASK_CARD" | awk '{print "sha256:" $1}')
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    echo "task_card_hash: $TC_HASH" >> ".dev-mode.${BRANCH}"
    echo "✅ Task Card hash 已锁定: $TC_HASH"
fi
```

### 2.3.5 ⛔ 强制垃圾清理（push 前，不可跳过）

> **在标记 Stage 2 完成之前，必须扫描并清理本次改动引入的垃圾内容。**
> 目标：代码只增有用的，不留死代码/stale 注释/过期文档。

```bash
echo "🧹 强制垃圾清理扫描（dead code / stale 注释 / 过期文档）..."

CHANGED_FILES=$(git diff origin/main..HEAD --name-only 2>/dev/null || git diff main..HEAD --name-only 2>/dev/null || echo "")

ISSUES_FOUND=0
for f in $CHANGED_FILES; do
    [[ ! -f "$f" ]] && continue

    # 检查1: 已完成的 TODO（TODO: done / TODO: 已完成）
    if grep -n "TODO.*done\|TODO.*已完成\|FIXME.*done" "$f" 2>/dev/null | grep -v "^Binary"; then
        echo "  ⚠️  $f: 含已完成的 TODO/FIXME，应删除"
        ISSUES_FOUND=$((ISSUES_FOUND+1))
    fi

    # 检查2: 注释掉的代码块（连续 3 行以上的注释代码）
    # 不检查 markdown 文件（注释是内容的一部分）
    if [[ "$f" != *.md ]]; then
        COMMENTED_CODE=$(grep -c "^[[:space:]]*//" "$f" 2>/dev/null || echo 0)
        if [[ "$COMMENTED_CODE" -gt 5 ]]; then
            echo "  ⚠️  $f: 含大量注释代码（${COMMENTED_CODE}行），检查是否为 dead code"
            ISSUES_FOUND=$((ISSUES_FOUND+1))
        fi
    fi

    # 检查3: 调试日志（console.log / debug print 等）
    if grep -n "console\.log\|debugger;\|print(\"DEBUG\|logger\.debug" "$f" 2>/dev/null | grep -v "^Binary" | grep -v "\.test\.\|\.spec\."; then
        echo "  ⚠️  $f: 含调试日志，确认是否需要保留"
        ISSUES_FOUND=$((ISSUES_FOUND+1))
    fi
done

if [[ $ISSUES_FOUND -gt 0 ]]; then
    echo ""
    echo "⛔ 发现 $ISSUES_FOUND 处垃圾内容，必须清理后才能继续！"
    echo "   直接修复文件（不开新 PR），commit message 前缀用 refactor:"
    exit 1
fi

echo "✅ 垃圾清理扫描通过 — 无 dead code / stale 注释"
```

---

### 2.3.6 推送前完整验证

> push 前跑一遍 CI 会检查的东西，减少 CI 失败率。

```bash
# 1. 跑 npm test（如果项目有）
if [[ -f "package.json" ]] && grep -q '"test"' package.json; then
    echo "🧪 Running npm test..."
    npm test 2>&1 || { echo "❌ npm test 失败，修复后再继续"; exit 1; }
fi

# 2. 检查 Learning 格式（如果已写）
LEARNING_FILE="docs/learnings/$(git branch --show-current).md"
if [[ -f "$LEARNING_FILE" ]]; then
    bash packages/engine/scripts/devgate/check-learning.sh "$LEARNING_FILE" || true
fi

# 3. 检查 DoD 映射
node packages/engine/scripts/devgate/check-dod-mapping.cjs 2>/dev/null || true
```

---

### 完成后

**标记步骤完成**：

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
sed -i "s/^step_2_code: pending/step_2_code: done/" "$DEV_MODE_FILE"
echo "✅ Stage 2 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "2", status: "completed" })`

---

## 2.4 执行 code_review_gate Agent subagent（CRITICAL — Stage 2 最后一步）

> **Stage 2 代码写完、自验证通过后，调用 Agent subagent 同步审查代码质量。**
> subagent 在 Anthropic 服务器运行，不占本地内存，~10 秒同步完成。
> **不需要等 stop hook 放行**——subagent 是同步调用，结果立即可用。

### 准备 git diff

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH}"

# 获取完整 diff（传给 subagent 审查）
GIT_DIFF=$(git diff origin/main..HEAD 2>/dev/null || git diff main..HEAD 2>/dev/null || echo "")
GIT_CHANGED=$(git diff origin/main..HEAD --name-only 2>/dev/null || git diff main..HEAD --name-only 2>/dev/null || echo "")

echo "📋 变更文件："
echo "$GIT_CHANGED"
```

### 重试逻辑（MUST 遵守）

- PASS → 写入 `code_review_gate_status: pass`，立即继续 Stage 3
- FAIL → 读取 blockers，**深入分析 root cause**，修复代码，**无次数上限，继续重试**

```
retry_count = 0

loop:
  1. 调用 Agent subagent（subagent_type=general-purpose）
     - prompt = code-review-gate SKILL.md 全文 + git diff 内容
     - SKILL.md 路径：packages/workflows/skills/code-review-gate/SKILL.md
  2. 解析 JSON 结果中的 "verdict" 字段
  3. verdict == "PASS"
       → echo "code_review_gate_status: pass" >> .dev-mode.${BRANCH}
       → break（继续 Stage 3）
  4. verdict == "FAIL"
       → 读取 issues[severity=="blocker"] 列表
       → 深入分析每个 blocker 的 root cause（不只看表面错误，找到根本原因）
       → 如果任意 blocker 的 description 含「测试覆盖」「test coverage」「缺少测试」「missing test」→
           调用 Agent subagent 补充测试：
           Agent({ subagent_type: "general-purpose",
                   prompt: "请为以下代码补充缺少的测试：[传入 git diff 内容]" })
       → 修复对应代码文件（file:line 指向的位置）
       → retry_count++
       → 重新获取 git diff
       → 重新调用 subagent（无次数上限，直到 PASS）
```

**执行时注意**：
- subagent prompt 必须包含 SKILL.md **完整内容**（不能只引用路径）
- subagent prompt 必须包含 `git diff` **完整内容**（不能只引用文件路径）
- 不要向 Brain 注册任务，不要走 Codex 异步派发路径
- FAIL 修复后必须重新获取 git diff 再调用 subagent，不能跳过重审

---

**继续执行下一步**：

1. 读取 `skills/dev/steps/03-integrate.md`
2. 立即 push + 创建 PR
3. **不要**输出总结或等待确认
