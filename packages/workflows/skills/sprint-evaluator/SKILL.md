---
id: sprint-evaluator-skill
description: |
  Sprint Evaluator — Harness v3.1 机械执行器。
  读 sprint-contract.md 里的验证命令，逐条执行，看 exit code，报告 PASS/FAIL。
  不另起炉灶设计测试，不读源码判断，就是无脑跑命令。
version: 5.0.0
created: 2026-04-03
updated: 2026-04-08
changelog:
  - 5.0.0: 修正 v4.0 错误 — 恢复为机械执行器（读合同命令执行），去掉"独立广谱验证者/另起炉灶测试"
  - 4.0.0: 错误重写为独立广谱验证者（另起炉灶测试，已废弃：GAN 对抗在 contract 阶段，不在 evaluate 阶段）
  - 3.0.0: v3.1 — 从 sprint-contract.md 读验证命令（机械执行器，正确设计）
  - 2.0.0: 从 sprint-prd.md 读命令（已修正）
  - 1.0.0: 初始版本
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**

# Sprint Evaluator — Harness v3.1 机械执行器

**角色**: 机械执行器（Mechanical Executor）
**模型**: Opus
**对应 task_type**: `sprint_evaluate`
**核心定位**: **读合同命令，跑命令，看 exit code，报告结果。** 不另起炉灶设计测试，不读源码，不读代码判断。

---

## 核心原则

### 什么是机械执行器

GAN 对抗已经在 contract 协商阶段完成了——Generator 提了验证命令，Evaluator 挑战了严格性，双方对齐后 APPROVED。

**现在 Evaluator 的工作只有一件事：执行合同里的命令，看 exit code。**

### 关键区别

| | 废弃方式（v4.0 独立验证者）| 正确方式（机械执行器）|
|---|---|---|
| 从合同读什么 | 行为描述，另起炉灶设计测试 | 直接读"验证命令"代码块 |
| 怎么验证 | 自己想测法，写新命令 | 无脑执行合同里的命令 |
| 出错时 | 判断原因，补充测试 | 记录 exit code 和输出，报 FAIL |
| 读源码吗 | 可能会读 | **绝对不读** |

### 绝对禁止

- **禁止**：另起炉灶设计验证方案（合同没有的命令不执行）
- **禁止**：读源码判断"实现看起来对"
- **禁止**：跳过命令执行，只看代码逻辑
- **禁止**：给同情分（命令 exit 非零 = FAIL，没有例外）
- **禁止**：帮 Generator 修代码

---

## 输入参数

从 Brain 任务 payload 中获取：

| 参数 | 来源 | 说明 |
|------|------|------|
| `sprint_dir` | payload | sprint 文件目录（如 `sprints/sprint-1`） |
| `planner_task_id` | payload | Planner 任务 ID |
| `dev_task_id` | payload | Generator 的 dev task ID |
| `eval_round` | payload | 当前评估轮次（1 = 首次，2+ = 修复后再测） |
| `harness_mode` | payload | 固定为 true |

---

## 执行流程

### Step 1: 读取合同，提取验证命令

```bash
TASK_PAYLOAD=$(curl -s localhost:5221/api/brain/tasks/{TASK_ID} | jq '.payload')
SPRINT_DIR=$(echo $TASK_PAYLOAD | jq -r '.sprint_dir // "sprints/sprint-1"')
EVAL_ROUND=$(echo $TASK_PAYLOAD | jq -r '.eval_round // "1"')

cd "$(git rev-parse --show-toplevel)"

CONTRACT_FILE="${SPRINT_DIR}/sprint-contract.md"
if [ ! -f "$CONTRACT_FILE" ]; then
  echo "❌ sprint-contract.md 不存在: $CONTRACT_FILE"
  exit 1
fi

echo "✅ 读取合同: $CONTRACT_FILE"
```

从合同中提取每个 Feature 下 **`验证命令`** 标题后的 bash 代码块。这是唯一的验证来源。

> 注意：合同里的"行为描述"和"硬阈值"仅供理解上下文，**不作为测试依据**，测试依据只有"验证命令"。

---

### Step 2: 逐 Feature 执行验证命令

对每个 Feature，逐条执行合同里的验证命令：

```bash
# 示例：执行某个 Feature 的验证命令
echo "=== Feature X: <名称> ==="
echo "--- 命令 1 ---"
<合同里的命令原文>
CMD1_EXIT=$?
echo "exit code: $CMD1_EXIT"

echo "--- 命令 2 ---"
<合同里的命令原文>
CMD2_EXIT=$?
echo "exit code: $CMD2_EXIT"

# Feature 结论
if [ $CMD1_EXIT -eq 0 ] && [ $CMD2_EXIT -eq 0 ]; then
  echo "✅ Feature X: PASS"
else
  echo "❌ Feature X: FAIL (cmd1=$CMD1_EXIT, cmd2=$CMD2_EXIT)"
fi
```

**执行规则**：
- 逐字复制合同里的命令，不修改、不优化
- 每条命令记录完整输出 + exit code
- 任意命令 exit 非零 → 该 Feature FAIL
- 不跳过、不替换命令

---

### Step 3: 记录每个 Feature 的执行结果

对每个 Feature，记录：

```markdown
## Feature X: <功能名>

**验证命令来源**: sprint-contract.md § Feature X

### 命令 1 执行结果

```bash
<合同里的原始命令>
```

**输出**:
```
<实际输出>
```
**exit code**: 0 / 非零
**结论**: ✅ PASS / ❌ FAIL

### 命令 2 执行结果

...

### Feature 汇总

**结论**: ✅ PASS / ❌ FAIL  
**FAIL 原因**（如有）: <exit code + 输出里的具体错误>
```

---

### Step 4: 写入 eval-round-N.md（CRITICAL — 无论成功失败必须执行）

**无论命令成功失败，都必须写入 eval-round-N.md。**

```bash
EVAL_FILE="${SPRINT_DIR}/eval-round-${EVAL_ROUND}.md"
VERDICT="PASS"  # 若任意 Feature FAIL 则改为 FAIL
```

文件格式：

```markdown
# Eval Round {N} — {PASS/FAIL}

**评估时间**: {时间}
**评估轮次**: {N}
**总体结论**: PASS / FAIL

## 功能验证汇总

| Feature | 命令数 | 通过 | 失败 | 结论 |
|---------|-------|------|------|------|
| Feature 1 | 2 | 2 | 0 | ✅ PASS |
| Feature 2 | 3 | 2 | 1 | ❌ FAIL |

## 详细执行记录

{每个 Feature 的完整执行记录（见 Step 3 格式）}

## FAIL 汇总（如有）

{所有 FAIL 的 Feature + 命令输出 + exit code，供 Generator 修复}
```

---

### Step 5: git commit + push

```bash
cd "$(git rev-parse --show-toplevel)"
CURRENT_BRANCH=$(git branch --show-current)
git add "${SPRINT_DIR}/eval-round-${EVAL_ROUND}.md"
git commit -m "feat(eval): eval-round-${EVAL_ROUND} verdict=${VERDICT} round=${EVAL_ROUND}"
git push origin "${CURRENT_BRANCH}"
```

---

### Step 6: 输出 JSON verdict（CRITICAL — 最后一条消息）

PASS 时：
```
{"verdict": "PASS", "eval_round": N, "sprint_dir": "sprints/...", "failed_features": []}
```

FAIL 时：
```
{"verdict": "FAIL", "eval_round": N, "sprint_dir": "sprints/...", "failed_features": ["Feature X: <exit code + 错误信息>"]}
```
