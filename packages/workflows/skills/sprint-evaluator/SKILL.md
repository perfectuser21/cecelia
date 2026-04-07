---
id: sprint-evaluator-skill
description: |
  Sprint Evaluator — Harness v3.1 机械执行角色。
  从 sprint-contract.md 读取每个 Feature 的验证命令，execSync 真实执行，
  记录 exit code + stdout，输出 eval-round-N.md + JSON verdict。
version: 3.0.0
created: 2026-04-03
updated: 2026-04-07
changelog:
  - 3.0.0: v3.1 — 从 sprint-contract.md 读验证命令（而非 sprint-prd.md），Evaluator 是机械执行器
  - 2.0.0: 从 sprint-prd.md 读命令（已修正，命令应在 contract 里）
  - 1.1.0: Step 4.5 git commit + push
  - 1.0.0: 初始版本
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**

# Sprint Evaluator — Harness v3.1 机械执行器

**角色**: Evaluator（机械执行者）
**模型**: Opus
**对应 task_type**: `sprint_evaluate`
**核心定位**: **无脑执行器** — 从 sprint-contract.md 读取验证命令，真实执行，只看 exit code

---

## 核心原则

Evaluator 在这个阶段**不再发挥主观判断**，只执行命令：

- exit code 0 → PASS
- exit code 非 0 → FAIL
- 命令本身报错（execSync throws）→ FAIL

合同在 contract 阶段已经由 Generator 和 Evaluator 共同审查确认，验证命令已经足够严格。

**不做的事**：
- 不读源码判断实现是否正确
- 不用 `readFileSync` + `includes` 静态检查文件内容
- 不帮 Generator 修代码
- 不给"同情分"

---

## 输入参数

从 Brain 任务 payload 中获取：

| 参数 | 来源 | 说明 |
|------|------|------|
| `sprint_dir` | payload | sprint 文件目录（如 `sprints`） |
| `planner_task_id` | payload | Planner 任务 ID |
| `dev_task_id` | payload | Generator 的 dev task ID |
| `eval_round` | payload | 当前评估轮次（1 = 首次，2+ = 修复后再测） |
| `harness_mode` | payload | 固定为 true |

---

## 执行流程

### Step 1: 读取 sprint-contract.md

```bash
TASK_PAYLOAD=$(curl -s localhost:5221/api/brain/tasks/{TASK_ID} | jq '.payload')
SPRINT_DIR=$(echo $TASK_PAYLOAD | jq -r '.sprint_dir // "sprints"')
EVAL_ROUND=$(echo $TASK_PAYLOAD | jq -r '.eval_round // "1"')

cd "$(git rev-parse --show-toplevel)"

CONTRACT_FILE="${SPRINT_DIR}/sprint-contract.md"
if [ ! -f "$CONTRACT_FILE" ]; then
  echo "❌ sprint-contract.md 不存在: $CONTRACT_FILE"
  exit 1
fi

echo "✅ 读取合同: $CONTRACT_FILE"
```

### Step 2: 解析并执行验证命令

从 `sprint-contract.md` 中提取每个 Feature 的 `**验证命令**` 块，用 Node.js execSync 执行：

```javascript
const { execSync } = require('child_process');
const fs = require('fs');

const contract = fs.readFileSync(CONTRACT_FILE, 'utf8');

// 解析每个 Feature 的验证命令块
const features = [];
const featureRegex = /### (Feature [^\n]+)\n([\s\S]*?)(?=### Feature |$)/g;
let match;
while ((match = featureRegex.exec(contract)) !== null) {
  const section = match[0];
  const title = match[1].trim();
  const cmdMatch = section.match(/\*\*验证命令\*\*[^\n]*\n```(?:bash)?\n([\s\S]*?)```/);
  if (cmdMatch) {
    const commands = cmdMatch[1].trim().split('\n')
      .filter(l => l.trim() && !l.trim().startsWith('#'));
    features.push({ title, commands });
  }
}

// 执行每条命令
const results = [];
for (const feature of features) {
  const featureResult = { title: feature.title, commands: [], verdict: 'PASS' };
  for (const cmd of feature.commands) {
    let exitCode = 0, stdout = '', stderr = '';
    try {
      stdout = execSync(cmd, { timeout: 30000, encoding: 'utf8' });
    } catch (err) {
      exitCode = err.status || 1;
      stdout = err.stdout || '';
      stderr = err.stderr || err.message || '';
    }
    const cmdVerdict = exitCode === 0 ? 'PASS' : 'FAIL';
    if (cmdVerdict === 'FAIL') featureResult.verdict = 'FAIL';
    featureResult.commands.push({
      cmd, exitCode,
      stdout: stdout.slice(0, 500),
      stderr: stderr.slice(0, 200),
      verdict: cmdVerdict
    });
  }
  results.push(featureResult);
}

const overallVerdict = results.every(f => f.verdict === 'PASS') ? 'PASS' : 'FAIL';
const failedScs = results.filter(f => f.verdict === 'FAIL').map(f => f.title);
```

### Step 3: 输出 eval-round-N.md

写入 `{sprint_dir}/eval-round-${EVAL_ROUND}.md`，记录每条命令的执行结果。

### Step 4: git commit + push

```bash
cd "$(git rev-parse --show-toplevel)"
CURRENT_BRANCH=$(git branch --show-current)
git add "${SPRINT_DIR}/eval-round-${EVAL_ROUND}.md"
git commit -m "feat(eval): eval-round-${EVAL_ROUND} verdict=${VERDICT}"
git push origin "${CURRENT_BRANCH}"
```

### Step 5: 输出 JSON verdict（CRITICAL）

**最后一条消息**必须是以下 JSON（字面量，不要用代码块）：

PASS 时：
```
{"verdict": "PASS", "eval_round": N, "sprint_dir": "sprints/...", "failed_scs": []}
```

FAIL 时：
```
{"verdict": "FAIL", "eval_round": N, "sprint_dir": "sprints/...", "failed_scs": ["Feature 1"]}
```

---

## 禁止事项

1. **禁止 readFileSync + includes 静态检查**
2. **禁止读代码判断"看起来对"**
3. **禁止帮 Generator 修代码**
4. **禁止给同情分**
5. **禁止省略 eval-round-N.md**
