# Stop Hook Exit-Zero 三处根因修复 设计文档

**日期**: 2026-05-22
**分支**: cp-0522091527-fix-stop-hook-exit-zero
**优先级**: P0 (Fix 1) + P1 (Fix 2 & 3)

---

## 背景

Stop hook（v24.0.1）在以下两种场景下错误 exit 0，导致 PR 永远挂起：

1. **engine-ship 过早杀 guardian**：`ship-finalize.sh` 在 PR 推送后立即 SIGTERM guardian，删除 light 文件。Stop hook 下次触发时扫不到 light（all_dark）→ exit 0。此时 CI 还没跑完、PR 还没合并，无人再等。

2. **无头模式 session ID 错位**：`executor.js` 设 `extraEnv.CLAUDE_SESSION_ID = task.id`（Brain UUID）。`worktree-manage.sh` 读此值命名 light 为 `<brain_uuid_prefix>-<branch>.live`。Stop hook 读 `CLAUDE_HOOK_SESSION_ID`（Claude Code 真实 session UUID），前缀不同 → 永远找不到 light → all_dark → exit 0。

---

## 修复设计

### Fix 1：ship-finalize.sh 移除 SIGTERM（P0）

**文件**：`packages/engine/scripts/ship-finalize.sh`

**改动**：删除第 55-61 行的 SIGTERM 块，更新文件头注释。

**改动前**：
```bash
if [[ -n "${PID:-}" && "$PID" =~ ^[0-9]+$ ]]; then
    if kill -SIGTERM "$PID" 2>/dev/null; then
        echo "[ship-finalize] SIGTERM sent to guardian pid=$PID" >&2
    else
        echo "[ship-finalize] guardian pid=$PID 已死或不存在" >&2
    fi
fi
```

**改动后**：删除以上 7 行。done-marker 继续写（诊断用）。

**正确流向**：guardian 存活 → light 存活 → 下次 stop hook 触发扫到 light → 调 `classify_session` → devloop-check.sh 检测到 PR merged + step_4_ship=done → 返回 `done` → stop hook 自调 `_kill_lights_for_session` 清理。

### Fix 2：executor.js 删除遗留 CLAUDE_SESSION_ID 注入（P1）

**文件**：`packages/brain/src/executor.js`

**改动**：删除第 3175-3177 行（注释 + 赋值）：
```js
// 无头模式下 tty 不可用，注入 CLAUDE_SESSION_ID 供 Stop Hook _session_matches() 会话隔离
// worktree-manage.sh 写 .dev-lock 时读取此变量作为 session_id 字段
extraEnv.CLAUDE_SESSION_ID = task.id;
```

**原因**：注释引用的 `_session_matches()` 和 `.dev-lock` 均已废弃（v19 时代遗留）。删除后 `_resolve_claude_session_id()` 走 PPID walk，能找到真实 Claude Code session ID（bridge 模式带 `--session-id` 启动时有效）。

### Fix 3：stop-dev.sh 加 branch 名兜底扫描（P1）

**文件**：`packages/engine/hooks/stop-dev.sh`

**插入位置**：第 189 行 `else REASON_CODE="all_dark"` 之前，即 session ID 主扫描返回 0 结果时执行。

**改动**：
```bash
# 兜底：session ID 错位时按 branch 名反扫（headless 无头模式）
if (( LIGHTS_COUNT == 0 )) && [[ -n "$hook_session_id" ]]; then
    _fb_branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [[ -n "$_fb_branch" && "$_fb_branch" != "main" && "$_fb_branch" != "HEAD" ]]; then
        for _fb_light in "$lights_dir"/*-"${_fb_branch}".live; do
            [[ -f "$_fb_light" ]] || continue
            if [[ "$(uname)" == "Darwin" ]]; then
                _fb_mtime=$(stat -f %m "$_fb_light" 2>/dev/null || echo 0)
            else
                _fb_mtime=$(stat -c %Y "$_fb_light" 2>/dev/null || echo 0)
            fi
            _fb_age=$(( now - _fb_mtime ))
            if (( _fb_age <= TTL_SEC )); then
                LIGHTS_COUNT=$((LIGHTS_COUNT + 1))
                FIRST_BRANCH="$_fb_branch"
                break
            fi
        done
    fi
fi
```

找到 light 后，LIGHTS_COUNT > 0，后续分支自然调 `classify_session`。

---

## 测试策略

| Fix | 类型 | 测试内容 |
|-----|------|---------|
| Fix 1 | unit test (shell) | ship-finalize.sh 执行后，guardian PID 仍存活（`kill -0 $PID` 成功） |
| Fix 2 | unit test (JS) | executor.js extraEnv 不含 CLAUDE_SESSION_ID 键 |
| Fix 3 | integration test (shell) | mock light（故意用错 session 前缀），stop-dev.sh 按 branch 名找到，mock classify_session 返回 blocked，验证 exit 2 |

---

## 成功标准

- `ship-finalize.sh` 执行后 guardian 进程仍活（`kill -0 $guardian_pid` 返回 0）
- `executor.js` 的 `extraEnv` 对象不包含 `CLAUDE_SESSION_ID` 键
- `stop-dev.sh` 在 session ID 错位场景下仍能 exit 2（block）而非 exit 0（release）
- 现有 stop hook 测试套件无退步

---

## DoD

- [ ] `[ARTIFACT]` `packages/engine/scripts/ship-finalize.sh` 不含 `kill -SIGTERM` 行
  - `Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/scripts/ship-finalize.sh','utf8');if(c.includes('kill -SIGTERM'))process.exit(1)"`
- [ ] `[ARTIFACT]` `packages/brain/src/executor.js` 不含 `CLAUDE_SESSION_ID = task.id`
  - `Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(c.includes('CLAUDE_SESSION_ID = task.id'))process.exit(1)"`
- [ ] `[BEHAVIOR]` stop-dev.sh branch 兜底：session ID 错位时仍能 block
  - `Test: tests/stop-hook-branch-fallback.test.ts`
- [ ] `[BEHAVIOR]` ship-finalize.sh 执行后 guardian 进程仍存活
  - `Test: tests/ship-finalize-guardian-alive.test.ts`
