---
name: code-quality
version: 1.0.0
created: 2026-03-19
updated: 2026-03-19
description: |
  代码质量审查 Skill。在 /dev Step 2 代码完成后、CI 前自动触发。
  由西安 Codex 执行，读取 diff + Task Card，对代码质量作出 PASS/FAIL 判断。
  Brain task_type=code_quality_review 自动路由到此 skill。
  与 cto-review 并行执行，聚焦代码层面（cto-review 聚焦架构层面）。
---

> **CRITICAL LANGUAGE RULE：所有输出必须使用简体中文。**

# /code-quality — 代码质量审查

## 定位

在开发流程中的位置：

```
intent-expand → 写代码 → push + PR
                                ↓
                    ┌── cto-review（架构+安全）
                    ├── code-quality（代码质量）← 你在这里
                    ├── prd-audit（PRD 覆盖）
                    └── PR review（最终审查）
                                ↓
                    全部 PASS → CI → Learning → 合并
```

**职责边界**：
- code-quality：垃圾代码、重复逻辑、过度设计、命名规范（**代码层面**）
- cto-review：架构方向、安全漏洞、需求符合度（**架构层面**）
- 不做重复检查，不查 cto-review 已覆盖的内容

## 触发方式

```bash
# Brain 自动派发（无头执行）
task_type: code_quality_review
# 环境变量注入
BRAIN_TASK_ID=xxx
PARENT_TASK_ID=xxx  # 触发方的 dev 任务 ID
BRAIN_URL=http://localhost:5221
```

## 执行流程

### Phase 1: 收集上下文

```bash
# 1. 获取分支名
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# 2. 获取 diff（仅代码文件，排除文档/配置）
git diff main...HEAD -- '*.js' '*.ts' '*.sh' '*.cjs' '*.mjs' '*.jsx' '*.tsx'

# 3. 读取 Task Card（了解做什么）
cat .task-cp-*.md 2>/dev/null || cat .task-*.md 2>/dev/null
```

### Phase 2: 四维度审查

对 diff 中每个文件逐一检查以下 4 个维度：

#### 维度 1: 垃圾代码（Dead Code）

| 检查项 | 严重性 |
|--------|--------|
| 被新代码替代但未删除的旧函数/变量 | L1 |
| 注释掉的旧实现块（超过 3 行） | L2 |
| `console.log` / `debugger` 残留 | L1 |
| 未使用的 import | L2 |
| TODO/FIXME 注释指向已完成的事 | L2 |

#### 维度 2: 重复逻辑（DRY）

| 检查项 | 严重性 |
|--------|--------|
| 同文件内两段几乎相同的代码（>5 行） | L1 |
| 跨文件的重复逻辑（应提取为共用函数） | L2 |
| 复制粘贴修改（变量名不同但结构相同） | L2 |

#### 维度 3: 简洁性（Simplicity）

| 检查项 | 严重性 |
|--------|--------|
| 函数超过 30 行 | L2 |
| if-else 嵌套超过 3 层（应用 early return） | L2 |
| 手写循环可用 Array 方法替代（map/filter/find） | L3 |
| 过度抽象（为单次使用创建 helper/utility） | L2 |
| 过度配置化（hardcode 就够的地方用了配置文件） | L3 |

#### 维度 4: 命名规范（Convention）

| 检查项 | 严重性 |
|--------|--------|
| 变量/函数名与实际行为不匹配 | L1 |
| 单字母变量名（循环索引除外） | L2 |
| 布尔变量未用 is/has/should 前缀 | L3 |
| 与项目现有代码风格不一致 | L2 |

### Phase 3: 输出结论

#### 结论格式

```
CODE_QUALITY_RESULT: PASS
```

或

```
CODE_QUALITY_RESULT: FAIL

FAIL_REASONS:
1. [L1] 垃圾代码: packages/brain/src/xxx.js:42 — console.log 残留
2. [L1] 重复逻辑: packages/engine/lib/a.sh:10-25 与 b.sh:15-30 几乎相同
3. [L2] 简洁性: packages/brain/src/yyy.js:handleRequest() 45 行，建议拆分

修复建议:
- 删除 console.log（第 42 行）
- 提取 a.sh 和 b.sh 的公共逻辑到 shared.sh
- 将 handleRequest() 拆分为 validateInput() + processRequest() + formatResponse()
```

#### 决定规则

| 决定 | 条件 |
|------|------|
| **PASS** | 无 L1 问题，L2 问题 ≤ 3 个 |
| **FAIL** | 有任何 L1 问题，或 L2 问题 > 3 个 |

**L3 问题不影响 PASS/FAIL 判定**，仅作为改进建议记录。

### Phase 4: 回调 Brain

```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# PASS 时
curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "{
        \"status\": \"completed\",
        \"result\": \"PASS\",
        \"review_result\": \"CODE_QUALITY_RESULT: PASS\",
        \"l1_count\": 0,
        \"l2_count\": 0,
        \"summary\": \"代码质量审查通过，无垃圾代码/重复逻辑/过度设计问题\"
    }" \
    "${BRAIN_URL}/api/brain/execution-callback"

# FAIL 时
curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "{
        \"status\": \"completed\",
        \"result\": \"FAIL\",
        \"review_result\": \"CODE_QUALITY_RESULT: FAIL\\nFAIL_REASONS:\\n1. ...\",
        \"l1_count\": 1,
        \"l2_count\": 2,
        \"summary\": \"发现 L1 问题：console.log 残留（xxx.js:42）\"
    }" \
    "${BRAIN_URL}/api/brain/execution-callback"
```

## 约束

1. **只审查 diff 中的文件**——不扫全仓库
2. **不修改任何代码**——只报告问题，修复由 /dev 主流程负责
3. **不查架构/安全**——那是 cto-review 的职责
4. **L3 不阻塞**——只记录建议，不影响 PASS/FAIL
5. **回调中 review_result 必须包含 PASS 或 FAIL 关键字**——devloop-check.sh 用 grep 检测
