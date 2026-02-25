---
id: phase-override
version: 1.0.0
created: 2026-01-24
updated: 2026-01-24
changelog:
  - 1.0.0: PHASE_OVERRIDE 强制阶段机制
---

# PHASE_OVERRIDE 强制阶段机制

**用途**: 强制指定阶段（仅用于 p1，CI fail 通知触发时）

---

## 问题场景

### 场景 1: CI fail 通知触发

```
GitHub Actions CI fail
    ↓
发送通知（email / webhook / n8n）
    ↓
自动启动 p1 修复任务
```

**问题**:
- 如果直接运行 `detect-phase.sh`，可能因为 API 波动返回 `unknown`
- 或者 CI 状态已经从 fail 变成 pending（因为有人 push 了）

**需要**: 强制进入 p1，不管当前 CI 状态

---

## 解决方案：PHASE_OVERRIDE

### 用法

```bash
# 强制进入 p1 阶段
PHASE_OVERRIDE=p1 bash scripts/detect-phase.sh

# 输出
PHASE: p1
DESCRIPTION: CI fail 修复阶段（强制模式）
ACTION: 修复 CI → push → 退出
```

### Stop Hook 自动识别

Stop Hook 也会读取 `PHASE_OVERRIDE`：

```bash
# Stop Hook 自动检测强制阶段
PHASE_OVERRIDE=p1 # 设置环境变量
# Stop Hook 会按 p1 逻辑执行
```

---

## 使用场景

### 1. CI fail 通知触发（推荐）

```bash
# n8n / GitHub Actions / webhook 触发
PHASE_OVERRIDE=p1 /ralph-loop "修复 PR #123 的 CI 失败

当前 PR: #123
CI 状态: FAILURE

完成要求:
1. 查看 CI 失败详情: gh pr checks 123
2. 修复问题
3. push 代码
4. 输出 <promise>DONE</promise>

CI fail → 修复 → push → 退出（不挂着）
CI pending/pass → 退出
" --max-iterations 10 --completion-promise "DONE"
```

### 2. 手动强制修复

```bash
# 用户手动指定"我要修 CI"
PHASE_OVERRIDE=p1 claude-code

# 或者
export PHASE_OVERRIDE=p1
/dev  # /dev 会检测到 p1，进入 CI 修复流程
```

### 3. 测试 p1 流程

```bash
# 开发时测试 p1 逻辑
PHASE_OVERRIDE=p1 bash hooks/stop.sh < /dev/null
```

---

## 限制

### 只支持 p1

```bash
# ✅ 支持
PHASE_OVERRIDE=p1

# ❌ 不支持（会被忽略）
PHASE_OVERRIDE=p0
PHASE_OVERRIDE=p2
PHASE_OVERRIDE=pending
```

**原因**:
- p0 不需要强制（自然启动）
- p2 不需要强制（已经完成）
- p1 才需要强制（通知触发）

---

## 错误处理

### 场景 1: gh API 临时错误

**不使用 PHASE_OVERRIDE**:
```bash
bash scripts/detect-phase.sh
# → PHASE: unknown
# → ACTION: 直接退出（避免误判）
```

**使用 PHASE_OVERRIDE**:
```bash
PHASE_OVERRIDE=p1 bash scripts/detect-phase.sh
# → PHASE: p1（强制）
# → ACTION: 修复 CI（即使 API 错误）
```

### 场景 2: CI 状态变化

**不使用 PHASE_OVERRIDE**:
```bash
# 收到 CI fail 通知
# 但启动时 CI 已经变成 pending（有人 push 了）
bash scripts/detect-phase.sh
# → PHASE: pending
# → ACTION: 直接退出（不修复）
```

**使用 PHASE_OVERRIDE**:
```bash
# 强制进入 p1
PHASE_OVERRIDE=p1 bash scripts/detect-phase.sh
# → PHASE: p1（强制）
# → ACTION: 修复 CI（不管当前状态）
```

---

## 自动化集成

### n8n 工作流

```javascript
// n8n: CI fail 通知 → 触发 Cecelia
{
  "nodes": [
    {
      "name": "GitHub CI Webhook",
      "type": "webhook",
      "parameters": {
        "path": "github-ci-fail"
      }
    },
    {
      "name": "Trigger Cecelia p1",
      "type": "Execute Command",
      "parameters": {
        "command": "PHASE_OVERRIDE=p1 cecelia-run \"修复 CI...\"",
        "env": {
          "PHASE_OVERRIDE": "p1",
          "PR_NUMBER": "={{ $json.pull_request.number }}"
        }
      }
    }
  ]
}
```

### GitHub Actions

```yaml
# .github/workflows/ci-fail-fix.yml
name: CI Fail Auto Fix

on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]

jobs:
  auto-fix:
    if: ${{ github.event.workflow_run.conclusion == 'failure' }}
    runs-on: ubuntu-latest
    steps:
      - name: Trigger p1 fix
        run: |
          export PHASE_OVERRIDE=p1
          cecelia-run "修复 PR #${{ github.event.pull_request.number }} 的 CI 失败"
```

---

## 验证

### 测试 PHASE_OVERRIDE 生效

```bash
# 1. 不使用 PHASE_OVERRIDE（假设当前是 p0）
bash scripts/detect-phase.sh
# → PHASE: p0

# 2. 使用 PHASE_OVERRIDE
PHASE_OVERRIDE=p1 bash scripts/detect-phase.sh
# → PHASE: p1（强制）

# 3. Stop Hook 验证
PHASE_OVERRIDE=p1 bash hooks/stop.sh < /dev/null
# → 执行 p1 检查逻辑
```

---

## 总结

| 场景 | 不用 OVERRIDE | 用 OVERRIDE |
|------|--------------|------------|
| CI fail 通知 | 可能误判（API 错误 / 状态变化）| ✅ 强制 p1 |
| 手动修复 | 需要等 detect-phase 判定 | ✅ 直接进 p1 |
| API 临时错误 | unknown → 退出 | ✅ 强制 p1 |
| 测试 p1 | 需要构造环境 | ✅ 直接测试 |

**核心价值**: 让"CI fail 通知触发"场景更稳定，不受 API 波动影响

---

*生成时间: 2026-01-24*
