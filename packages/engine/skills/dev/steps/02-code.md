---
id: dev-step-02-code
version: 7.0.0
created: 2026-03-14
updated: 2026-04-02
changelog:
  - 7.0.0: 精简 — 删除 Generator subagent、code_review_gate、独立 Evaluator。主 agent 直接写代码。
  - 6.4.0: .dev-mode 状态持久化
  - 5.2.0: 新增 2.3.6 强制周边一致性扫描（改A时扫描同目录文件矛盾），原 2.3.6 顺延为 2.3.7
  - 5.1.0: 修复 2.3.2 CI镜像检查无 exit 1（build/precheck/version-sync 失败现在正确拦截）；还原被 PR#1366 覆盖的 Step 2.0 行为快照+Step 2.1.5 TDD先行+2.3.6 exit 1
  - 5.0.0: 新增 Step 2.0 行为快照[PRESERVE]（探索前必须执行）；新增 Step 2.1.5 TDD先行（红灯→绿灯）；修复 2.3.6 || true 改 exit 1
  - 4.2.0: 删除 blocked 降级路径+无限重试+深入 root cause；push 前新增强制垃圾清理步骤；code-review-gate FAIL 涉及测试覆盖时自动触发补充测试 subagent
  - 4.1.0: 删除降级 pass 逻辑（code_review_gate_degraded），3次 FAIL 改为写入 blocked 等待人工
  - 4.0.0: code_review_gate 改为 Agent subagent 同步调用（删除 Codex async dispatch），修复有头模式卡死
  - 3.1.0: 新增 2.3.5 本地 CI 镜像检查（npm test + check-learning + check-dod-mapping）
  - 3.0.0: 砍掉所有假 subagent 模板，加入自验证 + Codex 验证双保险
  - 2.0.0: TDD 两阶段探索
  - 1.0.0: 初始版本
---

# Stage 2: Code — Generator subagent 写代码 + 自验证

> 探索代码 → 写实现 → 逐条验证 DoD → 本地测试 → 计算 Task Card hash

---

## 2.0 行为快照 [PRESERVE]（CRITICAL — 探索前必须执行）

> **探索代码前，扫描涉及模块的现有关键行为，写入 Task Card `[PRESERVE]` 条目。**
> verify-step.sh Gate 0a 检查 [PRESERVE] 条目存在数量（不执行 Test 命令）；Gate 2 执行 [BEHAVIOR]/[ARTIFACT]/[GATE] 的 Test 命令，确保实现符合预期。

### 为什么需要行为快照

- 改动前不知道"以前怎样"，改动后无法判断是否回归
- `[PRESERVE]` 条目是防回归的明文合约：改动后 Test 命令必须仍然通过
- 与 `[BEHAVIOR]` 的区别：`[PRESERVE]` 验证**已有行为不被破坏**，`[BEHAVIOR]` 验证**新增行为**

### 执行步骤

```bash
# 1. 从 Task Card 实现方案中找到所有涉及的文件
# 2. 对每个文件，识别关键现有行为（函数签名、关键输出、核心结构）
# 3. 为每个关键行为写一条 [PRESERVE] 条目加入 Task Card

echo "📸 行为快照：扫描涉及模块的现有行为..."

# 示例：如果要修改 verify-step.sh，快照现有支持的条目类型
# - [x] [PRESERVE] verify-step.sh 支持 step1/step2/step4 参数
#   Test: manual:bash -c 'bash packages/engine/hooks/verify-step.sh unknown 2>&1 | grep -q "支持: step1, step2, step4" && exit 0 || exit 1'

# 写完 [PRESERVE] 条目后，运行 verify-step.sh 确认基线测试全部通过（绿灯基线）
BRANCH=$(git rev-parse --abbrev-ref HEAD)
bash packages/engine/hooks/verify-step.sh step2 "$BRANCH" "$(pwd)" 2>/dev/null || true
echo "✅ 基线行为快照完成，[PRESERVE] 条目已写入 Task Card"
```

### 格式要求

```markdown
- [ ] [PRESERVE] <现有行为描述>
  Test: manual:node -e "..."
```

### ⛔ 强制门禁（exit 1）

