# Stop Hook v24 设计文档

日期：2026-05-20  
分支：cp-0520153709-stop-hook-v24-fix  
Notion：https://www.notion.so/Stop-Hook-v24-2026-05-20-366c40c2ba6381038adcd7e763e9bd63  
关联诊断：v23.1.0 两个 bug（session_id 传递断链 + guardian 永不退出）

---

## 目标

修复 stop hook 在无头全自动模式下完全失效的问题，使 `/dev` 会话能正确阻止 Claude 在 CI 未通过、PR 未合并前退出。

---

## 继承的 7 条要求（R1-R7，不变）

- **R1**：/dev 没做完不能让 Claude 停下来
- **R2**：同 session 可并行 3-4 条 /dev（多 worktree），各自独立
- **R3**：不同 session 之间互不影响（跨 session 隔离）
- **R4**：只在写代码时介入，普通对话零开销（灯暗快速放行）
- **R5**：不能耦合 Brain 实时可用性（hook 只读本地文件 + gh CLI）
- **R6**：Anti-cheat：Claude 不能自己宣告完成
- **R7**：/dev 卡死能自然恢复，不需人工干预

## 新增要求（v24，无头全自动）

- **R8**：block reason 必须包含具体 action（Claude 下一步做什么），不能只说"还有 N 条在跑"
- **R9**：即使 cleanup.sh 未能 kill guardian，stop hook 仍能检测 done 状态并放行
- **R10**：session_id 传递链路在无头模式下 100% 可靠（不依赖 stdin 读取顺序）

---

## 根本原因（v23.1.0 Bug 诊断）

### Bug 1（致命）：session_id 传递断链

- `stop.sh` v17 起用 `cat` 消费整个 stdin（读取 session_id 供路由）
- `stop-dev.sh` 再尝试读 stdin → 已空 → `hook_session_id=""` 
- 走 `tty_no_session_id` 分支 → `DECISION=release` → 永远放行
- 日志证据：`~/.claude/hook-logs/stop-dev.jsonl` 100% `reason_code=tty_no_session_id`

### Bug 2（设计缺口）：guardian 永不退出

- guardian 以 `ORPHAN_MODE=1 nohup disown` 启动，跳过 ppid 自检（合理，避免 worktree-manage.sh 退出时误杀）
- 但 `cleanup.sh` / `engine-ship` 没有 `SIGTERM guardian` 的逻辑
- 结果：修好 Bug 1 后灯永不灭 → 永远 block

---

## 决策模型：灯 + devloop-check 双验

```
stop hook fire
  → stop.sh：读 stdin，export CLAUDE_HOOK_SESSION_ID + CLAUDE_HOOK_CWD
  → stop-dev.sh：
      BYPASS? → exit 0 放行
      session_id 空? → exit 0 放行（非 /dev 会话）
      扫 lights/<sid_short>-*.live（mtime TTL 300s）：
        全暗 → exit 0 放行（快速通道，无 gh 调用）
        有亮灯 → classify_session(cwd)：
          not-dev → exit 0 放行
          done → kill guardian(s) + rm 灯文件 → exit 0 放行
          blocked → jq {"decision":"block","reason":"<reason>。立即执行：<action>"} → exit 0
```

**关键设计决策**：
- 灯暗时不调 classify_session（快速通道，<5ms）
- 灯亮时才调 classify_session（~2-3s，gh API，可接受）
- stop-dev.sh 始终 exit 0；block 靠 stdout JSON `{"decision":"block",...}`（Claude Code 协议）

---

## 3 处精准改动

### 改动 1：`packages/engine/hooks/stop-dev.sh`

**删除**：stdin 读取 + `[[ -p /dev/stdin ]]` 判断（约 10 行）

**替换为**：
```bash
# stop.sh 已 export CLAUDE_HOOK_SESSION_ID（不重读已消费的 stdin）
hook_session_id="${CLAUDE_HOOK_SESSION_ID:-}"
```

**新增**（灯亮后的 classify_session 调用，替换原 DECISION="block" 直接赋值）：
```bash
if (( LIGHTS_COUNT > 0 )); then
    # 有亮灯 → 调 classify_session 获取具体状态和 action
    session_result=$(classify_session "$cwd" 2>/dev/null || echo '{"status":"not-dev"}')
    session_status=$(echo "$session_result" | jq -r '.status // "not-dev"' 2>/dev/null || echo "not-dev")
    case "$session_status" in
        blocked)
            DECISION="block"
            REASON_CODE="classify_blocked"
            _reason=$(echo "$session_result" | jq -r '.reason // "Dev session in progress"' 2>/dev/null)
            _action=$(echo "$session_result" | jq -r '.action // ""' 2>/dev/null)
            BLOCK_REASON="$_reason${_action:+。立即执行：$_action}"
            ;;
        done)
            # 灯亮但业务已完成 → kill guardian + 放行
            REASON_CODE="lights_alive_but_done"
            _kill_lights_for_session "$lights_dir" "$SID_SHORT"
            ;;
        *)
            REASON_CODE="classify_not_dev_or_error"
            ;;
    esac
fi
```

