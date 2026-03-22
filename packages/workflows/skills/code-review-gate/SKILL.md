---
name: code-review-gate
version: 1.0.0
model: claude-sonnet-4-6
created: 2026-03-20
updated: 2026-03-20
changelog:
  - 1.0.0: 合并 code_quality + /simplify 为统一代码审查 Gate
description: |
  代码审查 Gate（Codex Gate 3/4）。合并了 code_quality（代码质量审查）和 /simplify（代码简化）。
  在 /dev Stage 3 CI 通过后、合并之前触发。
  覆盖安全、正确性、复用性、命名、效率、可维护性六个维度。
  给出 PASS / FAIL 裁决。
  触发词：代码审查、code-review-gate、合并前检查、代码门禁。
---

> **CRITICAL LANGUAGE RULE: 所有输出必须使用简体中文。**

# Code-Review-Gate — 代码审查 Gate

**唯一职责**：在 CI 通过后、PR 合并之前，审查代码质量。

合并了以下两个旧 Skill 的职责：
- `code_quality`：安全性、正确性审查
- `/simplify`：复用性、命名、效率优化

**时机**：/dev Stage 3 CI 通过 -> Code-Review-Gate 审查 -> 通过后才能合并 PR。

---

## 触发方式

```
/code-review-gate                        # 审查当前 PR
/code-review-gate --pr <number>          # 指定 PR 编号
/code-review-gate --scope <path>         # 只审查指定路径
```

### Brain 自动派发

```json
{
  "task_type": "code_review_gate",
  "pr_number": 123,
  "repo_path": "/path/to/repo",
  "branch_name": "cp-XXXX-feature"
}
```

---

## 输入

从当前分支改动获取变更文件列表，逐文件审查。
在 /dev Stage 2（push 前）触发，此时无 PR，用 git diff。

```bash
# 获取变更文件列表
git diff origin/main..HEAD --name-only
# 获取完整 diff（最多 100KB）
git diff origin/main..HEAD
```

---

## 审查维度

### 维度 A：安全性

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **SQL 注入** | blocker | 检查 SQL 拼接（非参数化查询） |
| **命令注入** | blocker | exec/spawn + 用户输入拼接 |
| **XSS** | blocker | 用户输入直接渲染到 HTML |
| **硬编码凭据** | blocker | password= / key= / secret= / token= 硬编码值 |
| **认证绕过** | blocker | API 端点缺少认证检查 |
| **敏感信息泄露** | warning | 日志中打印了敏感数据 |

### 维度 B：正确性

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **逻辑错误** | blocker | 条件判断反转、算法错误 |
| **边界条件** | blocker | 空数组、null、undefined 未处理 |
| **未处理的 error** | blocker | catch 块为空或只 console.log |
| **异步问题** | warning | 缺少 await、Promise 未处理 |
| **资源泄露** | warning | 连接、文件句柄未关闭 |
| **类型错误** | warning | 隐式类型转换可能导致问题 |

### 维度 C：复用性（来自 /simplify）

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **重复代码** | warning | 同一逻辑重复 3 次以上，应提取函数 |
| **大段复制** | warning | 跨文件复制粘贴 > 20 行相似代码 |
| **工具函数缺失** | info | 多处使用的通用逻辑未抽取为工具函数 |

### 维度 D：命名（来自 /simplify）

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **变量命名** | info | 单字母变量（循环变量除外）、无意义命名 |
| **函数命名** | info | 函数名不能反映其功能 |
| **常量命名** | info | 魔法数字未提取为命名常量 |

### 维度 E：效率（来自 /simplify）

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **不必要的循环** | warning | O(n^2) 可优化为 O(n)、嵌套循环可用 Map 替代 |
| **过度抽象** | info | 为单一用途创建了复杂的类层次结构 |
| **不必要的依赖** | info | 引入整个库只用了一个函数 |

### 维度 F：可维护性

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **文件过大** | warning | 单文件 > 500 行，应拆分 |
| **关注点混合** | warning | 一个函数做了多件不相关的事 |
| **注释代码** | info | 遗留的注释代码块未清理 |
| **未用 import** | info | 导入了但未使用的模块 |
| **console.log 残留** | info | 调试用的 console.log 未清理 |

---

## 裁决规则

### PASS

所有维度无 blocker 级别问题。warning 和 info 记录但不阻塞。

### FAIL

以下任一情况为 FAIL：
- 任何 blocker 级别问题存在
- 安全维度发现任何注入或凭据暴露

FAIL 时必须修复 blocker 后重新提交审查，不能合并 PR。

---

## 输出格式（必须 JSON）

```json
{
  "verdict": "PASS | FAIL",
  "issues": [
    {
      "severity": "blocker | warning | info",
      "dimension": "A | B | C | D | E | F",
      "file": "path/to/file.js",
      "line": 42,
      "description": "具体问题描述",
      "suggestion": "修正建议或示例代码"
    }
  ],
  "stats": {
    "blocker": 0,
    "warning": 2,
    "info": 3
  },
  "summary": "一句话总结"
}
```

---

## Brain 回调

审查完成后回调 `/api/brain/execution-callback`：

```bash
curl -s -X POST http://localhost:5221/api/brain/execution-callback \
  -H "Content-Type: application/json" \
  -d "{
    \"task_id\": \"$TASK_ID\",
    \"run_id\": \"$RUN_ID\",
    \"status\": \"AI Done\",
    \"result\": {
      \"verdict\": \"PASS\",
      \"blocker_count\": 0,
      \"warning_count\": 2,
      \"summary\": \"$SUMMARY\"
    }
  }"
```

---

## 与现有 /code-review 的关系

| Skill | 职责 | 时机 |
|-------|------|------|
| `/code-review` | 日常巡检（时间窗口扫描、Initiative 集成审查） | 定时 / Brain 派发 |
| `/code-review-gate` | 单 PR 合并门禁（阻塞性审查） | /dev Stage 3 后 |

两者不冲突：`/code-review` 是主动巡逻，`/code-review-gate` 是必经关卡。

---

## 核心原则

1. **合并前最后一关**：通过了才能合并，不通过就修
2. **blocker 零容忍**：安全问题和逻辑错误必须修复
3. **具体到行号**：每个 issue 指出具体文件和行号
4. **建议可执行**：suggestion 给出具体的修复代码或方案
5. **快速审查**：一次审查不超过 5 分钟
