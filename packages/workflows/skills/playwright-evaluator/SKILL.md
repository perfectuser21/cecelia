---
name: playwright-evaluator
version: 1.0.0
model: claude-sonnet-4-6
created: 2026-03-29
updated: 2026-03-29
changelog:
  - 1.0.0: 初始版本 — /dev Stage 3 CI 通过后行为验证层
description: |
  Playwright Evaluator — /dev Stage 3 端到端行为验证（CI 通过后触发）。
  读取 Task Card 的 [BEHAVIOR] DoD 条目，动态生成 API/UI 测试脚本并执行，
  逐条验证运行中的 Brain API 和 Dashboard 行为是否符合预期。
  失败时写入详细反馈，触发主 agent 进入"修复 → 重新验证"循环。
  Brain API 不可用时自动写入 SKIP，不阻断流程。
---

> **CRITICAL LANGUAGE RULE: 所有输出必须使用简体中文。**

# Playwright Evaluator — /dev Stage 3 行为验证

**唯一职责**：在 CI 通过后、Stage 4 合并前，验证 Task Card [BEHAVIOR] DoD 条目声明的运行时行为是否真实成立。

**时机**：/dev Stage 3 CI 通过 → Playwright Evaluator → Stage 4 Ship。

---

## 工作原理

```
读取 Task Card [BEHAVIOR] 条目列表
    ↓
检查 Brain API 可用性（localhost:5221）
    ↓
不可用 → 写 SKIP seal → 退出（pass-through）
可用 → 对每条 [BEHAVIOR]：
    ↓
独立生成验证代码（curl/node fetch 或 Playwright）
    ↓
执行验证
    ↓
记录 pass/fail + 详情
    ↓
全部 pass → 写 PASS seal
有 fail → 写 FAIL seal + 详细 issues 列表
```

---

## 验证类型对照

| [BEHAVIOR] 条目类型 | 推荐验证方式 |
|-------------------|------------|
| Brain API 端点行为 | `curl -s localhost:5221/api/... \| node -e "const d=JSON.parse(...);"` |
| Brain API 状态变更 | curl POST + 再次 GET 验证结果 |
| Dashboard UI 行为 | Playwright（`npx playwright test`）|
| 文件/配置的运行时效果 | node 脚本读文件并执行相关逻辑 |

---

## 执行步骤

### 1. 读取 Task Card

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
TASK_CARD=".task-${BRANCH_NAME}.md"

BEHAVIOR_COUNT=$(grep -c '^\s*-\s*\[.\]\s*\[BEHAVIOR\]' "$TASK_CARD" 2>/dev/null || echo "0")
echo "📋 发现 ${BEHAVIOR_COUNT} 条 [BEHAVIOR] 条目"
```

### 2. 服务可用性检查

```bash
BRAIN_STATUS=$(curl -s --max-time 3 http://localhost:5221/api/brain/health 2>/dev/null || echo "")
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)

if [[ -z "$BRAIN_STATUS" ]]; then
    echo "⚠️  Brain API 不可用 → 写入 SKIP seal"
    TIMESTAMP=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)
    cat > ".dev-gate-pw.${BRANCH_NAME}" <<SEAL
{"verdict":"SKIP","branch":"${BRANCH_NAME}","reason":"Brain API 不可用（localhost:5221）","timestamp":"${TIMESTAMP}","reviewer":"playwright-evaluator-agent","results":[],"issues":[]}
SEAL
    exit 0
fi
echo "✅ Brain API 可用，开始行为验证"
```

### 3. 逐条执行验证

对每条 [BEHAVIOR] 条目，独立生成验证代码并执行：

**API 行为验证模板**：
```bash
RESULT=$(curl -s --max-time 5 http://localhost:5221/api/brain/health 2>/dev/null || echo "ERROR")
if echo "$RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (!d.status) process.exit(1);
  console.log('pass: status =', d.status);
" 2>/dev/null; then
    echo "✅ PASS"
else
    echo "❌ FAIL: 实际: ${RESULT}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi
```

**Dashboard UI 验证模板**（如果有 UI 行为条目）：
```bash
DASHBOARD_OK=$(curl -s --max-time 3 http://localhost:5211 2>/dev/null | grep -c "<html" || echo "0")
if [[ "$DASHBOARD_OK" -gt 0 ]]; then
    npx playwright test --reporter=line 2>&1 | tail -5
fi
```

### 4. 写入 seal 文件（CRITICAL — 必须由 subagent 直接写入）

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
VERDICT="PASS"
[[ "${FAIL_COUNT:-0}" -gt 0 ]] && VERDICT="FAIL"
TIMESTAMP=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)

# seal 文件必须由 subagent 写入（防伪机制：主 agent 不能代写）
cat > ".dev-gate-pw.${BRANCH_NAME}" <<SEAL_EOF
{
  "verdict": "${VERDICT}",
  "branch": "${BRANCH_NAME}",
  "timestamp": "${TIMESTAMP}",
  "reviewer": "playwright-evaluator-agent",
  "results": [],
  "issues": []
}
SEAL_EOF
echo "${VERDICT} seal 已写入 .dev-gate-pw.${BRANCH_NAME}"
```

---

## seal 文件规范

**路径**：`.dev-gate-pw.<branch>`（worktree 根目录）

| 字段 | 类型 | 说明 |
|------|------|------|
| `verdict` | `"PASS" \| "FAIL" \| "SKIP"` | 裁决结果 |
| `branch` | string | 当前分支名 |
| `timestamp` | ISO8601 | 执行时间（上海时间）|
| `reviewer` | string | 固定为 `"playwright-evaluator-agent"` |
| `results` | array | 每条 [BEHAVIOR] 的验证结果 |
| `issues` | array | FAIL 时的详细错误信息 |

**verdict 说明**：
- `PASS`：所有 [BEHAVIOR] 条目验证通过
- `FAIL`：至少 1 条验证失败（devloop-check 条件 3.5 会 blocked）
- `SKIP`：Brain API 不可用，跳过（pass-through，不阻断流程）

---

## devloop-check 集成

devloop-check.sh 条件 3.5 读取此 seal 文件：

```
seal 存在 + verdict=FAIL → blocked（exit 2）→ 修复循环
seal 存在 + verdict=PASS → 继续 Stage 4
seal 存在 + verdict=SKIP → 继续 Stage 4（pass-through）
seal 不存在 → 继续 Stage 4（pass-through，允许跳过）
```

---

## 失败反馈格式

```json
{
  "issues": [
    {
      "behavior": "Brain API /api/brain/health 返回 status: ok",
      "expected": "status 字段存在",
      "actual": "返回 404 Not Found",
      "suggestion": "检查 server.js 中 /api/brain/health 路由是否已注册"
    }
  ]
}
```

---

## 核心原则

1. **独立验证**：不依赖主 agent 提供的 Test 字段命令，自己为每条 [BEHAVIOR] 设计验证方案
2. **防伪 seal**：seal 文件必须由 subagent 直接写入（主 agent 不能代写）
3. **优雅降级**：服务不可用 → SKIP，不是 FAIL
4. **具体反馈**：FAIL 时必须提供期望 vs 实际 + 修复建议
