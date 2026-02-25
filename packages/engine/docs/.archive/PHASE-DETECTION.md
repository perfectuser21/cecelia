# Phase Detection System

## 概述

Phase Detection 系统是质检门控的核心组件，用于判断当前分支处于哪个开发阶段，从而决定 Stop Hook 应该执行什么检查。

## 阶段定义

| 阶段 | 条件 | 目标 | Stop Hook 行为 |
|------|------|------|----------------|
| **p0** | 无 PR | 发 PR | 检查质检 → 创建 PR → 结束（不等 CI）|
| **p1** | PR + CI fail | 修到 CI 绿 | 检查质检 → 修复 CI → 继续循环 |
| **p2** | PR + CI pass | 已完成 | 直接退出（GitHub 自动 merge）|
| **pending** | PR + CI pending | 等待中 | 直接退出（稍后再查）|
| **unknown** | gh API 错误 | 安全退出 | 直接退出（不误判）|

## 实现

### 核心脚本

**位置**: `scripts/detect-phase.sh`

**调用方**: 
- `hooks/stop.sh` (line 74)
- `/dev` Skill 的各个流程节点

**输出格式**:
```
PHASE: <p0|p1|p2|pending|unknown>
DESCRIPTION: <阶段描述>
ACTION: <下一步动作>
```

### 检测逻辑

```bash
1. 检查当前分支
   ├─ 无法获取 → unknown
   └─ 获取成功 → 继续

2. 检查 gh 命令
   ├─ 不可用 → unknown
   └─ 可用 → 继续

3. 检查 PR 状态
   ├─ 无 PR → p0
   └─ 有 PR → 继续

4. 检查 CI 状态
   ├─ SUCCESS/PASS → p2
   ├─ FAILURE/ERROR → p1
   ├─ PENDING/QUEUED/IN_PROGRESS/WAITING → pending
   ├─ 空/无法获取 → unknown
   └─ 其他 → unknown
```

## 两阶段分离

### p0 阶段（Published）

**目标**: 发 PR

**流程**:
```
PRD → Branch → DoD → Code → Quality → PR → 结束
                               ↑
                         Stop Hook 检查
                         （质检 + PR创建）
```

**Stop Hook 检查**:
- ✅ L2A Audit (Decision: PASS)
- ✅ L1 自动化测试 (.quality-gate-passed)
- ✅ PR 已创建
- ❌ 不检查 CI（创建 PR 后立即结束）

### p1 阶段（CI fail 修复）

**目标**: 修到 CI 绿

**流程**:
```
循环: 检查 CI → 失败则修复 → push → 继续循环 → 成功则合并
              ↑
        Stop Hook 检查
        （CI 状态）
```

**Stop Hook 检查**:
- ✅ PR 存在
- ✅ CI 状态
  - CI fail → exit 2（继续修）
  - CI pending → exit 0（退出，等唤醒）
  - CI pass → exit 0（合并并结束）

### p2 阶段（CI pass）

**目标**: 已完成

**Stop Hook 检查**: 直接 exit 0（GitHub 自动 merge）

### pending 阶段（等待 CI）

**目标**: 等待结果

**Stop Hook 检查**: 直接 exit 0（不介入）

### unknown 阶段（API 错误）

**目标**: 安全退出

**Stop Hook 检查**: 直接 exit 0（避免误判）

## 使用示例

### 手动检测当前阶段

```bash
bash scripts/detect-phase.sh
```

输出示例:
```
PHASE: p0
DESCRIPTION: Published 阶段（无 PR）
ACTION: 质检通过后创建 PR，创建后立即结束（不等 CI）
```

### Stop Hook 中使用