```bash
# 在开始写任何实现代码之前，检查 Task Card 是否有 [PRESERVE] 条目
TASK_CARD=$(ls .task-cp-*.md 2>/dev/null | head -1)
if [[ -n "$TASK_CARD" ]]; then
    PRESERVE_COUNT=$(grep -c '^\s*-\s*\[.\]\s*\[PRESERVE\]' "$TASK_CARD" 2>/dev/null || true)
    PRESERVE_COUNT=${PRESERVE_COUNT:-0}
    if [[ "$PRESERVE_COUNT" -eq 0 ]]; then
        echo "❌ Task Card 缺少 [PRESERVE] 行为快照条目"
        echo "   探索代码后写实现前，必须先记录涉及模块的现有行为"
        echo "   至少需要 1 条 [PRESERVE] 条目"
        exit 1
    fi
    echo "✅ 行为快照检查通过（${PRESERVE_COUNT} 条 [PRESERVE] 条目）"
fi
```

---

## 2.1 探索代码

读 PRD/Task Card，理解要改什么。自己探索代码库：

1. 找相关文件（grep/glob）
2. 读关键文件（最多 5-8 个）
3. 理解现有架构和模式
4. 输出实现方案（要改哪些文件、怎么改）

**不需要 subagent**——主 agent 自己探索就行。

---

## 2.1.5 TDD先行（CRITICAL — 探索后写实现前必须执行）

> **探索代码后、写任何实现代码之前，必须先写失败测试（红灯），再写实现（绿灯）。**
> 顺序不可颠倒：先红灯确认测试有效，再绿灯确认实现正确。

### 红灯阶段（写测试，确认失败）

```bash
# 1. 根据 DoD 条目，为每个 [BEHAVIOR] 条目写对应测试
# 2. 此时代码还没写，测试应该失败（红灯）
# 3. 运行测试，确认失败输出

echo "🔴 TDD 红灯阶段：运行尚未实现的功能测试..."

# 对于有 test script 的 package：
# npm test -- --run <specific-test-file>  # 应该看到 FAIL

# 对于 shell 脚本：直接运行验证命令（应该 exit 1）
# bash -c '<DoD Test 命令>' && echo "❌ 测试本应失败（假测试！）" || echo "✅ 红灯确认：测试按预期失败"
```

### ⛔ 强制门禁（exit 1）

```bash
# 强制要求红灯确认：若测试从未失败，可能是假测试
# 在 .dev-mode 中记录 TDD 状态
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH}"

if ! grep -q "^tdd_red_confirmed:" "$DEV_MODE_FILE" 2>/dev/null; then
    echo "❌ TDD 红灯未确认"
    echo "   探索代码后，必须先写失败测试（红灯）再写实现"
    echo "   确认红灯后执行：echo 'tdd_red_confirmed: true' >> $DEV_MODE_FILE"
    exit 1
fi
echo "✅ TDD 红灯已确认，可以开始写实现代码"
```

### 绿灯阶段（写实现，确认通过）

在 2.2 写代码后，测试必须变为通过（绿灯）：

```bash
# 实现完成后，重新运行测试
echo "🟢 TDD 绿灯阶段：验证实现使测试通过..."

# 测试应该通过（绿灯）
# npm test -- --run <specific-test-file>  # 应该看到 PASS
# bash -c '<DoD Test 命令>' && echo "✅ 绿灯确认：实现正确" || { echo "❌ 实现有误"; exit 1; }
```

---

## 2.2 写代码（Generator subagent）

> **主 agent 不直接写代码。** 主 agent 是编排者，代码编写由 Generator subagent 完成。
> Generator subagent 只接收：Sprint Contract（Task Card）+ coding 规范（CLAUDE.md）+ 代码库上下文。
> 不接收主 agent 的探索推理过程、Brain 调度上下文、或 planner 内部状态。

### 架构

```
主 agent（编排者）
  ├─ 2.0 行为快照 [PRESERVE]
  ├─ 2.1 探索代码（主 agent 自己做）
  ├─ 2.1.5 TDD 红灯（主 agent 自己做）
  ├─ 2.2 写代码 → spawn Generator subagent ← 你在这里
  ├─ 2.3 自验证（主 agent 自己做）
  │   ├─ 2.3.1 精准测试
  │   ├─ 2.3.2 本地 CI 镜像检查
  │   ├─ 2.3.3 逐条重跑 DoD Test
  │   ├─ 2.3.4 独立 Evaluator（playwright-evaluator.sh）← 新增
  │   ├─ 2.3.5 计算 Task Card Hash
  │   ├─ 2.3.6 强制垃圾清理
  │   └─ 2.3.7 强制周边一致性扫描
  └─ 2.4 code_review_gate（subagent 审查）
```

