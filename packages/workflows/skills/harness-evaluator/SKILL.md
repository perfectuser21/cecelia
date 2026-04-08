---
id: harness-evaluator-skill
description: |
  Harness Evaluator — Harness v4.0 独立广谱验证者。
  读 PR diff + sprint-contract.md，静态验证代码是否符合合同规格。
  禁止调用 localhost API（P0 修复：旧 Brain 运行的是 main 分支代码，不是 PR 代码）。
version: 4.0.0
created: 2026-04-08
updated: 2026-04-08
changelog:
  - 4.0.0: Harness v4.0 — P0 修复：改为读 PR diff 静态验证，禁止调 localhost API
  - 3.1.0: v3.1 — 独立广谱验证者（已废弃：调 localhost 测的是旧代码）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**

# /harness-evaluator — Harness v4.0 独立广谱验证者

**角色**: 独立验证者（Independent Verifier）  
**对应 task_type**: `harness_evaluate`  
**核心定位**: **读 PR diff + 合同，静态验证实现是否符合规格**

---

## ⚠️ P0 规则：禁止调用 localhost API

```
旧错误：curl localhost:5221/... 
→ 测的是 main 分支的旧 Brain，不是 PR 里的新代码

正确做法：读 PR diff，对照合同，静态分析实现
```

**绝对禁止**：
- `curl localhost:5221/...` → 测的不是 PR 代码
- `psql cecelia -c ...` → 测的是当前 DB 状态，与 PR 无关
- 调用任何本地运行服务

---

## 输入参数

从 Brain 任务 payload 中获取：

| 参数 | 来源 | 说明 |
|------|------|------|
| `sprint_dir` | payload | sprint 文件目录（如 `sprints/run-20260408-0938`） |
| `pr_url` | payload | Generator 提交的 PR URL |
| `eval_round` | payload | 当前评估轮次（1 = 首次，2+ = 修复后再测） |
| `harness_mode` | payload | 固定为 true |

---

## 执行流程

### Step 1: 获取参数 + 读取合同

```bash
TASK_PAYLOAD=$(curl -s localhost:5221/api/brain/tasks/{TASK_ID} | jq '.payload')
SPRINT_DIR=$(echo $TASK_PAYLOAD | jq -r '.sprint_dir // "sprints"')
PR_URL=$(echo $TASK_PAYLOAD | jq -r '.pr_url // ""')
EVAL_ROUND=$(echo $TASK_PAYLOAD | jq -r '.eval_round // "1"')

cd "$(git rev-parse --show-toplevel)"

# 读取已批准合同
CONTRACT_FILE="${SPRINT_DIR}/sprint-contract.md"
if [ ! -f "$CONTRACT_FILE" ]; then
  echo "❌ sprint-contract.md 不存在: $CONTRACT_FILE"
  exit 1
fi

echo "✅ 读取合同: $CONTRACT_FILE"
cat "$CONTRACT_FILE"
```

---

### Step 2: 获取 PR diff

```bash
# 获取 PR 的完整 diff（Generator 实际写了什么）
gh pr diff "$PR_URL" > /tmp/pr-diff.txt 2>&1
cat /tmp/pr-diff.txt
```

> 这是验证的核心数据源。所有验证必须基于 diff，不能基于 localhost 运行状态。

---

### Step 3: 对照合同，静态验证每个 Feature

对合同里的每个 Feature，回答以下问题：

1. **实现存在吗？** diff 里有对应的代码变更吗？
2. **行为符合描述吗？** 实现逻辑是否与合同的行为描述一致？
3. **硬阈值满足吗？** 代码能产出符合硬阈值的结果吗？
4. **边界情况处理了吗？** 合同里列出的边界条件，代码有处理吗？

**验证方法**：
- `grep` 特定函数/路由/字段是否在 diff 中出现
- 读 diff 中的新增代码逻辑，判断是否符合行为描述
- 检查合同硬阈值（如 "返回 status 字段"），看 diff 里是否有对应实现

---

### Step 4: 写入 eval-round-N.md

```bash
EVAL_FILE="${SPRINT_DIR}/eval-round-${EVAL_ROUND}.md"

cat > "$EVAL_FILE" << 'EVAL'
# Eval Round {N} — {PASS/FAIL}

**评估时间**: {时间}
**评估轮次**: {N}
**PR URL**: {PR_URL}
**总体结论**: PASS / FAIL

## 功能验证结果

| Feature | 实现存在 | 行为符合 | 硬阈值满足 | 结论 |
|---------|---------|---------|-----------|------|
| Feature 1 | ✅ | ✅ | ✅ | PASS |
| Feature 2 | ✅ | ❌ | - | FAIL |

## 详细报告

### Feature 1: <功能名>

**合同行为描述**: <从合同提取>  
**硬阈值**: <量化标准>

**diff 证据**:
```diff
<相关 diff 片段>
```

**分析**: <实现是否符合描述>  
**结论**: ✅ PASS / ❌ FAIL

## FAIL 汇总（如有）

### FAIL 1: <Feature 名>
- **问题**: <具体哪里不对>
- **合同要求**: <合同原文>
- **实际实现**: <diff 里看到的>
- **修复建议**: <Generator 应该怎么改>
EVAL

# push 到 PR 分支
PR_BRANCH=$(gh pr view "$PR_URL" --json headRefName -q '.headRefName' 2>/dev/null || echo "")
if [ -n "$PR_BRANCH" ]; then
  git fetch origin "$PR_BRANCH"
  git checkout "$PR_BRANCH"
  git add "$EVAL_FILE"
  git commit -m "eval: round-${EVAL_ROUND} verdict=${VERDICT}"
  git push origin "$PR_BRANCH"
fi
```

---

### Step 5: 回写 Brain + 输出 verdict

```bash
curl -X PATCH localhost:5221/api/brain/tasks/{TASK_ID} \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"completed\",\"result\":{\"verdict\":\"${VERDICT}\",\"eval_round\":${EVAL_ROUND}}}"
```

**最后一条消息**（字面量 JSON，不要用代码块包裹）：

PASS 时：
```
{"verdict": "PASS", "eval_round": N, "sprint_dir": "sprints/...", "failed_features": []}
```

FAIL 时：
```
{"verdict": "FAIL", "eval_round": N, "sprint_dir": "sprints/...", "failed_features": ["Feature 2: <具体原因>"]}
```

---

## 禁止事项

1. **禁止调 localhost:5221** — 测的是旧 Brain，不是 PR 代码
2. **禁止给同情分** — 合同说有就必须有，没有就是 FAIL
3. **禁止帮 Generator 修代码**
4. **禁止读源码猜意图** — 只看 diff 里实际写了什么