**新增辅助函数**（单点出口前）：
```bash
_kill_lights_for_session() {
    local dir="$1" sid="$2"
    for lf in "$dir/${sid}-"*.live; do
        [[ -f "$lf" ]] || continue
        local gpid
        gpid=$(jq -r '.guardian_pid // ""' "$lf" 2>/dev/null || echo "")
        [[ -n "$gpid" ]] && kill "$gpid" 2>/dev/null || true
        rm -f "$lf"
    done
}
```

**行数目标**：166 行 → ~120 行（删 stdin 路径 + tty/pipe 判断，新增 classify_session 调用 + 辅助函数）

### 改动 2：`packages/engine/skills/dev/scripts/cleanup.sh`

在 `_mark_ship_and_cleanup_done` 函数内、写完 `cleanup_done: true` 之后，新增 guardian kill：

```bash
# 写完 cleanup_done 后，kill guardian + rm 灯文件（最佳努力，失败不阻塞）
_kill_guardian_for_branch() {
    local branch="$1"
    local main_repo
    main_repo=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
    [[ -z "$main_repo" ]] && return
    local lights_dir="$main_repo/.cecelia/lights"
    for lf in "$lights_dir/"*"-${branch}.live"; do
        [[ -f "$lf" ]] || continue
        local gpid
        gpid=$(jq -r '.guardian_pid // ""' "$lf" 2>/dev/null || echo "")
        [[ -n "$gpid" ]] && kill "$gpid" 2>/dev/null || true
        rm -f "$lf"
        echo "[cleanup] 已 kill guardian PID=$gpid，灯已灭：$(basename "$lf")" >&2
    done
}
_kill_guardian_for_branch "${BRANCH:-}"
```

**改动位置**：`_mark_ship_and_cleanup_done` 函数末尾（3 处调用点，只改函数体本身）

### 改动 3：`stop.sh`（不改代码）

确认 `stop.sh` 已正确 export `CLAUDE_HOOK_SESSION_ID` 和 `CLAUDE_HOOK_CWD`，v24 直接使用。无需修改。

---

## 测试策略

### T1-T12（沿用 v23，全部必须继续通过）

见 `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts`

### T13-T16（v24 新增）

| # | 场景 | 期望 |
|---|---|---|
| T13 | 灯亮 + classify=blocked + action 有值 | block reason 包含 action 文本 |
| T14 | 灯亮 + classify=done | guardian 被 kill，灯文件被删，exit 0 |
| T15 | 灯亮 + classify=not-dev | exit 0 放行（孤儿灯不影响决策）|
| T16 | session_id 空（TTY 交互）| exit 0 放行，无 block |

### 测试类型分类

- T1-T12：已有 E2E test（`stop-hook-full-lifecycle.test.ts`）
- T13-T16：新增 unit test（`packages/engine/tests/hooks/stop-dev-v24.test.ts`）
- 无需 smoke.sh（stop hook 不改 Brain 行为，是 Engine 层改动）

---

## 性能预算

| 路径 | 耗时 | 条件 |
|---|---|---|
| 灯暗快速通道 | <5ms | 普通对话、非 /dev 会话 |
| 灯亮慢速通道 | ~2-3s | classify_session（gh pr list + gh run list）|
| 无头 /dev 典型 session | <150s 额外开销 | 50 turns × 3s，占总时间 <10% |

---

## 文件变更清单

| 文件 | 改动类型 | 行数变化 |
|---|---|---|
| `packages/engine/hooks/stop-dev.sh` | 修改 | 166 → ~120（-46）|
| `packages/engine/skills/dev/scripts/cleanup.sh` | 修改 | +15 行（_kill_guardian_for_branch）|
| `packages/engine/tests/hooks/stop-dev-v24.test.ts` | 新增 | ~100 行（T13-T16）|

**不改**：`stop.sh`、`devloop-check.sh`、`dev-heartbeat-guardian.sh`、`worktree-manage.sh`

---

## 不包含

- guardian 脚本本体改动
- devloop-check.sh 改动
- worktree-manage.sh 改动
- Brain 相关改动
- T1-T12 测试改动（只新增 T13-T16）