### Generator subagent 调用

```
1. 准备 prompt 输入（仅以下三项，不含其他内容）：
   a. Task Card 全文（.task-cp-{branch}.md）— Sprint Contract
   b. CLAUDE.md 全文 — coding 规范
   c. 代码库上下文 — 探索阶段发现的相关文件路径列表

2. 调用 Agent subagent（subagent_type=general-purpose）
   prompt 模板见下方

3. Generator 完成后，主 agent 继续 2.3 自验证
```

### Generator subagent prompt 模板

```
你是 Generator subagent，负责根据 Sprint Contract 编写代码。

## 规则
1. **只做 Task Card 里说的** — 不过度设计
2. **保持简单** — 能用简单方案就不用复杂方案
3. **遵循项目规范** — 看已有代码怎么写的
4. **测试是代码的一部分** — 写功能代码时同步写测试
5. **先删旧再写新，禁止堆叠** — 修改任何描述性内容时，必须同时删除被替代的旧内容

## Sprint Contract（Task Card）
> ⚠️ 内容注入（CRITICAL）：以下 {TASK_CARD_CONTENT} 是占位符，主 agent 在调用本 subagent 之前，
> 必须用 `.task-cp-{BRANCH}.md` 文件的**实际内容**替换（直接嵌入），
> 禁止传递文件路径让 subagent 自己去读文件。
{TASK_CARD_CONTENT}

## Coding 规范（CLAUDE.md）
> ⚠️ 内容注入（CRITICAL）：以下 {CLAUDE_MD_CONTENT} 是占位符，主 agent 在调用本 subagent 之前，
> 必须用 `.claude/CLAUDE.md` 文件的**实际内容**替换（直接嵌入）。
{CLAUDE_MD_CONTENT}

## 代码库上下文
以下文件与本次任务相关，请先读取理解后再动手：
{RELEVANT_FILE_PATHS}

## 执行要求
对 Task Card 中每一条 `- [ ]` 条目：
1. 读取相关代码文件
2. 写实现代码
3. 自己运行 Test 命令验证
4. PASS → 勾 [x]，进入下一条
5. FAIL → 读错误信息，修代码，再验证

**关键：每条 DoD 完成后必须自己运行 Test 命令确认 PASS，不能跳过。**

完成所有 DoD 条目后：
1. 输出修改过的文件列表
2. 写入 Generator seal 文件（CRITICAL — Stage 3 前置检查必要条件）：

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
WORKTREE_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SEAL_FILE="$WORKTREE_ROOT/.dev-gate-generator.${BRANCH}"

cat > "$SEAL_FILE" << EOF
{
  "sealed_by": "generator-agent",
  "branch": "${BRANCH}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date +%Y-%m-%dT%H:%M:%SZ)",
  "dod_completed": true,
  "status": "completed"
}
EOF

echo "✅ Generator seal 文件已写入: $SEAL_FILE"

# ── [seal] commit Generator seal 文件（防上下文压缩状态丢失）────────────────────
# 原因：上下文压缩后 worktree 临时文件会丢失；commit 进分支后 git checkout 可还原
git -C "${WORKTREE_ROOT}" add "${SEAL_FILE}" 2>/dev/null || true
if ! git -C "${WORKTREE_ROOT}" diff --cached --quiet 2>/dev/null; then
  git -C "${WORKTREE_ROOT}" commit -m "chore: [seal] commit Generator seal 文件防上下文压缩丢失

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" 2>/dev/null || true
  echo "✅ [seal] Generator seal 文件已 commit 到分支"
fi
# ─────────────────────────────────────────────────────────────────────────────
```

**这是 Stage 3 前置检查**：devloop-check.sh 条件 2.8 会检查此文件是否存在。
缺失 → exit 2 → 无法进入 Stage 3（push/PR）。
```

### 主 agent 调用代码（伪码）

> **内容注入原则（CRITICAL）**：主 agent 在 spawn Generator subagent 之前，必须先读取文件内容，
> 然后将实际内容字符串直接替换到 prompt 模板的占位符位置。
> 禁止只传递文件路径字符串（如 `".task-cp-xxx.md"`）让 subagent 自己去读文件——
> subagent 可能因路径解析或权限问题读不到文件，导致链路断裂。

```javascript
// 1. 读取 Task Card 和 CLAUDE.md 的实际内容（内容注入：读取文件 → 直接嵌入字符串）
const TASK_CARD = readFile(`.task-cp-${BRANCH}.md`)   // ← 文件实际内容，非路径
const CLAUDE_MD = readFile(`.claude/CLAUDE.md`)        // ← 文件实际内容，非路径

