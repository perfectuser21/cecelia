---
id: gate-layers-comparison
version: 1.1.0
created: 2026-01-24
updated: 2026-01-24
changelog:
  - 1.1.0: 添加 timeout 保护修复（pr-gate v3.1）
  - 1.0.0: 三层 Gate 对比 - 当前 vs 优化后
---

# 三层 Gate 对比：当前 vs 优化后

**目的**: 明确当前防护点在哪，优化后应该调整成什么样

---

## 当前的三层 Gate（混乱）

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Hook - PreToolUse:Write|Edit (branch-protect.sh)  │
│  触发: 每次写文件                                            │
│  检查:                                                       │
│    ├─ 分支必须是 cp-* 或 feature/*                          │
│    ├─ PRD 必须存在且有效                                     │
│    └─ DoD 必须存在且有效                                     │
│  效果: ✅ 100% 防止在错误分支写代码                          │
│  问题: ❌ 无法防止写低质量代码、不写测试、跳过质检           │
└─────────────────────────────────────────────────────────────┘
                        ↓
          (AI 写代码过程 - 无防护)
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Hook - PreToolUse:Bash (pr-gate-v2.sh)            │
│  触发: 运行 Bash 命令时                                      │
│  检查:                                                       │
│    ├─ 是 gh pr create? → 检查产物 + 运行 qa                 │
│    ├─ 是 gh api /pulls? → 检查产物 + 运行 qa                │
│    └─ 是 curl api.github.com/pulls? → 检查产物 + 运行 qa    │
│  效果: ⚠️ 60% 防止创建失败的 PR                              │
│  问题: ❌ AI 可以用 Python/Node.js 绕过                      │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: GitHub Actions CI + A+ Protection                 │
│  触发: PR 创建后自动运行                                     │
│  检查:                                                       │
│    ├─ npm run typecheck ✅                                   │
│    ├─ npm run test ✅                                        │
│    ├─ npm run build ✅                                       │
│    ├─ DevGate (RCI/DoD 映射) ✅                              │
│    └─ 人工审核 ✅ (A+ 强制)                                  │
│  效果: ✅ 100% 防止合并失败的代码                            │
└─────────────────────────────────────────────────────────────┘
```

### 当前问题

| Layer | 位置 | 防护能力 | 问题 |
|-------|------|---------|------|
| Layer 1 | 写代码时 | 100% (分支/PRD/DoD) | ❌ 管不住代码质量 |
| Layer 2 | PR 创建时 | 60% (多路径) | ❌ 可被绕过 |
| Layer 3 | CI + A+ | 100% | ✅ 无问题，但太晚 |

**核心矛盾**: Layer 1 管得太宽（但管不住质量），Layer 2 管不住（多路径），Layer 3 太晚（浪费 CI）

---

## 优化后的三层 Gate（极简）

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: 入口防护 - PreToolUse:Write|Edit                  │
│  触发: 第一次写文件时                                        │
│  检查:                                                       │
│    ├─ 分支必须是 cp-* 或 feature/*  ✅                       │
│    ├─ PRD 必须存在且有效  ✅                                 │
│    └─ DoD 必须存在且有效  ✅                                 │
│  目标: 只保证进入正确的 branch/worktree                      │
│  调整: 去掉后续的干扰检查                                    │
└─────────────────────────────────────────────────────────────┘
                        ↓
          (AI 自己写代码 - 不限制)
          (写代码、写测试、质检 - AI 自觉)
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: PR 前最后检查 - PreToolUse:Bash (pr-gate-v2.sh)   │
│  触发: gh pr create / gh api / curl (检测到 PR 创建)         │
│  检查:                                                       │
│    ├─ PRD/DoD 存在  ✅                                       │
│    ├─ QA-DECISION.md 存在  ✅                                │
│    ├─ AUDIT-REPORT.md 存在 + PASS  ✅                        │
│    ├─ npm run typecheck  ✅                                  │
│    ├─ npm run test  ✅                                       │
│    └─ npm run build  ✅                                      │
│  目标: 尽量在本地拦截明显失败的 PR                           │
│  限制: 只能拦截 gh pr create/gh api/curl (60%)               │
│  接受: AI 可以用其他语言绕过 → 最终依赖 Layer 3              │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: 最终门控 - GitHub Actions CI + A+ Protection      │
│  触发: PR 创建后自动运行（无论如何创建）                     │
│  检查: 完整质检 + 人工审核                                   │
│  目标: 100% 保证代码质量                                     │
│  效果: ✅ 无法绕过                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心调整

### ✅ Layer 1: 只管入口，不管过程

**当前**:
```bash
# hooks/branch-protect.sh
# 每次 Write/Edit 都检查分支 + PRD + DoD
if [[ "$CURRENT_BRANCH" =~ ^cp- ]] || [[ "$CURRENT_BRANCH" =~ ^feature/ ]]; then
    # 检查 PRD 存在
    # 检查 DoD 存在
    # 检查内容有效
fi
```

**优化后 - 不变**:
- ✅ 保持当前逻辑
- ✅ 确保 AI 只在正确分支写代码
- ✅ 确保有 PRD/DoD

**为什么不变？**
- 这个检查是 100% 有效的（唯一路径）
- 开销很小（只是文件存在性检查）
- 防止最基本的错误

---

### ⚠️ Layer 2: pr-gate 能防什么，防不了什么

**pr-gate-v2.sh 的真实能力**:

```bash
# 1. 检测 PR 创建命令
if [[ "$COMMAND" == *"gh pr create"* ]] ||
   [[ "$COMMAND" == *"gh api"* && "$COMMAND" == *"/pulls"* ]] ||
   [[ "$COMMAND" == *"curl"* && "$COMMAND" == *"api.github.com"* ]]; then

    # 2. 运行完整检查
    npm run typecheck || exit 2
    npm run test || exit 2
    npm run build || exit 2

    # 3. 检查产物
    [[ -f .prd.md ]] || exit 2
    [[ -f .dod.md ]] || exit 2
    [[ -f docs/QA-DECISION.md ]] || exit 2
    [[ -f docs/AUDIT-REPORT.md ]] || exit 2

    # 4. 如果通过，允许创建 PR
    exit 0
fi
```

**能防什么**:
```
AI 运行: gh pr create
    ↓
pr-gate 拦截 ✅
    ↓
检查: npm run qa
    ↓
失败 → exit 2 → ✅ PR 不会被创建
成功 → exit 0 → ✅ PR 正常创建
```

**防不了什么**:
```
AI 用 Python:
    import requests
    requests.post("https://api.github.com/repos/.../pulls", ...)

pr-gate 完全不知道 ❌
    ↓
PR 被创建 ❌
    ↓
但 CI 会拦截 ✅
```

---

### ✅ Layer 3: 最终防线（不变）

**GitHub Actions CI**:
- ✅ 强制运行所有测试
- ✅ 强制 DevGate 检查
- ✅ 无法绕过

**A+ Protection**:
- ✅ CI 必须通过
- ✅ 人工审核
- ✅ 无人可以直接 push

---

## 三层 Gate 的职责划分

### 优化后的清晰职责

| Layer | 职责 | 防护能力 | 接受的限制 |
|-------|------|---------|-----------|
| **Layer 1: 入口** | 只保证进入正确分支 + PRD/DoD | 100% | 不管代码质量 |
| **Layer 2: 快速失败** | 尽量在本地拦截明显错误 | 60% | 可被绕过 → 依赖 Layer 3 |
| **Layer 3: 最终门控** | 100% 保证代码质量 | 100% | 无 |

### 每层的成本和收益

| Layer | 触发频率 | 检查成本 | 拦截率 | 价值 |
|-------|---------|---------|-------|------|
| Layer 1 | 高（每次写文件） | 低（文件检查） | 100% | ⭐⭐⭐⭐⭐ 防止基本错误 |
| Layer 2 | 低（仅 PR 时） | 中（运行 qa） | 60% | ⭐⭐⭐ 减少 CI 浪费 |
| Layer 3 | 低（仅 PR 时） | 中（CI 配额） | 100% | ⭐⭐⭐⭐⭐ 最终保证 |

---

## pr-gate 为什么只有 60%？

### 能拦截的路径（60%）

```bash
# 1. gh pr create - ✅ 100% 拦截
gh pr create --title "..." --body "..."

# 2. gh api - ✅ 100% 拦截（修复后）
gh api -X POST repos/owner/repo/pulls -f title="..." -f head="..." -f base="..."

# 3. curl - ✅ 100% 拦截（修复后）
curl -X POST https://api.github.com/repos/owner/repo/pulls \
  -H "Authorization: token $GITHUB_TOKEN" \
  -d '{"title": "...", "head": "...", "base": "..."}'
```

### 拦截不了的路径（40%）

```python
# 4. Python - ❌ 无法拦截
import requests
requests.post(
    "https://api.github.com/repos/owner/repo/pulls",
    headers={"Authorization": f"token {token}"},
    json={"title": "...", "head": "...", "base": "..."}
)
```

```javascript
// 5. Node.js - ❌ 无法拦截
fetch("https://api.github.com/repos/owner/repo/pulls", {
    method: "POST",
    headers: {"Authorization": `token ${token}`},
    body: JSON.stringify({title: "...", head: "...", base: "..."})
})
```

```go
// 6. Go - ❌ 无法拦截
http.Post("https://api.github.com/repos/owner/repo/pulls", ...)
```

### 为什么接受 60%？

**因为 Layer 3 是 100%**:

```
即使 AI 用 Python 绕过 pr-gate:
├─ PR 被创建 ❌
├─ CI 自动运行 ✅
├─ 测试失败 → 无法合并 ✅
└─ 最终结果: 低质量代码进不了 main/develop ✅
```

**唯一损失**: 浪费 CI 配额

**收益**: 不需要维护复杂的 Hook 逻辑

---

## 极简流程图

```
用户提需求
    ↓
/dev 触发
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Layer 1: 入口检查 (100% 防护)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
创建分支 → Hook 检查:
    ├─ 分支名正确? (cp-* / feature/*)
    ├─ PRD 存在且有效?
    └─ DoD 存在且有效?

不通过 → ❌ 阻止写代码
通过 → ✅ 允许进入
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AI 自己写代码 (不限制)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 写代码
- 写测试（可能不写）
- 质检（可能跳过）
- 审计（可能敷衍）
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Layer 2: PR 前检查 (60% 防护)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AI 运行: gh pr create
    ↓
pr-gate Hook 触发:
    ├─ 运行 npm run qa
    ├─ 检查产物存在
    └─ 检查 AUDIT Decision: PASS

失败 → ❌ 阻止创建 PR
成功 → ✅ 创建 PR

如果 AI 用 Python 绕过 → 直接创建 PR ⚠️
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Layer 3: 最终门控 (100% 防护)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GitHub Actions CI 自动运行:
    ├─ npm run typecheck
    ├─ npm run test
    ├─ npm run build
    ├─ DevGate 检查
    └─ Shell 语法检查

失败 → ❌ 无法合并
通过 → ✅ 等待人工审核
    ↓
A+ Protection:
    ├─ CI 必须绿
    └─ 必须有 1 个 approve

通过 → ✅ 合并到 develop
```

---

## 总结

### 当前的三层 Gate

```
Layer 1: PreToolUse:Write (每次写文件)
    └─ 检查: 分支 + PRD + DoD
    └─ 效果: ✅ 100% 防止在错误分支写代码

Layer 2: PreToolUse:Bash (PR 创建时)
    └─ 检查: 运行 qa + 产物存在
    └─ 效果: ⚠️ 60% 拦截 PR 创建

Layer 3: CI + A+ (服务器端)
    └─ 检查: 完整质检 + 人工审核
    └─ 效果: ✅ 100% 保证代码质量
```

### 优化后的三层 Gate（不变）

**不需要改！当前架构已经是最优解**:

1. **Layer 1 (100%)**: 保证进入正确分支 - 唯一路径，100% 有效
2. **Layer 2 (60%)**: 快速失败 - 尽力而为，节省 CI
3. **Layer 3 (100%)**: 最终门控 - 服务器端，无法绕过

### 核心洞察

**Hook 的价值不是 100% 防护，而是"快速失败"**:

```
没有 Hook:
    AI 写烂代码 → 创建 PR → CI 失败 → 浪费配额 + 等待时间

有 Hook (60%):
    AI 写烂代码 → gh pr create → Hook 拦截 → 立即失败 → 节省配额

有 Hook (100%):
    不可能实现（多路径问题）
```

### 最终答案

**你的流程已经是最优的**:

- ✅ Layer 1: 保证入口（分支 + PRD/DoD）- 100%
- ⚠️ Layer 2: 快速失败（pr-gate）- 60%，但这已经够了
- ✅ Layer 3: 最终门控（CI + A+）- 100%

**不需要优化，接受现实**:
- AI 可能跳过质检 → CI 会拦住
- AI 可能绕过 pr-gate → CI 会拦住
- AI 可能不写测试 → CI 会拦住

**唯一损失**: 偶尔浪费 CI 配额

**收益**: 简单、可维护、最终 100% 保证质量

---

## Timeout 保护修复 (v3.1)

### 问题

**用户发现的关键漏洞**:

```bash
# pr-gate-v2.sh (旧版)
npm run test  # ← 如果测试卡住（hang），会怎样？

if [ $? -ne 0 ]; then
    exit 2  # ← 永远走不到这里！
fi
```

**卡住场景**:
- 测试进入死循环
- 等待用户输入
- 网络请求超时但不失败
- 异步操作没有正确清理

**后果**:
```
AI 运行: gh pr create
    ↓
pr-gate 触发: npm test
    ↓
测试卡住了 ⏰
    ↓
Hook 永远等待...
    ├─ 不会 exit 0 (放行)
    ├─ 不会 exit 2 (阻止)
    └─ 用户只能 Ctrl+C 强制中断
    ↓
Claude Code 不知道发生了什么 ❓
```

### 修复

**pr-gate-v2.sh v3.1 添加 timeout 保护**:

```bash
# 配置
COMMAND_TIMEOUT=120  # 2 分钟超时

# 带 timeout 的命令执行
run_with_timeout() {
    local timeout_sec="$1"
    shift

    if command -v timeout &>/dev/null; then
        timeout "$timeout_sec" "$@"
        return $?
    else
        # 降级：没有 timeout 命令，直接运行
        "$@"
        return $?
    fi
}

# 使用
if run_with_timeout "$COMMAND_TIMEOUT" npm test >"$TEST_OUTPUT_FILE" 2>&1; then
    echo "[OK]" >&2
else
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 124 ]; then
        echo "[TIMEOUT - ${COMMAND_TIMEOUT}s]" >&2
        echo "    测试命令超时，可能卡住了" >&2
    else
        echo "[FAIL]" >&2
        tail -10 "$TEST_OUTPUT_FILE" >&2
    fi
    FAILED=1
fi
```

### 覆盖范围

所有可能卡住的命令都添加了 timeout:

| 命令 | 超时时间 | 说明 |
|------|---------|------|
| npm run typecheck | 120s | 类型检查 |
| npm run lint | 120s | 代码检查 |
| npm test | 120s | 单元测试 |
| npm run build | 120s | 构建 |
| pytest -q | 120s | Python 测试 |
| go test ./... | 120s | Go 测试 |

**Shell 语法检查不需要 timeout**:
- `bash -n file.sh` 只是语法检查，不会卡住

### 效果

**修复前**:
```
测试卡住 → Hook 永远等待 → 用户 Ctrl+C → ???
```

**修复后**:
```
测试卡住 → 120s 后 timeout → Hook exit 2 → 阻止 PR 创建 ✅
    ↓
Claude Code 收到明确错误: "[TIMEOUT - 120s]"
    ↓
用户知道发生了什么
```

### 降级处理

如果系统没有 `timeout` 命令（macOS 旧版本）:
- 降级为直接运行命令（有卡住风险）
- 但至少不会因为找不到 timeout 而失败

**建议安装 timeout**:
```bash
# Linux: 默认已有
# macOS: brew install coreutils
```

---

*生成时间: 2026-01-24*
*v3.1 更新: 添加 timeout 保护*
