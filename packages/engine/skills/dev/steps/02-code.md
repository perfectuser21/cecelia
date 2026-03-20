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

# Step 2: Code — 写代码 + 自验证

> 探索代码 → 写实现 → 逐条验证 DoD → 本地测试 → /simplify（建议）→ 计算 Task Card hash

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

```bash
# 读 Task Card，逐条执行 Test: 命令
# 所有 PASS → 继续
# 任何 FAIL → 修复 → 重跑
```

**这是你 push 前的最后防线。Codex 会在 push 后独立再跑一遍，但你自己先过一遍能减少 90% 的返工。**

### 2.3.4 /simplify（建议执行）

执行 `/simplify` skill 让代码更简洁。这不是强制的——如果改动很小（<50 行），可以跳过。

```
/simplify 检查的维度：
- 复用性：相似逻辑是否可以提取
- 质量：命名是否清晰
- 效率：是否有不必要的循环或过度抽象
```

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

---

## 2.4 代码审查说明

> **代码审查在 Step 3 由 3 个独立 Codex agent 完成，不在 Step 2 做。**
>
> Push 后 Brain dispatch-now 并行派发：
> - **Codex A**: CTO Review（架构 + 需求符合度 + 安全）
> - **Codex B**: DoD 独立验证（逐条跑 Test 命令）
> - **Codex C**: PRD 覆盖审计（承诺 vs 实际实现）
>
> 主 agent 在 Step 2 完成后直接进入 Step 3，无需在此处做代码审查。

---

### 完成后

**标记步骤完成**：

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
sed -i "s/^step_2_code: pending/step_2_code: done/" "$DEV_MODE_FILE"
echo "✅ Step 2 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "2", status: "completed" })`

**立即执行下一步**：

1. 读取 `skills/dev/steps/03-prci.md`
2. 立即 push + 创建 PR
3. **不要**输出总结或等待确认
