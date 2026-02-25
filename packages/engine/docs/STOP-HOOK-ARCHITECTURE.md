---
id: stop-hook-architecture
version: 1.0.0
created: 2026-02-08
updated: 2026-02-08
changelog:
  - 1.0.0: 初始版本 - Stop Hook 路由器架构设计
---

# Stop Hook 路由器架构

## 概述

Stop Hook 是 Cecelia Engine 的循环控制机制，负责检测工作流是否完成，决定会话是否可以结束。

**版本**: v13.0.0 起采用路由器架构

## 架构设计

### 路由器模式

```
hooks/stop.sh (路由器 ~40 lines)
    ↓
检测 .xxx-mode 文件
    ↓
    ├── .dev-mode     → hooks/stop-dev.sh    (/dev 工作流)
    ├── .okr-mode     → hooks/stop-okr.sh    (/okr 拆解流程)
    └── .quality-mode → hooks/stop-quality.sh (未来)
```

### 职责分离

| 组件 | 职责 | 代码量 |
|------|------|--------|
| **stop.sh** | 路由器 - 检测 mode 文件，调用对应 handler | ~40 lines |
| **stop-dev.sh** | /dev 完成条件检查（PR 创建、CI 状态、PR 合并）| ~350 lines |
| **stop-okr.sh** | /okr 完成条件检查（PRD、DoD、Feature、Tasks）| ~50 lines (TODO) |
| **stop-quality.sh** | /quality 质检完成条件检查 | 未实现 |

## 工作流程

### 1. 路由检测

```bash
# hooks/stop.sh

# 无头模式：直接退出，让外部循环控制
if [[ "${CECELIA_HEADLESS:-false}" == "true" ]]; then
    exit 0
fi

# 获取项目根目录
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 检查 .dev-mode → 调用 stop-dev.sh
if [[ -f "$PROJECT_ROOT/.dev-mode" ]]; then
    bash "$SCRIPT_DIR/stop-dev.sh"
    exit $?
fi

# 检查 .okr-mode → 调用 stop-okr.sh
if [[ -f "$PROJECT_ROOT/.okr-mode" ]]; then
    bash "$SCRIPT_DIR/stop-okr.sh"
    exit $?
fi

# 没有任何 mode 文件 → 普通对话，允许结束
exit 0
```

### 2. /dev 完成条件检查

**stop-dev.sh** 检查：

```
1. PR 已创建？
   ❌ → exit 2 → 继续执行到创建 PR

2. CI 状态？
   - PENDING/IN_PROGRESS → exit 2 → 等待 CI
   - FAILURE → exit 2 → 修复代码
   - SUCCESS → 继续下一步

3. PR 已合并？
   ❌ → exit 2 → 合并 PR
   ✅ → 删除 .dev-mode → exit 0 → 完成
```

**退出码含义**：
- `exit 0`: 允许会话结束
- `exit 2`: 阻止会话结束，继续执行

**重试机制**：
- 最多 20 次重试
- 超过 20 次 → 发 Slack 通知 → exit 0 → 需人工介入

### 3. /okr 完成条件检查

**stop-okr.sh** 检查 5 个条件：

```
1. Feature 已创建？
   - feature_id ≠ "(待填)"
   - ❌ → exit 2 → 继续执行到创建 Feature

2. Task 已创建？
   - task_ids ≠ "(待填)"
   - ❌ → exit 2 → 继续执行到创建 Task

3. PRD 已写入？
   - prd_ids ≠ "(待填)"
   - ❌ → exit 2 → 继续编写 PRD

4. DoD 草稿已写入？
   - dod_ids ≠ "(待填)"
   - ❌ → exit 2 → 继续编写 DoD 草稿

5. KR 状态已更新？
   - kr_updated = "true"
   - ❌ → exit 2 → 继续更新 KR 状态

全部满足 → 删除 .okr-mode → exit 0（允许结束）
```

## Mode 文件格式

### .dev-mode

```
dev
branch: cp-xxx
session_id: <uuid>
tty: <tty>
prd: .prd-<branch>.md
started: 2026-02-08T09:07:45+08:00
step_1_prd: done
step_2_detect: done
...
tasks_created: true
```