// 2. 从探索阶段收集相关文件路径（这里传路径列表，供 Generator 自行 read）
const RELEVANT_FILES = exploredFiles.join('\n')

// 3. 组装 prompt：用实际内容字符串替换占位符（内容注入的关键步骤）
const prompt = GENERATOR_PROMPT_TEMPLATE
  .replace('{TASK_CARD_CONTENT}', TASK_CARD)   // ← Task Card 实际内容直接嵌入
  .replace('{CLAUDE_MD_CONTENT}', CLAUDE_MD)   // ← CLAUDE.md 实际内容直接嵌入
  .replace('{RELEVANT_FILE_PATHS}', RELEVANT_FILES)

// 4. 调用 Generator subagent（prompt 已包含所有必要内容，subagent 无需再读文件）
Agent({
  subagent_type: "general-purpose",
  description: "Generator: 编写代码",
  prompt: prompt
})

// 5. Generator 完成后，主 agent 继续 2.3 自验证
```

### ⚠️ Generator subagent 隔离规则（CRITICAL）

| 允许传入 | 禁止传入 |
|---------|---------|
| Task Card 全文 | 主 agent 的探索推理过程 |
| CLAUDE.md 全文 | Brain API 返回的调度上下文 |
| 相关文件路径列表 | Planner 内部状态 |
| | OKR/KR/Project 层级信息 |
| | 其他 subagent 的审查结果 |

**为什么隔离**：Generator 只需要知道"做什么"（Task Card）和"怎么做"（CLAUDE.md + 代码），不需要知道"为什么要做"。信息越少，context 越高效，代码质量越高。

### 失败处理

```
Generator subagent 返回后：
  ├─ DoD 全部 [x] → 继续 2.3 自验证
  └─ 有 DoD 未完成 → 主 agent 分析原因
       ├─ 信息不足 → 补充相关文件路径，重新 spawn Generator
       └─ 实现困难 → 主 agent 自行修复（fallback，不推荐）
```

---

## 2.3 自验证（CRITICAL — 不可跳过）

> 所有 DoD 条目 [x] 后，执行完整的自验证。

### 2.3.1 精准测试（只跑改动相关文件）

> **只跑与本次改动相关的测试文件，不跑全量回归测试。全量回归交给 CI（GitHub Actions）。**
> 原因：全量测试在本地容易 OOM；本地只需要验证「我改的这部分没有明显破坏」。

```bash
echo "🎯 精准测试：查找与改动相关的测试文件..."

CHANGED_SRC=$(git diff origin/main..HEAD --name-only 2>/dev/null || git diff main..HEAD --name-only 2>/dev/null || echo "")

TEST_FILES=""
for f in $CHANGED_SRC; do
    [[ ! -f "$f" ]] && continue
    # 推导测试文件路径：src/foo.js → src/__tests__/foo.test.js
    DIR=$(dirname "$f")
    BASE=$(basename "$f" | sed 's/\.[^.]*$//')
    EXT=$(basename "$f" | grep -oE '\.[^.]+$' || echo ".js")

    # 常见测试文件命名模式
    for candidate in \
        "${DIR}/__tests__/${BASE}.test${EXT}" \
        "${DIR}/__tests__/${BASE}.spec${EXT}" \
        "${DIR}/${BASE}.test${EXT}" \
        "${DIR}/${BASE}.spec${EXT}"; do
        if [[ -f "$candidate" ]]; then
            TEST_FILES="$TEST_FILES $candidate"
            break
        fi
    done
done

if [[ -z "${TEST_FILES// }" ]]; then
    echo "ℹ️  未找到对应测试文件，跳过本地精准测试（全量回归由 CI 负责）"
else
    echo "📋 运行精准测试：$TEST_FILES"
    npx vitest run $TEST_FILES 2>&1 || { echo "❌ 精准测试失败，修复后再继续"; exit 1; }
    echo "✅ 精准测试通过"
fi
```

| 结果 | 动作 |
|------|------|
| 找到测试文件且通过 | 继续 2.3.2 |
| 找到测试文件但失败 | 修复代码 → 重跑 |
| 未找到测试文件 | 跳过，CI 负责全量 |

### 2.3.2 本地 CI 镜像检查

```bash
CHANGED=$(git diff --name-only main...HEAD 2>/dev/null || git diff --name-only origin/main...HEAD)

