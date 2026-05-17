# Stop Hook v23 — 单一出口重构 Spec

> 日期：2026-05-07
> Brain task：`c2b88ff6-18a1-4536-95ab-dfe2f2c6de85`
> 上层设计：`docs/design/stop-hook-v23-redesign.md`
> 前置 PR：[#2826](https://github.com/perfectuser21/cecelia/pull/2826) (PR-2 心跳模型) — 已合
> 范围：v23 hook **结构性整理**（零行为变化）

---

## 1. 目标

把 `packages/engine/hooks/stop-dev.sh` 当前 **8 个分散 `exit 0`** 收敛到 **1 个**。

```
当前：           目标：
exit 0 (line 17)   ↘
exit 0 (line 21)    ↘
exit 0 (line 23)     → DECISION 变量驱动 → 单一 exit 0 (文件末尾)
exit 0 (line 26)    ↗
exit 0 (line 40)   ↗
exit 0 (line 43)   block decision → set 变量 → 单出口
exit 0 (line 75)   block decision → set 变量 → 单出口
exit 0 (line 79)   release → set 变量 → 单出口
```

**零行为变化**。所有判定逻辑保持不变，只整理出口结构。

---

## 2. 范围

### 2.1 必做

| 模块 | 改动 |
|---|---|
| `packages/engine/hooks/stop-dev.sh` | 重构：所有路径只 set 变量；唯一 `exit 0` 在文件末尾 |
| `scripts/check-single-exit.sh` | 新增 lint：`stop-dev.sh` 中 `exit 0` 计数必须 = 1 |
| `packages/engine/tests/hooks/stop-hook-single-exit.test.ts` | 新测试：assert artifact-level "exactly one exit 0" |

### 2.2 不做

- 不改任何决策逻辑（block / release 判定全保持）
- 不动 worktree-manage / engine-ship / guardian / abort
- 不改测试矩阵（19 个 PR-2 case 全保持原样跑过）

---

## 3. 重构后的代码骨架

```bash
#!/usr/bin/env bash
# stop-dev.sh — Stop Hook v23.1.0（心跳模型 + 单一出口）
set -uo pipefail

# === 决策变量（贯穿全文，唯一被 set 的状态）===
DECISION="release"        # release | block
REASON_CODE=""            # bypass / cwd_missing / not_in_git / no_lights_dir /
                          # tty_no_session_id / no_session_id_pipe /
                          # lights_alive / all_dark
BLOCK_REASON=""           # block 时 stdout JSON 的 reason 字段
LIGHTS_COUNT=0
FIRST_BRANCH=""
SID_SHORT=""

# === 1. Hook stdin（读 session_id）===
hook_payload=""
if [[ ! -p /dev/stdin ]]; then
    hook_payload="{}"
else
    hook_payload=$(cat 2>/dev/null || echo "{}")
fi
hook_session_id=$(echo "$hook_payload" | jq -r '.session_id // ""' 2>/dev/null || echo "")

# === 2. 早退判定（只 set 变量，不 exit）===
if [[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]]; then
    REASON_CODE="bypass"
fi

cwd="${CLAUDE_HOOK_CWD:-$PWD}"
main_repo=""
lights_dir=""

if [[ -z "$REASON_CODE" ]]; then
    if [[ ! -d "$cwd" ]]; then
        REASON_CODE="cwd_missing"
    else
        main_repo=$(git -C "$cwd" worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2; exit}' || true)
        if [[ -z "$main_repo" ]]; then
            REASON_CODE="not_in_git"
        else
            lights_dir="$main_repo/.cecelia/lights"
            [[ ! -d "$lights_dir" ]] && REASON_CODE="no_lights_dir"
        fi
    fi
fi

# === 3. 决策核心（仅当 REASON_CODE 还没定）===
if [[ -z "$REASON_CODE" ]]; then
    # 加载 log_hook_decision
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    for c in "$main_repo/packages/engine/lib/devloop-check.sh" \
             "$script_dir/../lib/devloop-check.sh"; do
        [[ -f "$c" ]] && { source "$c" 2>/dev/null || true; break; }
    done
    type log_hook_decision &>/dev/null || log_hook_decision() { :; }

    if [[ -z "$hook_session_id" ]]; then
        if [[ ! -p /dev/stdin ]]; then
            REASON_CODE="tty_no_session_id"
        else
            DECISION="block"
            REASON_CODE="no_session_id_pipe"
            BLOCK_REASON="Stop hook 收到空 session_id（系统异常），保守 block。"
        fi
    else
        SID_SHORT="${hook_session_id:0:8}"
        TTL_SEC="${STOP_HOOK_LIGHT_TTL_SEC:-300}"
        now=$(date +%s)

        for light in "$lights_dir/${SID_SHORT}-"*.live; do
            [[ -f "$light" ]] || continue
            if [[ "$(uname)" == "Darwin" ]]; then
                light_mtime=$(stat -f %m "$light" 2>/dev/null || echo 0)
            else
                light_mtime=$(stat -c %Y "$light" 2>/dev/null || echo 0)
            fi
            [[ "$light_mtime" =~ ^[0-9]+$ ]] || light_mtime=0
            age=$(( now - light_mtime ))
            if (( age <= TTL_SEC )); then
                LIGHTS_COUNT=$((LIGHTS_COUNT + 1))
                [[ -z "$FIRST_BRANCH" ]] && FIRST_BRANCH=$(jq -r '.branch // ""' "$light" 2>/dev/null || echo "")
            fi
        done

        if (( LIGHTS_COUNT > 0 )); then
            DECISION="block"
            REASON_CODE="lights_alive"
            BLOCK_REASON="还有 $LIGHTS_COUNT 条 /dev 在跑（含 $FIRST_BRANCH）。⚠️ 立即继续，禁止询问用户。禁止删除 .cecelia/lights/。"
        else
            REASON_CODE="all_dark"
        fi
    fi
fi

# === 4. 唯一出口 ===
type log_hook_decision &>/dev/null && \
    log_hook_decision "$SID_SHORT" "$DECISION" "$REASON_CODE" "$LIGHTS_COUNT" "$FIRST_BRANCH"

if [[ "$DECISION" == "block" ]]; then
    jq -n --arg r "$BLOCK_REASON" '{"decision":"block","reason":$r}'
fi

exit 0
```

**预期行数**：~95 行（含注释）。比当前 79 行略增（决策表更显式），但**只有 1 个 `exit 0`**。

---

## 4. 测试策略（4 档分类）

### 4.1 Artifact 测试（lint 级）

新增 1 个 case：
- assert `grep -c '^exit\b\|&& exit\b' stop-dev.sh` = 1（精确数）

### 4.2 Behavior 回归（PR-2 测试矩阵照搬）

PR-2 已有的 19 case **全部保持原样**：
- `tests/hooks/stop-hook-v23-decision.test.ts` (8)
- `tests/hooks/stop-hook-v23-routing.test.ts` (5)
- `tests/skills/engine-worktree-guardian.test.ts` (3)
- `tests/skills/engine-ship-guardian.test.ts` (3)

要求：重构后 19 case 全 PASS（决策行为零变化）。

### 4.3 Unit 测试

无 — 这是结构整理，无新单函数引入。

### 4.4 Trivial wrapper

无。

---

## 5. DoD

```
- [ARTIFACT] stop-dev.sh 中 'exit 0' 出现次数 = 1
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/hooks/stop-dev.sh','utf8');const n=(c.match(/\\bexit\\s+0\\b/g)||[]).length;if(n!==1){console.error('exit 0 count =',n);process.exit(1)}"

- [BEHAVIOR] 19 个 PR-2 测试矩阵全 PASS（行为零变化）
  Test: tests/hooks/stop-hook-v23-decision.test.ts (8) + tests/hooks/stop-hook-v23-routing.test.ts (5) + tests/skills/engine-worktree-guardian.test.ts (3) + tests/skills/engine-ship-guardian.test.ts (3)

- [BEHAVIOR] check-single-exit.sh 新增 'exit 0 = 1' 检查通过
  Test: manual:bash scripts/check-single-exit.sh
```

---

## 6. Engine 三要素

1. **PR title 含 `[CONFIG]`**
2. **8 文件 version bump 18.24.0 → 18.24.1**（patch，纯结构整理）
3. **feature-registry.yml 加 18.24.1 changelog**

---

## 7. Commit 顺序（TDD 强制）

```
commit 1: test(engine): single-exit refactor — fail tests
  - 加 1 个新 artifact test（"exit 0 count must be 1"）
  - 当前 stop-dev.sh 有 8 个 exit 0 → fail

commit 2: [CONFIG] feat(engine): stop-dev.sh single-exit 重构
  - 重构 stop-dev.sh（DECISION 变量驱动）
  - 8 个版本文件 18.24.0 → 18.24.1
  - feature-registry changelog
  - check-single-exit.sh 加 exit-count 检查
  - 19 case 历史测试全 PASS
```

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 重构引入决策行为偏差 | PR-2 的 19 case 测试矩阵全部跑过（必须全 PASS） |
| `set -uo pipefail` 下 SID_SHORT 等变量未定义炸 | 全部变量在文件顶部初始化为空字符串 |
| log_hook_decision 调用漂移 | 决策完成后**统一**调一次，调用点唯一 |

---

## 9. 自审

- 无 placeholder
- 范围窄（只 stop-dev.sh + lint + 1 个新测试）
- TDD commit 顺序严格
- 行为零变化 — 用 19 case 历史矩阵验证
