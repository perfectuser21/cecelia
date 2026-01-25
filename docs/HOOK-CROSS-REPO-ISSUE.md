# Hook 串线问题完整分析

## 配置层级

### 全局配置 (~/.claude/settings.json)
```json
{
  "hooks": {
    "SessionStart": [...],
    "PreToolUse": [
      {"matcher": "Write|Edit", "hooks": [{"command": "/home/xx/.claude/hooks/branch-protect.sh"}]},
      {"matcher": "Bash", "hooks": [{"command": "/home/xx/.claude/hooks/pr-gate-v2.sh"}]}
    ]
  }
}
```

### 项目级配置 (zenithjoy-engine/.claude/settings.json)
```json
{
  "hooks": {
    "SessionStart": [{"hooks": [{"command": "./hooks/session-start.sh"}]}],
    "PreToolUse": [
      {"matcher": "Write|Edit", "hooks": [{"command": "./hooks/branch-protect.sh"}]},
      {"matcher": "Bash", "hooks": [{"command": "./hooks/pr-gate-v2.sh"}]}
    ],
    "Stop": [{"hooks": [{"command": "./hooks/stop.sh"}]}]
  }
}
```

### Cecelia-OS
- ❌ 无 .claude/ 目录
- ❌ 无项目级配置
- ✅ 使用全局 hooks

## Hook 优先级

当项目有 .claude/settings.json 时：
1. **项目级 hooks** 优先
2. 全局 hooks 被覆盖

## 问题根源

### Hook 触发时机
PreToolUse Hook 在工具执行**之前**触发：

```
Bash Tool 调用: cd /home/xx/dev/Cecelia-OS && gh pr create ...
        ↓
    [触发 PreToolUse Hook]  ← PWD 还没变！
        ↓
    Hook 执行：
      - PWD = /home/xx/dev/zenithjoy-engine
      - git rev-parse --show-toplevel
        → /home/xx/dev/zenithjoy-engine
      - cd $PROJECT_ROOT
      - 检查 engine 的 .prd.md / .dod.md
      - 检查 engine 的分支
      - ⚠️  串线发生
        ↓
    [Bash 工具开始执行]
      - cd /home/xx/dev/Cecelia-OS
      - gh pr create ...
```

### 为什么总是回到 zenithjoy-engine

Bash 工具的特性：
- 每次命令执行完后，工作目录重置
- `cd /home/xx/dev/Cecelia-OS && command` 只在这一次有效
- 下次命令又回到原来的目录

## 串线的完整链条

1. **会话启动位置**: /home/xx/dev/zenithjoy-engine
2. **有项目级 hooks**: engine 的 hooks 会被触发
3. **Hook 检测逻辑**: 基于当前 PWD 的 git 仓库
4. **命令模式**: `cd X && command` 只影响这次执行
5. **结果**: 每次在 Cecelia-OS 执行命令，都触发 engine 的 hooks

## 危险场景

### 场景 1: 创建 PR
```bash
# 我想给 Cecelia-OS 创建 PR
cd /home/xx/dev/Cecelia-OS && gh pr create ...
    ↓
# 但触发了 engine 的 pr-gate Hook
# Hook 检查 engine 的 .prd.md、.dod.md、分支
# 如果 engine 有未完成的分支 → Hook 报错或通过
# Cecelia-OS 的 PR 创建可能成功，但质检的是错误的项目
```

### 场景 2: 修改文件
```bash
# 我想修改 Cecelia-OS 的代码
cd /home/xx/dev/Cecelia-OS && Edit file.ts
    ↓
# 但触发了 engine 的 branch-protect Hook
# Hook 检查 engine 的分支、PRD、DoD
# 可能会错误地拦截或放行
```

### 场景 3: Stop Hook
```bash
# 我在 Cecelia-OS 工作，想结束
# 但 PWD 还在 engine
    ↓
# 触发 engine 的 Stop Hook
# Hook 检查 engine 的质检状态、PR、CI
# 显示 engine 的分支信息
# 我被误导以为是 Cecelia-OS 的状态
```

## 解决方案

### 方案 A: 明确切换工作目录（治标）
在操作 Cecelia-OS 之前：
```bash
# 先检查
pwd
git remote -v

# 每次 Cecelia-OS 操作都带 cd
cd /home/xx/dev/Cecelia-OS && command
```

问题：Hook 仍然会串线

### 方案 B: Cecelia-OS 添加项目级配置（治标不治本）
创建 /home/xx/dev/Cecelia-OS/.claude/settings.json：
```json
{
  "hooks": {
    "PreToolUse": [
      {"matcher": "Write|Edit", "hooks": [{"command": "/home/xx/.claude/hooks/branch-protect.sh"}]},
      {"matcher": "Bash", "hooks": [{"command": "/home/xx/.claude/hooks/pr-gate-v2.sh"}]}
    ]
  }
}
```

问题：项目级 hooks 会覆盖全局，但仍然基于 PWD

### 方案 C: Hook 检测工作目录不匹配（推荐）
修改 hooks，添加安全检查：

```bash
# pr-gate-v2.sh / branch-protect.sh 开头添加
INTENDED_REPO=$(echo "$INPUT" | jq -r '.parameters.command // ""' | grep -oP 'cd\s+\K[^\s;&|]+' | head -1)

if [[ -n "$INTENDED_REPO" ]] && [[ "$INTENDED_REPO" != "$PWD"* ]]; then
    echo "[WARNING] 检测到跨仓库操作，跳过 Hook" >&2
    echo "  当前 PWD: $PWD" >&2
    echo "  目标目录: $INTENDED_REPO" >&2
    exit 0
fi
```

### 方案 D: 会话级工作目录管理（最彻底）
在 SessionStart Hook 中：
```bash
# 如果启动在某个项目，锁定到这个项目
# 任何 cd 到其他项目的操作都给出警告
```

## 优先级建议

1. **立即修复**: 方案 C - Hook 添加跨仓库检测
2. **长期优化**: 方案 D - 会话级工作目录管理
3. **临时缓解**: 我在操作前先 `pwd` 确认位置

## 影响范围

所有有项目级 hooks 的仓库：
- ✅ zenithjoy-engine
- ❓ zenithjoy-autopilot (需要检查)
- ❌ Cecelia-OS (无 .claude/)

所有操作其他仓库的场景都可能串线。