# Workspace 改动 → npm run build
if echo "$CHANGED" | grep -q "^apps/"; then
    APP_DIR=$(echo "$CHANGED" | grep "^apps/" | head -1 | cut -d'/' -f1-2)
    if [[ -f "$APP_DIR/package.json" ]]; then
        (cd "$APP_DIR" && npm run build 2>&1) || { echo "❌ Workspace build 失败，修复后再继续"; exit 1; }
    fi
fi

# Brain 改动 → local-precheck
if echo "$CHANGED" | grep -qE "^packages/brain/|^DEFINITION\.md$"; then
    bash scripts/local-precheck.sh || { echo "❌ Brain local-precheck 失败，修复后再继续"; exit 1; }
fi

# Engine 改动 → version-sync
if echo "$CHANGED" | grep -q "^packages/engine/"; then
    bash packages/engine/ci/scripts/check-version-sync.sh 2>&1 || { echo "❌ Engine version-sync 失败，修复后再继续"; exit 1; }
fi
```

### 2.3.3 逐条重跑 DoD Test（最终确认）

> **由 bash-guard.sh（Claude Code PreToolUse hook）实时拦截调用 verify-step.sh，不依赖 AI 自觉。**
> 当 AI 标记 `step_2_code: done` 时，`verify-step.sh step2` 会自动：
> 1. 读取 Task Card（`.task-{BRANCH}.md`）
> 2. 提取所有 `[BEHAVIOR]/[ARTIFACT]/[GATE]` 条目的 Test 字段（[PRESERVE] 由 Gate 0a 单独处理，仅检查数量）
> 3. 对 `manual:` 开头的 Test，执行该命令（在项目根目录）
> 4. 对 `contract:` 开头的 Test，标记 DEFERRED 跳过
> 5. 对 `tests/` 开头的 Test，检查文件是否存在
> 6. 任一 Test 失败 → verify-step 返回 exit 1 → 不允许标记完成

```bash
# verify-step.sh 会在 step_2_code: done 写入时被 bash-guard.sh (PreToolUse hook) 自动调用
# 也可以手动运行确认：
bash packages/engine/hooks/verify-step.sh step2 "$BRANCH" "$(pwd)"
```

**这是你 push 前的最后防线。Gate 2 确保每条 DoD [BEHAVIOR] Test 都被真实执行过，不能只靠 npm test。**

### 2.3.4 独立 Evaluator 验证（CRITICAL — 防 Generator 自验自过）

> **为什么需要这一步**：Generator 自验证（2.3.3）是 Generator 自己跑自己写的 Test，存在"左手打右手"的问题。
> 独立 Evaluator 从 Task Card 读取 Sprint Contract 约定的 [BEHAVIOR] Test 命令，独立执行，
> 不依赖 Generator 的自述，只看命令退出码是 0 还是非 0。

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
TASK_CARD=$(ls .task-cp-*.md 2>/dev/null | head -1)

if [[ -z "$TASK_CARD" ]]; then
    echo "⚠️  找不到 Task Card，跳过独立 Evaluator 验证"
else
    echo "🔍 独立 Evaluator 验证（playwright-evaluator.sh）..."

    # 寻找脚本路径
    EVALUATOR_SCRIPT=""
    for _path in \
        "packages/engine/scripts/devgate/playwright-evaluator.sh" \
        "scripts/devgate/playwright-evaluator.sh"; do
        if [[ -f "$_path" ]]; then
            EVALUATOR_SCRIPT="$_path"
            break
        fi
    done

    if [[ -z "$EVALUATOR_SCRIPT" ]]; then
        echo "⚠️  playwright-evaluator.sh 未找到，跳过独立验证"
    else
        EVAL_SEAL=".dev-gate-evaluator.${BRANCH}"

        # 执行独立 Evaluator（无限重试直到 PASS）
        eval_retry=0
        while true; do
            eval_retry=$((eval_retry + 1))
            echo "  [Evaluator 第 ${eval_retry} 轮]"

            rm -f "$EVAL_SEAL"
            bash "$EVALUATOR_SCRIPT" "$TASK_CARD" "$BRANCH" "$(pwd)"
            EVAL_EXIT=$?

            if [[ $EVAL_EXIT -eq 0 ]]; then
                echo "✅ 独立 Evaluator PASS — [BEHAVIOR] Test 全部通过"
                break
            else
                echo "❌ 独立 Evaluator FAIL — 部分 [BEHAVIOR] Test 失败"
                echo ""
                echo "打回 Generator：请分析失败原因，修复代码，然后重新运行自验证和 Evaluator。"
                echo "失败详情见 seal 文件: ${EVAL_SEAL}"
                if [[ -f "$EVAL_SEAL" ]]; then
                    cat "$EVAL_SEAL"
                fi
                # FAIL → 停止，等 Generator 修复代码后手动重新触发（bash-guard 会拦截标记完成）
                exit 1
            fi
        done
    fi
fi
```