**生命周期**：
- Step 3 (Branch) 创建
- Step 11 (Cleanup) 删除
- 或 PR 合并后由 Stop Hook 自动删除

### .okr-mode

```
okr
kr_id: <KR ID>
feature_id: (待填)
task_ids: (待填)
prd_ids: (待填)
dod_ids: (待填)
kr_updated: false
```

**字段说明**：
- `kr_id`: 当前拆解的 KR ID
- `feature_id`: 创建的 Feature ID（初始为 "(待填)"）
- `task_ids`: 创建的 Task IDs，空格分隔（初始为 "(待填)"）
- `prd_ids`: 写入的 PRD IDs，空格分隔（初始为 "(待填)"）
- `dod_ids`: 写入的 DoD IDs，空格分隔（初始为 "(待填)"）
- `kr_updated`: KR 状态是否已更新为 in_progress（初始为 false）

**生命周期**：
- /okr Skill 创建（Step 0）
- 每完成一步后更新对应字段
- stop-okr.sh 检查所有字段完成后删除

## 运行模式

### 有头模式（Claude Code 交互）

```
用户 → /dev → Step 1-11 → 会话尝试结束
                              ↓
                        Stop Hook 触发
                              ↓
                        检测 .dev-mode
                              ↓
            ├─ PR 未合并 → exit 2 → Claude 继续执行
            └─ PR 已合并 → 删除 .dev-mode → exit 0 → 会话结束
```

### 无头模式（Cecelia 自主运行）

```
Cecelia → cecelia-run → while 循环
                              ↓
                        CECELIA_HEADLESS=true
                              ↓
                        claude -p "/dev ..."
                              ↓
                        Stop Hook 检测到 HEADLESS → exit 0
                              ↓
                        外部 while 循环控制重试
```

**关键差异**：
- 有头模式：Stop Hook 负责循环（exit 2 阻止结束）
- 无头模式：外部 while 循环负责，Stop Hook 直接 exit 0

## 隔离机制

### Session 隔离

**问题**：多个 /dev 会话同时运行时，如何避免互相干扰？

**解决**：stop-dev.sh 检查 session_id 和 tty 匹配

```bash
# 读取 .dev-mode 中的 session_id 和 tty
DEV_SESSION_ID=$(grep "^session_id:" "$DEV_MODE_FILE" | cut -d' ' -f2)
DEV_TTY=$(grep "^tty:" "$DEV_MODE_FILE" | cut -d' ' -f2)

# 获取当前会话信息
CURRENT_SESSION_ID=$(ps -p $$ -o sess= | tr -d ' ')
CURRENT_TTY=$(tty 2>/dev/null || echo "not a tty")

# 如果不匹配，说明是其他会话创建的 .dev-mode，直接允许结束
if [[ "$CURRENT_SESSION_ID" != "$DEV_SESSION_ID" ]] || [[ "$CURRENT_TTY" != "$DEV_TTY" ]]; then
    exit 0
fi
```

## 与 Branch Protection 的配合

### 双重检查机制

```
写代码前（PreToolUse: Write/Edit）
    ↓
branch-protect.sh 检查
    ↓
    ├─ .dev-mode 存在 → 检查数据库（Brain API）
    │                     - PRD 存在？
    │                     - DoD 初稿存在？
    │
    └─ .dev-mode 不存在 → 检查本地文件
                           - .prd-*.md 存在且有效？
                           - .dod-*.md 存在且有效？
```

### 数据库检查逻辑

```bash
# branch-protect.sh (v20+)

if [[ -f "$PROJECT_ROOT/.dev-mode" ]]; then
    TASK_ID=$(grep "^task_id:" "$DEV_MODE_FILE" | cut -d' ' -f2)

    if [[ -n "$TASK_ID" ]]; then
        # 检查 PRD
        TASK_INFO=$(curl -s "http://localhost:5221/api/brain/tasks/${TASK_ID}")
        PRD_ID=$(echo "$TASK_INFO" | jq -r '.prd_id // empty')

        if [[ -z "$PRD_ID" ]]; then
            echo "[ERROR] 数据库中缺少 PRD"
            exit 2
        fi

        # 检查 DoD 初稿
        DOD_DRAFT=$(curl -s "http://localhost:5221/api/brain/dods?task_id=${TASK_ID}" | jq -r '.draft // empty')

        if [[ -z "$DOD_DRAFT" ]]; then
            echo "[ERROR] 数据库中缺少 DoD 初稿"
            exit 2
        fi

        # 数据库检查通过
        exit 0
    fi
fi

# Fallback 到本地文件检查
# ...
```

