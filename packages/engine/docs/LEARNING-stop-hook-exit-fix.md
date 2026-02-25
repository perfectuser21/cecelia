# Learning: Stop Hook Exit 代码修复 + Worktree 多会话检测

**日期**: 2026-02-08
**版本**: v12.10.0
**PR**: #539

---

## 问题发现

### Bug 1: Stop Hook exit 0 导致工作流失效

**现象**:
- 用户连续多个对话都遇到同样的问题：CI 提交后，Stop Hook 就停止了
- /dev 工作流无法完成完整循环（PR 创建 → CI → 合并）
- 每次都在 CI 提交后结束会话

**用户描述**:
> "你你们现在几个对话都连续出现。ci提交了就停了。然后还给我说stop，我没有出发我要的是你ci必须结束合并。整个一次run等于一次pr的成功。"

**根因**:
- v11.25.0 引入 JSON API 时，将所有 "block" 决策的 `exit 2` 改为了 `exit 0`
- Claude Code 看到 `exit 0` → 认为 Hook 通过 → 会话结束
- Stop Hook 无法阻止会话结束，循环机制失效

### Bug 2: Worktree 检测缺失导致多会话串话

**现象**:
- 用户开了两个 Engine 对话
- 两个会话都在同一个 repo 工作
- 没有自动创建 worktree 隔离

**用户描述**:
> "明明我现在开了两个engine的对话。我怎么样能让你俩知道彼此存在呢。"

**根因**:
- Step 0 (Worktree Auto) 只检测本地 `.dev-mode` 文件
- 没有检测其他 Claude 会话
- 多个会话在同一个 repo 工作时，会相互干扰（git branch 切换冲突、.dev-mode 文件被覆盖）

---

## 解决方案

### Bug 1 修复

**文件**: `hooks/stop-dev.sh`

**修改点**: 6 处 `exit 0` → `exit 2`

| Line | 场景 | 修改 |
|------|------|------|
| 250 | PR 未创建 | `exit 0` → `exit 2` |
| 294 | CI 失败 | `exit 0` → `exit 2` |
| 304 | CI 进行中 | `exit 0` → `exit 2` |
| 314 | CI 未知 | `exit 0` → `exit 2` |
| 339 | Step 11 未完成 | `exit 0` → `exit 2` |
| 350 | PR 未合并 | `exit 0` → `exit 2` |

**关键理解**:
- `exit 2` = 阻止会话结束，Claude 继续执行
- `exit 0` = 允许会话结束
- JSON API `{"decision": "block"}` 只是输出信息，真正控制会话结束的是 exit 代码

### Bug 2 修复

**新增**: 会话注册机制

1. **Step 3 (Branch)**: 创建会话注册文件
   ```bash
   /tmp/claude-engine-sessions/session-$SESSION_ID.json
   ```

   内容：
   ```json
   {
     "session_id": "xxx",
     "pid": 12345,
     "tty": "not a tty",
     "cwd": "/path/to/repo",
     "branch": "cp-task",
     "started": "2026-02-08T10:00:00+08:00",
     "last_heartbeat": "2026-02-08T10:00:00+08:00"
   }
   ```

2. **Step 0 (Worktree Auto)**: 检测其他会话
   ```bash
   for session_file in "$SESSION_DIR"/session-*.json; do
       session_repo=$(jq -r '.cwd' "$session_file")
       session_pid=$(jq -r '.pid' "$session_file")

       # 同一个 repo 且不是自己
       if [[ "$session_repo" == "$CURRENT_REPO" ]] && [[ "$session_pid" != "$$" ]]; then
           if ps -p "$session_pid" >/dev/null 2>&1; then
               NEED_WORKTREE=true
               break
           fi
       fi
   done
   ```

3. **Step 11 (Cleanup)**: 清理会话注册
   ```bash
   # 删除当前会话
   rm -f "$SESSION_DIR/session-$SESSION_ID.json"

   # 清理过期会话（超过 1 小时）
   find "$SESSION_DIR" -name "session-*.json" -mmin +60 -delete
   ```

---

## 关键经验

### 1. Exit 代码的语义非常关键

- Hook 返回的 exit 代码直接控制会话是否结束
- 不能因为引入 JSON API 就改变 exit 代码的语义
- JSON API 是**信息**，exit 代码是**控制**

### 2. 多会话并发需要显式检测

- 不能只依赖本地文件（.dev-mode）
- 需要跨进程的注册机制（/tmp/claude-engine-sessions/）
- 使用 PID + 进程检查确保会话活跃度

### 3. 测试覆盖关键场景

**新增测试**:
- `tests/hooks/stop-hook-exit-codes.test.ts` - 验证所有 exit 代码场景
- `tests/skills/worktree-multi-session.test.ts` - 验证多会话检测
- `tests/skills/session-registration.test.ts` - 验证会话注册生命周期

### 4. CI 要求完整性

**必须更新**:
- `.hook-core-version` - 手动更新（sync-version.sh 不更新）
- `feature-registry.yml` - 能力变更必须登记
- `regression-contract.yaml` - 新增回归测试条目（H7-010, H7-011, H7-012）

---

## 影响范围

### 修复后的行为

**Stop Hook**:
- PR 未创建 → `exit 2` → 继续执行创建 PR
- CI 进行中 → `exit 2` → 等待 CI 完成
- CI 失败 → `exit 2` → 修复问题并重新 push
- PR 未合并 → `exit 2` → 合并 PR
- PR 已合并 + Step 11 完成 → `exit 0` → 会话结束

**Worktree 检测**:
- 单会话工作 → 不创建 worktree（正常流程）
- 双会话并行 → 第二个会话自动创建 worktree 隔离
- 会话结束 → 自动清理注册文件
- 过期会话 → 自动清理（超过 1 小时）

### 防止回归

**回归契约**:
- H7-010: Stop Hook exit 代码修复
- H7-011: Worktree 多会话检测
- H7-012: 会话注册机制

**测试覆盖**:
- 所有 exit 代码场景
- 多会话并发场景
- 会话注册生命周期

---

## 待改进

### 潜在问题

1. **会话注册清理时机**
   - 当前只在 Step 11 清理
   - 如果会话异常退出（崩溃、网络中断），注册文件可能残留
   - 依赖过期清理机制（1 小时）

2. **PID 检查的局限性**
   - `ps -p $pid` 只能检查进程是否存在
   - 无法区分是否是 Claude 进程
   - 可能误判（PID 被重用）

### 改进方向

1. **更健壮的会话清理**
   - 考虑在 Stop Hook 中也清理会话注册（兜底）
   - 缩短过期时间（1 小时 → 30 分钟）

2. **更准确的进程检查**
   - 检查进程名称（ps -p $pid -o comm=）
   - 验证是 claude 进程

3. **心跳机制**
   - 定期更新 last_heartbeat
   - 更准确地判断会话活跃度

---

## 总结

这次修复解决了两个 P0 Critical Bug，恢复了 /dev 工作流的核心能力：

1. **Stop Hook 循环机制恢复**：修复 exit 代码，确保工作流完整执行到 PR 合并
2. **多会话并发隔离**：通过会话注册机制，自动检测并创建 worktree 隔离

关键教训：
- 不要因为表面的需求（JSON API）改变底层的控制机制（exit 代码）
- 多会话并发需要显式的注册和检测机制，不能只依赖本地文件
- 测试覆盖和回归契约是防止问题再次出现的关键