**执行时注意**：
- Evaluator 只执行 `[BEHAVIOR]` 条目的 Test 命令（`[ARTIFACT]` 和 `[GATE]` 由 2.3.3 覆盖）
- `manual:node -e "..."` → 直接执行；`tests/xxx.ts` → 检查文件存在；`contract:` → 跳过
- FAIL 时 Generator 必须修复代码，重新从 2.3.1 开始，不能绕过 Evaluator 直接继续
- seal 文件写入 `.dev-gate-evaluator.{BRANCH}`，格式与其他 gate seal 一致（verdict/passed/failed）

### 2.3.5 计算 Task Card Hash（TDD 锁定）

```bash
TASK_CARD=$(ls .task-cp-*.md 2>/dev/null | head -1)
if [[ -n "$TASK_CARD" ]]; then
    TC_HASH=$(shasum -a 256 "$TASK_CARD" | awk '{print "sha256:" $1}')
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    echo "task_card_hash: $TC_HASH" >> ".dev-mode.${BRANCH}"
    echo "✅ Task Card hash 已锁定: $TC_HASH"
fi
```

### 2.3.6 ⛔ 强制垃圾清理（push 前，不可跳过）

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
        COMMENTED_CODE=$(grep -c "^[[:space:]]*//" "$f" 2>/dev/null || true)
        COMMENTED_CODE=${COMMENTED_CODE:-0}
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

### 2.3.7 ⛔ 强制周边一致性扫描（push 前，不可跳过）

> **改动文件 A 时，必须扫描 A 所在目录的同级文件，修复与本次改动矛盾的旧描述。**
> 目标：系统越走越干净——不只改 A，同时清理周边引用了 A 旧行为的矛盾内容。

```bash
echo "🔍 周边一致性扫描（cross-file module consistency）..."

CHANGED_FILES=$(git diff origin/main..HEAD --name-only 2>/dev/null || git diff main..HEAD --name-only 2>/dev/null || echo "")
CROSS_ISSUES=0

for f in $CHANGED_FILES; do
    [[ ! -f "$f" ]] && continue
    DIR=$(dirname "$f")

    # 扫描同目录其他文件
    while IFS= read -r sibling; do
        [[ "$sibling" == "$f" ]] && continue
        [[ ! -f "$sibling" ]] && continue

        # 检查：sibling 是否引用了 f 的旧版本号
        OLD_VER=$(git diff origin/main..HEAD -- "$f" 2>/dev/null | grep "^-" | grep -oE "version: [0-9]+\.[0-9]+\.[0-9]+" | head -1 | awk '{print $2}')
        NEW_VER=$(git diff origin/main..HEAD -- "$f" 2>/dev/null | grep "^+" | grep -oE "version: [0-9]+\.[0-9]+\.[0-9]+" | tail -1 | awk '{print $2}')
        if [[ -n "$OLD_VER" && -n "$NEW_VER" ]] && grep -q "$OLD_VER" "$sibling" 2>/dev/null; then
            echo "  ⚠️  矛盾：$sibling 引用了 $f 的旧版本 $OLD_VER（现为 $NEW_VER）"
            CROSS_ISSUES=$((CROSS_ISSUES+1))
        fi

        # 检查：sibling 是否引用了被重编号/删除的步骤
        OLD_SECTIONS=$(git diff origin/main..HEAD -- "$f" 2>/dev/null | grep "^-" | grep -oE "### [0-9]+\.[0-9]+(\.[0-9]+)?" | sed 's/### //')
        for sec in $OLD_SECTIONS; do
            if grep -q "步骤 $sec\b\|Step $sec\b\|节 $sec\b" "$sibling" 2>/dev/null; then
                echo "  ⚠️  矛盾：$sibling 引用了 $f 中已重编号/删除的节 $sec"
                CROSS_ISSUES=$((CROSS_ISSUES+1))
            fi
        done

    done < <(find "$DIR" -maxdepth 1 \( -name "*.md" -o -name "*.sh" -o -name "*.ts" -o -name "*.js" -o -name "*.yaml" -o -name "*.yml" \) 2>/dev/null)
done

if [[ $CROSS_ISSUES -gt 0 ]]; then
    echo ""
    echo "⛔ 发现 $CROSS_ISSUES 处跨文件矛盾，必须同步修复后才能继续！"
    echo "   直接修复同目录矛盾文件（同 PR），commit message 前缀用 fix:"
    exit 1
fi

echo "✅ 周边一致性扫描通过 — 无跨文件矛盾"
```

