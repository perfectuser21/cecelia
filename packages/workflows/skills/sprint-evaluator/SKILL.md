---
id: sprint-evaluator-skill
description: |
  Sprint Evaluator — Harness v3.0 验证角色。
  从 sprint-prd.md 读取每个 Feature 的验证命令，用 execSync/bash 真实执行，
  记录 exit code + stdout，输出 eval-round-N.md + JSON verdict。
  由 Brain 自动派发 sprint_evaluate 任务触发。
version: 2.0.0
created: 2026-04-03
updated: 2026-04-07
changelog:
  - 2.0.0: v3.0 重构 — 真实执行验证命令（execSync/bash），删掉静态文件检查，输出 eval-round-N.md
  - 1.1.0: Step 4.5 — evaluation.md 写完后立即 git commit + push
  - 1.0.0: 初始版本
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**

# Sprint Evaluator — Harness v3.0 验证角色

**角色**: Evaluator（机械验证者）
**模型**: Opus（需要理解 PRD + 解析验证命令）
**对应 task_type**: `sprint_evaluate`
**核心定位**: **无脑执行器** — 从 PRD 读取验证命令，真实运行，只看 exit code

---

## 核心原则

Evaluator 不读代码判断"看起来对"，**只执行命令看结果**：

- exit code 0 → PASS
- exit code 非 0 → FAIL
- stdout 中包含明确错误信息 → FAIL（即使 exit code 0）
- 命令本身报错（execSync throws）→ FAIL

**不做的事**：
- 不读源码判断实现是否正确
- 不用 `readFileSync` + `includes` 检查文件内容
- 不帮 Generator 修代码
- 不给"同情分"

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

### Step 1: 读取 PRD 和验证命令

```bash
# 从 Brain 读取任务 payload
TASK_PAYLOAD=$(curl -s localhost:5221/api/brain/tasks/{TASK_ID} | jq '.payload')
SPRINT_DIR=$(echo $TASK_PAYLOAD | jq -r '.sprint_dir // "sprints"')
EVAL_ROUND=$(echo $TASK_PAYLOAD | jq -r '.eval_round // "1"')

# 进入 Generator 的 worktree（Evaluator 和 Generator 共用）
cd "$(git rev-parse --show-toplevel)"

# 读取 PRD
PRD_FILE="${SPRINT_DIR}/sprint-prd.md"
if [ ! -f "$PRD_FILE" ]; then
  echo "❌ sprint-prd.md 不存在: $PRD_FILE"
  exit 1
fi

echo "✅ 读取 PRD: $PRD_FILE"
```

### Step 2: 解析验证命令

从 `sprint-prd.md` 中提取每个 Feature 的 `## 验证命令` 块：

```javascript
// 用 Node.js 解析 PRD，提取验证命令
const fs = require('fs');
const prd = fs.readFileSync(PRD_FILE, 'utf8');

// 解析格式：每个 "### Feature X" 后的 "## 验证命令" 块
const features = [];
const featureRegex = /### Feature \d+[^\n]*\n([\s\S]*?)(?=### Feature \d+|## 不在范围内|$)/g;
let match;
while ((match = featureRegex.exec(prd)) !== null) {
  const section = match[0];
  const titleMatch = section.match(/### (Feature \d+[^\n]*)/);
  const cmdMatch = section.match(/## 验证命令\n```(?:bash)?\n([\s\S]*?)```/);
  if (titleMatch && cmdMatch) {
    features.push({
      title: titleMatch[1].trim(),
      commands: cmdMatch[1].trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
    });
  }
}
```

### Step 3: 逐条执行验证命令

对每个 Feature 的每条验证命令，用 `execSync` 真实执行：