## 扩展指南

### 添加新的工作流

1. 创建新的 mode 文件定义（例如 `.quality-mode`）
2. 创建对应的 stop handler（例如 `hooks/stop-quality.sh`）
3. 在 `hooks/stop.sh` 中添加路由规则

```bash
# 检查 .quality-mode → 调用 stop-quality.sh
if [[ -f "$PROJECT_ROOT/.quality-mode" ]]; then
    bash "$SCRIPT_DIR/stop-quality.sh"
    exit $?
fi
```

### Handler 模板

```bash
#!/usr/bin/env bash
# ============================================================================
# Stop Hook: /xxx 完成条件检查
# ============================================================================
set -euo pipefail

# ===== 获取项目根目录 =====
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
XXX_MODE_FILE="$PROJECT_ROOT/.xxx-mode"

# ===== 检查 .xxx-mode 文件 =====
if [[ ! -f "$XXX_MODE_FILE" ]]; then
    exit 0
fi

# ===== 读取 mode 内容 =====
XXX_MODE=$(head -1 "$XXX_MODE_FILE" 2>/dev/null || echo "")

if [[ "$XXX_MODE" != "xxx" ]]; then
    exit 0
fi

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  [Stop Hook: /xxx 完成条件检查]" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2

# ===== 实现完成条件检查 =====
# 1. 检查条件 A
# 2. 检查条件 B
# 3. 检查条件 C

# ===== 条件满足 → 删除 mode 文件 → 允许结束 =====
rm -f "$XXX_MODE_FILE"
exit 0

# ===== 条件未满足 → 继续执行 =====
# exit 2
```

## 最佳实践

### 1. Mode 文件命名

- 使用 `.xxx-mode` 格式
- xxx 对应 skill 名称（dev, okr, quality）
- 文件内容第一行必须是 mode 名称

### 2. Handler 职责

- **只检查完成条件**，不做任何修复
- 完成 → `exit 0`，删除 mode 文件
- 未完成 → `exit 2`，保留 mode 文件
- 错误 → `exit 2`，输出错误信息

### 3. 隔离机制

- 使用 session_id 和 tty 避免多会话冲突
- 使用 branch 名称避免多分支冲突
- 无头模式检测 `CECELIA_HEADLESS` 环境变量

### 4. 重试限制

- 设置最大重试次数（建议 15-20 次）
- 超过限制 → 发 Slack 通知 → 人工介入
- 避免无限循环消耗资源

## 故障排查

### Stop Hook 不生效

```bash
# 检查 hook 是否正确安装
ls -la ~/.claude/hooks/stop.sh

# 检查 mode 文件是否存在
ls -la .dev-mode .okr-mode

# 检查 mode 文件内容
cat .dev-mode

# 手动运行 stop hook
bash ~/.claude/hooks/stop.sh
echo $?  # 应该是 0 或 2
```

### 会话无限循环

```bash
# 检查重试计数
grep "retry_count" .dev-mode

# 手动删除 mode 文件强制结束
rm -f .dev-mode

# 检查 CI 状态
gh pr view --json state,statusCheckRollup
```

### Session 隔离失效

```bash
# 检查 session_id
ps -p $$ -o sess=

# 检查 tty
tty

# 对比 .dev-mode 中的值
grep "session_id:" .dev-mode
grep "tty:" .dev-mode
```

## 版本历史

| 版本 | 变更 | 日期 |
|------|------|------|
| v13.0.0 | 重构为路由器架构 | 2026-02-08 |
| v12.x | 单一 stop.sh 文件（352 lines）| 2026-01-xx |
| v11.x | 初始 Stop Hook 实现 | 2025-12-xx |

## 参考资料

- [/dev Workflow](../skills/dev/SKILL.md)
- [Branch Protection](../hooks/branch-protect.sh)
- [Cecelia Definition](/home/xx/perfect21/cecelia/core/DEFINITION.md)