---

### 2.3.8 推送前完整验证

> push 前跑一遍 CI 会检查的东西，减少 CI 失败率。
> 全量测试已在 2.3.1 精准测试中覆盖（有则运行，无则 CI 负责），此处不重复运行。

```bash
# 1. 检查 Learning 格式（如果已写）
LEARNING_FILE="docs/learnings/$(git branch --show-current).md"
if [[ -f "$LEARNING_FILE" ]]; then
    bash packages/engine/scripts/devgate/check-learning.sh "$LEARNING_FILE" || { echo "❌ Learning 格式检查失败，修复后再 push"; exit 1; }
fi

# 2. 检查 DoD 映射
node packages/engine/scripts/devgate/check-dod-mapping.cjs || { echo "❌ DoD 映射检查失败，修复后再 push"; exit 1; }
```

---

### 完成后

**标记步骤完成**：

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
sed -i '' "s/^step_2_code: pending/step_2_code: done/" "$DEV_MODE_FILE" 2>/dev/null || \\
sed -i "s/^step_2_code: pending/step_2_code: done/" "$DEV_MODE_FILE"
echo "✅ Stage 2 完成标记已写入 .dev-mode"
```

**状态持久化：git commit .dev-mode.{branch}（v6.4.0 新增，CRITICAL）**：

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# 将更新后的 .dev-mode.{branch} commit 进分支
# 上下文压缩后可通过 git checkout 恢复状态层，devloop-check.sh 不再失明
git add ".dev-mode.${BRANCH_NAME}" 2>/dev/null || true
if ! git diff --cached --quiet 2>/dev/null; then
    git commit -m "chore: [state] persist .dev-mode.${BRANCH_NAME} — Stage 2 Code 完成

上下文压缩后可通过 git checkout 恢复状态层，devloop-check.sh 不再失明。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" 2>/dev/null || true
    echo "✅ [state] .dev-mode.${BRANCH_NAME} 已 commit 进分支（step_2_code: done）"
else
    echo "ℹ️  [state] .dev-mode.${BRANCH_NAME} 无变更（已是最新状态）"
fi
```

**Task Checkpoint**: `TaskUpdate({ taskId: "STAGE_2_TASK_ID", status: "completed" })`
<!-- 注意：taskId 在 Stage 0 创建任务时获取，这里是概念示意，实际值从 Brain API 返回 -->

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
     - **CRITICAL**: prompt 必须包含以下指令（seal 文件写入）：
         "审查完成后，将你的裁决以 JSON 格式写入文件 .dev-gate-crg.<BRANCH>：
          { \"verdict\": \"PASS\"|\"FAIL\", \"branch\": \"<BRANCH>\",
            \"timestamp\": \"<ISO8601>\", \"reviewer\": \"code-review-gate-agent\",
            \"issues\": [...] }
          这是 Gate 防伪机制的 seal 文件，必须由你（subagent）直接写入。"
  2. 解析 JSON 结果中的 "verdict" 字段
  3. verdict == "PASS"
       → 确认 seal 文件 .dev-gate-crg.${BRANCH} 已存在（由 subagent 写入）
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
- **CRITICAL**: subagent prompt 必须包含 seal 文件写入指令（`.dev-gate-crg.<BRANCH>`）
- 不要向 Brain 注册任务，不要走 Codex 异步派发路径
- FAIL 修复后必须重新获取 git diff 再调用 subagent，不能跳过重审

---

**继续执行下一步**：

1. 读取 `skills/dev/steps/03-integrate.md`
2. 立即 push + 创建 PR
3. **不要**输出总结或等待确认