```bash
# hooks/stop.sh
PHASE=$(bash "$PROJECT_ROOT/scripts/detect-phase.sh" 2>/dev/null | grep "^PHASE:" | awk '{print $2}' || echo "")

if [[ "$PHASE" == "p0" ]]; then
    # p0 阶段检查
    检查质检 + 检查 PR 创建
elif [[ "$PHASE" == "p1" ]]; then
    # p1 阶段检查
    检查质检 + 检查 CI 状态
elif [[ "$PHASE" == "p2" ]] || [[ "$PHASE" == "pending" ]]; then
    # p2/pending 直接退出
    exit 0
elif [[ "$PHASE" == "unknown" ]]; then
    # unknown 安全退出
    exit 0
fi
```

## 错误处理

### gh 命令不可用

**症状**: 输出 `PHASE: unknown` + `gh 命令不可用`

**解决**: 安装 GitHub CLI
```bash
# Ubuntu/Debian
apt install gh

# macOS
brew install gh

# 认证
gh auth login
```

### gh API 错误

**症状**: 输出 `PHASE: unknown` + `无法获取 CI 状态`

**可能原因**:
- GitHub API 限流
- 网络问题
- gh 认证过期

**解决**:
1. 检查网络连接
2. 重新认证: `gh auth login`
3. 等待一段时间后重试

### CI 状态未知

**症状**: 输出 `PHASE: unknown` + `CI 状态未知: XXX`

**原因**: GitHub Checks API 返回了非标准状态值

**解决**: 手动检查 PR 的 CI 状态
```bash
gh pr checks <PR_NUMBER>
```

## 测试

### 测试 p0 阶段

```bash
# 在没有 PR 的分支上
git checkout cp-test-feature
bash scripts/detect-phase.sh
# 预期: PHASE: p0
```

### 测试 p1 阶段

```bash
# 在有 PR 且 CI 失败的分支上
bash scripts/detect-phase.sh
# 预期: PHASE: p1
```

### 测试 p2 阶段

```bash
# 在有 PR 且 CI 通过的分支上
bash scripts/detect-phase.sh
# 预期: PHASE: p2
```

### 测试 pending 阶段

```bash
# 在有 PR 且 CI 运行中的分支上
bash scripts/detect-phase.sh
# 预期: PHASE: pending
```

### 测试 unknown 阶段

```bash
# 模拟 gh 命令失败
PATH=/tmp:$PATH bash scripts/detect-phase.sh
# 预期: PHASE: unknown
```

## 回归契约

**RCI ID**: W1-004

**描述**: detect-phase.sh 存在性和功能检查

**触发**: PR, Release

**验证**:
```bash
# 检查文件存在
test -f scripts/detect-phase.sh

# 检查可执行权限
test -x scripts/detect-phase.sh

# 检查输出格式
bash scripts/detect-phase.sh | grep -q "^PHASE:"
bash scripts/detect-phase.sh | grep -q "^DESCRIPTION:"
bash scripts/detect-phase.sh | grep -q "^ACTION:"
```

## 故障排查

### Stop Hook 报错 "detect-phase.sh: No such file or directory"

**原因**: 脚本文件不存在

**解决**: 确保 `scripts/detect-phase.sh` 存在且可执行

### Stop Hook 一直进入 unknown 阶段

**原因**: gh 命令问题或 API 错误

**排查步骤**:
1. 手动运行 `bash scripts/detect-phase.sh` 查看输出
2. 检查 `gh --version`
3. 检查 `gh auth status`
4. 检查网络连接

### 阶段判断不准确

**原因**: CI 状态值不在预期范围内

**排查**:
```bash
# 查看原始 CI 状态
gh pr checks <PR_NUMBER> --json state -q '.[].state'
```

如果状态值不在 SUCCESS/FAILURE/PENDING/QUEUED/IN_PROGRESS/WAITING/ERROR 中，需要更新 `detect-phase.sh` 的 case 判断。

## 参考

- `/dev` Skill: `~/.claude/skills/dev/SKILL.md`
- Stop Hook: `hooks/stop.sh`
- Regression Contract: `regression-contract.yaml`