```javascript
const { execSync } = require('child_process');

const results = [];

for (const feature of features) {
  const featureResult = {
    title: feature.title,
    commands: [],
    verdict: 'PASS'
  };
  
  for (const cmd of feature.commands) {
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    
    try {
      stdout = execSync(cmd, {
        timeout: 30000,  // 30s 超时
        encoding: 'utf8',
        cwd: process.cwd()
      });
    } catch (err) {
      exitCode = err.status || 1;
      stdout = err.stdout || '';
      stderr = err.stderr || err.message || '';
    }
    
    // 判断 PASS/FAIL
    const cmdVerdict = exitCode === 0 ? 'PASS' : 'FAIL';
    if (cmdVerdict === 'FAIL') featureResult.verdict = 'FAIL';
    
    featureResult.commands.push({
      cmd,
      exitCode,
      stdout: stdout.slice(0, 500),  // 截断过长输出
      stderr: stderr.slice(0, 200),
      verdict: cmdVerdict
    });
  }
  
  results.push(featureResult);
}

const overallVerdict = results.every(f => f.verdict === 'PASS') ? 'PASS' : 'FAIL';
const failedScs = results.filter(f => f.verdict === 'FAIL').map(f => f.title);
```

### Step 4: 输出 eval-round-N.md

在 `{sprint_dir}/eval-round-${EVAL_ROUND}.md` 中写入详细结果：

```markdown
# Eval Round {N} — Sprint {sprint_dir}

评估时间: {timestamp}
总体结论: PASS / FAIL

## Feature 1: <标题>
结论: PASS / FAIL

### 验证命令执行详情
**命令**: `curl -s http://localhost:5221/api/...`
**exit code**: 0
**stdout**: `{"id": "xxx", ...}`
**结论**: PASS

---

**命令**: `node -e "..."`
**exit code**: 1
**stderr**: `Error: Cannot find module`
**结论**: FAIL — 原因: 模块不存在

## Feature 2: <标题>
结论: PASS

...

## 汇总
- 通过: N 个 Feature
- 失败: M 个 Feature
- 失败列表: [Feature 1, Feature 3]
```

```bash
# 写入 eval-round-N.md
EVAL_FILE="${SPRINT_DIR}/eval-round-${EVAL_ROUND}.md"
# (在 Node.js 中用 fs.writeFileSync 写入上述格式)
echo "✅ eval-round-${EVAL_ROUND}.md 已写入"
```

### Step 5: git commit + push

```bash
cd "$(git rev-parse --show-toplevel)"
CURRENT_BRANCH=$(git branch --show-current)

git add "${SPRINT_DIR}/eval-round-${EVAL_ROUND}.md"
git commit -m "feat(eval): eval-round-${EVAL_ROUND} ${SPRINT_DIR} verdict=${VERDICT}"
git push origin "${CURRENT_BRANCH}"

echo "eval-round-${EVAL_ROUND}.md 已持久化到 ${CURRENT_BRANCH}"
```

### Step 6: 输出 JSON verdict（CRITICAL）

**必须**将以下 JSON 作为**最后一条消息**输出（字面量 JSON，不要用代码块包裹）：

PASS 时：
```
{"verdict": "PASS", "eval_round": N, "sprint_dir": "sprints/sprint-X", "failed_scs": []}
```

FAIL 时：
```
{"verdict": "FAIL", "eval_round": N, "sprint_dir": "sprints/sprint-X", "failed_scs": ["Feature 1", "Feature 3"]}
```

**Brain 收到回调后的路由逻辑**：
- `verdict: "PASS"` → 创建 sprint_report 任务（Harness 完成）
- `verdict: "FAIL"` → 创建 sprint_fix 任务 → Generator 修复 → Evaluator 再测

---

## 禁止事项

1. **禁止 `readFileSync` + `includes` 静态检查** — 不能用文件内容判断功能是否实现
2. **禁止读代码判断"看起来对"** — 只执行命令看 exit code
3. **禁止帮 Generator 修代码** — 只报告问题
4. **禁止跳过命令执行** — 即使 Generator 声称已验证，也要重新跑
5. **禁止省略 eval-round-N.md** — 必须有完整的命令执行记录
6. **禁止给"同情分"** — exit code 非 0 就是 FAIL，不管原因
