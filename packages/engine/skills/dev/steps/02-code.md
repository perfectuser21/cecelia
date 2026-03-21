---
id: dev-step-02-code
version: 3.0.0
created: 2026-03-14
updated: 2026-03-20
changelog:
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

### 2.3.5 本地 CI 镜像检查

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

## 2.4 派发 code_review_gate Codex 任务（CRITICAL — Stage 2 最后一步）

> **Stage 2 代码写完、自验证通过后，派发 code_review_gate Codex 任务审查代码质量，然后停下来等 stop hook 放行。**
> code_review 在 push 前完成，确保推到远端的代码已经过审查，CI 一次过。

```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH}"

# 检查 Brain 是否可用
BRAIN_HEALTH=$(curl -s --max-time 5 "$BRAIN_URL/api/brain/health" 2>/dev/null || echo "")
if [[ -z "$BRAIN_HEALTH" ]]; then
  echo "⚠️  Brain 不可用（$BRAIN_URL），code_review_gate 降级为跳过"
  echo "code_review_gate_status: pass" >> "$DEV_MODE_FILE"
else
  echo "🔍 向 Brain 注册 code_review_gate 任务..."

  CR_RESP=$(curl -s --max-time 5 -X POST "$BRAIN_URL/api/brain/tasks" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"Code Review: $BRANCH\",\"task_type\":\"code_review_gate\",\"priority\":\"P0\",\"metadata\":{\"branch\":\"$BRANCH\"}}" 2>/dev/null || echo "")
  CR_TASK=$(echo "$CR_RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
  if [[ -n "$CR_TASK" ]]; then
    echo "code_review_gate_task_id: $CR_TASK" >> "$DEV_MODE_FILE"
    echo "code_review_gate_status: pending" >> "$DEV_MODE_FILE"
    echo "  ✅ code_review_gate 已注册: $CR_TASK"
    # 立即派发（不等调度器）
    curl -s -X POST "$BRAIN_URL/api/brain/dispatch-now" \
      -H "Content-Type: application/json" \
      -d "{\"task_id\":\"$CR_TASK\"}" \
      --max-time 5 2>/dev/null || true
    echo "  🚀 code_review_gate 已派发执行"
  else
    echo "  ⚠️  code_review_gate 注册失败，降级为跳过"
    echo "code_review_gate_status: pass" >> "$DEV_MODE_FILE"
  fi
fi
```

**输出状态后停止，等 stop hook 放行。**

code_review_gate 通过后，devloop-check.sh 会放行，进入 Stage 3。

---

**继续执行下一步**：

1. 读取 `skills/dev/steps/03-integrate.md`
2. 立即 push + 创建 PR
3. **不要**输出总结或等待确认
