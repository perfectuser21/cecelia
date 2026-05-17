# Stop Hook v23 — PR-2 核心切换 Spec

> 日期：2026-05-07
> Brain task：`f29c8f71-584d-46dd-8c0d-3920db3aa261`
> 上层设计：`docs/design/stop-hook-v23-redesign.md`
> 前置 PR：[#2823](https://github.com/perfectuser21/cecelia/pull/2823) (PR-1 基础设施) — 已合
> 范围：v23 重构 3-PR 序列的 **第 2 个**（核心切换）

---

## 1. 目标

把 stop hook 从 v22 的"档案 + 双通道路由"模型切到 v23 的"心跳 + 单 key"模型。

**v22 → v23 切换内容**：
- stop-dev.sh：**209 行 → ~60 行**
- 决策依据：`.cecelia/dev-active-*.json` JSON 字段 → `.cecelia/lights/<sid_short>-<branch>.live` mtime
- 所有权键：cwd 路由 + session_id 双通道 → 单一 session_id（文件名前缀）
- 完成判定：调 verify_dev_complete 跑 P1-P7 状态机 → 看心跳 mtime（OS 级事实）

PR-1 已建好基础设施（guardian / abort / log_hook_decision / launcher dry-run）。本 PR 接入它们，让心跳真正"运转起来"。

---

## 2. 范围

### 2.1 必做

| 模块 | 改动 |
|---|---|
| `packages/engine/hooks/stop-dev.sh` | **完整重写为 ~60 行**，使用心跳模型决策 |
| `packages/engine/skills/dev/scripts/worktree-manage.sh` | 新增：fork dev-heartbeat-guardian.sh + 写灯文件 JSON |
| `packages/engine/skills/dev/scripts/cleanup.sh` 或同等 ship 路径 | 新增：写 done-marker + SIGTERM guardian |
| `packages/engine/tests/hooks/stop-hook-v23-decision.test.ts` (new) | 12 个 contract test |
| `packages/engine/tests/hooks/stop-hook-v23-routing.test.ts` (new) | 路由/特殊场景测试 |
| `packages/engine/tests/skills/engine-worktree-guardian.test.ts` (new) | 启动 guardian 集成测试 |
| `packages/engine/tests/skills/engine-ship-guardian.test.ts` (new) | 关 guardian 集成测试 |
| `packages/engine/feature-registry.yml` | 加 changelog 18.24.0（minor，行为切换） |

### 2.2 不做（留给 PR-3）

| 不做 | 理由 |
|---|---|
| 删 `worktree-manage.sh` 里的 `.cecelia/dev-active-*.json` 创建逻辑 | 过渡期保留，避免老 hook 残余引用炸；PR-3 范围 |
| 删 `verify_dev_complete` 函数本体 | hook 不再调，但其他地方可能仍在用；PR-3 审查后删 |
| 删 `devloop-check.sh` 内 hook 专用代码 | 同上 |
| 删 PreToolUse 8 段闭环 | 与新 hook 正交，是另一道防线，不动 |
| 删现网遗留 `.cecelia/dev-active-*.json` 文件 | 由 reaper（独立项目）或 PR-3 统一清 |

---

## 3. 核心架构

### 3.1 心跳生命周期（端到端）

```
/dev 启动（worktree-manage.sh init-or-check）
  │
  ├─ 创建 worktree、写 .dev-lock、写 .dev-mode
  ├─ 写 .cecelia/dev-active-<branch>.json （v22 兼容，PR-3 删）
  └─ NEW：
      ├─ 创建 .cecelia/lights/ 目录（mkdir -p）
      ├─ fork dev-heartbeat-guardian.sh `<light_file>` &  （后台）
      ├─ 写 .cecelia/lights/<sid_short>-<branch>.live（JSON: session_id, branch, worktree, started_at, host, guardian_pid, stage="stage_0_init"）
      └─ 输出 guardian PID 给后续 ship 引用

  ↓ /dev 跑（assistant 写代码、push、PR、CI）
  ↓ guardian 每 60s touch 灯文件，mtime 维持新鲜
  ↓ stop hook 每次 turn 结束 fire：
      看 lights/<sid_short>-*.live 任一新鲜 → block
      全黑 → release

/dev 完成（engine-ship 路径）
  │
  ├─ 写 .cecelia/done-markers/<sid_short>-<branch>.done（审计）
  ├─ kill -SIGTERM <guardian_pid>（guardian trap 自删 light）
  └─ 标记 step_4_ship: done
```

### 3.2 stop-dev.sh ~60 行结构

```bash
#!/usr/bin/env bash
# stop-dev.sh — Stop Hook v23.0.0（心跳模型）
# 决策：扫 .cecelia/lights/<sid_short>-*.live，任一 mtime < 5min → block
set -uo pipefail

# === 1. Hook stdin（Claude Code Stop Hook 协议必传 session_id）===
payload=$(cat 2>/dev/null || echo "{}")
hook_session_id=$(echo "$payload" | jq -r '.session_id // ""' 2>/dev/null || echo "")

# === 2. Bypass 逃生通道 ===
[[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]] && exit 0

# === 3. 找主仓库 ===
cwd="${CLAUDE_HOOK_CWD:-$PWD}"
[[ ! -d "$cwd" ]] && exit 0
main_repo=$(git -C "$cwd" worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2}' || true)
[[ -z "$main_repo" ]] && exit 0

lights_dir="$main_repo/.cecelia/lights"
[[ ! -d "$lights_dir" ]] && exit 0

# === 4. session_id 缺失：tty 放行 / 真实 fire 保守 block ===
if [[ -z "$hook_session_id" ]]; then
    [[ -t 0 ]] && exit 0
    log_hook_decision "" "block" "no_session_id" 0 ""
    jq -n '{"decision":"block","reason":"Stop hook 收到空 session_id（系统异常），保守 block。"}'
    exit 0
fi

sid_short="${hook_session_id:0:8}"

# === 5. 加载 log_hook_decision（PR-1 落点：devloop-check.sh）===
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for c in "$main_repo/packages/engine/lib/devloop-check.sh" \
         "$script_dir/../lib/devloop-check.sh"; do
    [[ -f "$c" ]] && { source "$c"; break; }
done
type log_hook_decision &>/dev/null || log_hook_decision() { :; }

# === 6. 扫自己 session 的灯，看新鲜度 ===
TTL_SEC="${STOP_HOOK_LIGHT_TTL_SEC:-300}"  # 5min 默认
now=$(date +%s)
my_alive_count=0
my_first_branch=""

for light in "$lights_dir/${sid_short}-"*.live; do
    [[ -f "$light" ]] || continue
    if [[ "$(uname)" == "Darwin" ]]; then
        light_mtime=$(stat -f %m "$light" 2>/dev/null || echo 0)
    else
        light_mtime=$(stat -c %Y "$light" 2>/dev/null || echo 0)
    fi
    age=$(( now - light_mtime ))
    if (( age <= TTL_SEC )); then
        my_alive_count=$((my_alive_count + 1))
        [[ -z "$my_first_branch" ]] && my_first_branch=$(jq -r '.branch // ""' "$light" 2>/dev/null)
    fi
done

# === 7. 决策 ===
if (( my_alive_count > 0 )); then
    log_hook_decision "$sid_short" "block" "lights_alive" "$my_alive_count" "$my_first_branch"
    full_reason="还有 $my_alive_count 条 /dev 在跑（含 $my_first_branch）。⚠️ 立即继续，禁止询问用户。禁止删除 .cecelia/lights/。"
    jq -n --arg r "$full_reason" '{"decision":"block","reason":$r}'
    exit 0
fi

log_hook_decision "$sid_short" "release" "all_dark" 0 ""
exit 0
```

**实测目标行数**：~70 行（含注释 + 兜底），相比 v22 的 209 行减少 66%。

### 3.3 灯文件 JSON schema（worktree-manage.sh 创建）

```json
{
  "session_id": "abc12345-full-uuid",
  "session_id_short": "abc12345",
  "branch": "cp-0507154143-stop-hook-v23-pr2",
  "worktree_path": "/Users/.../perfect21/cp-0507154143-stop-hook-v23-pr2",
  "started_at": "2026-05-07T23:41:43+08:00",
  "host": "us-mac-mini",
  "guardian_pid": 12345,
  "stage": "stage_0_init"
}
```

### 3.4 done-marker JSON schema（engine-ship 写入）

```json
{
  "branch": "cp-0507154143-stop-hook-v23-pr2",
  "completed_at": "2026-05-07T23:50:00+08:00",
  "pr_number": 2824,
  "pr_url": "https://github.com/.../pull/2824",
  "merged": true,
  "guardian_pid": 12345
}
```

---

## 4. 测试策略（4 档分类）

### 4.1 E2E 测试（跨进程 / 持久化 / I/O）

| 测试 | 验证 | 落点 |
|---|---|---|
| guardian-lifecycle-e2e | engine-worktree fork guardian → 灯文件存在 + mtime 持续刷新 | tests/skills/engine-worktree-guardian.test.ts |
| ship-cleanup-e2e | engine-ship 写 done-marker + SIGTERM guardian + 灯文件被清 | tests/skills/engine-ship-guardian.test.ts |
| stop-hook-multi-stream-e2e | 3 个 worktree 同时活，hook 看到 3 灯，block；ship 1 个，剩 2 灯，仍 block | tests/hooks/stop-hook-v23-decision.test.ts |

### 4.2 Integration 测试（跨多模块）

| 测试 | 验证 | 落点 |
|---|---|---|
| 多 session 隔离 | session A 的灯不影响 session B 的 hook | tests/hooks/stop-hook-v23-routing.test.ts |
| cwd drift 不放行 | assistant 在主仓库 main 时 hook 仍 block 自己 session 的 lights | tests/hooks/stop-hook-v23-routing.test.ts |
| Brain 离线无影响 | docker stop brain 后 hook 决策不变 | tests/hooks/stop-hook-v23-routing.test.ts |

### 4.3 Unit 测试（单函数行为）

| 测试 | 验证 | 落点 |
|---|---|---|
| 灯亮（mtime 新鲜）→ block | mtime < TTL_SEC | tests/hooks/stop-hook-v23-decision.test.ts |
| 灯熄（mtime > TTL_SEC）→ release | mtime > TTL_SEC | 同上 |
| 所有 sid_short 不匹配 → release | 别人的灯不算自己 | 同上 |
| session_id 缺 + tty → release | 手动测试场景 | 同上 |
| session_id 缺 + 非 tty → block | 系统异常防御 | 同上 |
| BYPASS=1 → release | 逃生通道 | 同上 |
| 灯文件 JSON 损坏 → block | fail-closed | 同上 |
| lights/ 目录不存在 → release | 普通对话 | 同上 |
| 文件名前缀冲突（hash collision） → 第二 pass full sid 比较 | 可选，YAGNI 不实现 | 不写 |

### 4.4 Trivial wrapper（不写测试）

无 — 本 PR 所有改动都涉及 I/O 或跨进程。

---

## 5. DoD

```
- [ARTIFACT] stop-dev.sh ≤ 80 行（含注释）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/hooks/stop-dev.sh','utf8');if(c.split('\n').length>80)process.exit(1)"

- [ARTIFACT] worktree-manage.sh 含 dev-heartbeat-guardian.sh fork 调用
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/worktree-manage.sh','utf8');if(!c.includes('dev-heartbeat-guardian.sh'))process.exit(1)"

- [ARTIFACT] cleanup/ship 路径含 SIGTERM guardian + done-marker 写入
  Test: manual:node -e "const fs=require('fs');const files=['packages/engine/skills/dev/scripts/cleanup.sh'];const found=files.some(f=>{try{return fs.readFileSync(f,'utf8').includes('done-markers')}catch{return false}});if(!found)process.exit(1)"

- [BEHAVIOR] 灯亮 → hook block — Test: tests/hooks/stop-hook-v23-decision.test.ts
- [BEHAVIOR] 灯熄 → hook release — Test: 同上
- [BEHAVIOR] 多流并发任一活 → block — Test: 同上
- [BEHAVIOR] 跨 session 隔离 — Test: tests/hooks/stop-hook-v23-routing.test.ts
- [BEHAVIOR] cwd drift 仍 block — Test: 同上
- [BEHAVIOR] session_id 缺失（非 tty）→ block — Test: 同上
- [BEHAVIOR] BYPASS=1 → release — Test: 同上
- [BEHAVIOR] engine-worktree 启动 guardian + 写灯 — Test: tests/skills/engine-worktree-guardian.test.ts
- [BEHAVIOR] engine-ship 关 guardian + 写 done-marker — Test: tests/skills/engine-ship-guardian.test.ts
```

---

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 现网在跑的 /dev 被新 hook 误放行（无 lights/，但有老 dev-active） | 过渡期：worktree-manage.sh 同时创老文件 + 新灯文件；新 hook 只看灯文件；老 /dev 跑完前没新灯 → 第一次 turn 结束就放行（已知缺陷，可接受：现网此刻只有本 session 一个 /dev，PR-2 切换前可干净） |
| guardian fork 失败导致灯没创建 → hook 立即放行 | worktree-manage.sh 创灯文件后 sleep 1s 验证文件存在；不存在则 abort + 报错 |
| TTL=300s 是否合理 | 60s touch + 300s TTL = 容忍 5 次连续 touch 失败，足够 |
| guardian fork 后变孤儿（PPID=1） | 已在 PR-1 的 ppid 自检中处理 |
| 老 verify_dev_complete 还在被其他地方调（残余引用） | grep 整 codebase 确认引用范围；新 hook 不再调，不动其他调用方 |

---

## 7. Engine 三要素

按 CLAUDE.md "Engine skills 改动三要素"：

1. **PR title 含 `[CONFIG]`** — 改 packages/engine/，必须加
2. **Engine 7 文件 version bump** — 18.23.1 → **18.24.0**（minor，行为切换）
   - VERSION / package.json / package-lock.json / .hook-core-version / hooks/VERSION / hooks/.hook-core-version / regression-contract.yaml / skills/dev/SKILL.md
3. **feature-registry.yml changelog 加 18.24.0** — stop-hook 切换 v22→v23 + dev-heartbeat-guardian 状态从 prepared 升 active

---

## 8. Commit 顺序（TDD 强制）

```
commit 1: test(engine): stop-hook-v23 PR-2 — fail tests
  - tests/hooks/stop-hook-v23-decision.test.ts
  - tests/hooks/stop-hook-v23-routing.test.ts
  - tests/skills/engine-worktree-guardian.test.ts
  - tests/skills/engine-ship-guardian.test.ts

commit 2: [CONFIG] feat(engine): stop-hook-v23 PR-2 — 心跳模型核心切换
  - packages/engine/hooks/stop-dev.sh（重写）
  - packages/engine/skills/dev/scripts/worktree-manage.sh（加 guardian fork + 灯文件）
  - packages/engine/skills/dev/scripts/cleanup.sh（加 SIGTERM + done-marker）
  - 8 个版本文件 18.24.0
  - feature-registry.yml changelog
  - check-single-exit.sh 更新（新 hook 没有 verify_dev_complete 调用，需改 lint）
```

---

## 9. 验收（merge 前必须满足）

1. ✅ DoD 9 条全部 `[x]`
2. ✅ CI 全绿
3. ✅ Learning 文件已写
4. ✅ 本机手测：
   - 启动一个真 /dev → 看灯文件创建 + guardian 进程在跑
   - turn 结束 → hook block（灯亮）
   - 杀 guardian → 灯消失 → 下次 hook → release
   - abort-dev.sh → 灯被清 + done-marker 写入

---

## 10. 自审

- 无 placeholder（"TBD"/"TODO"/"待补"）
- spec § 5 DoD 与 § 4 测试策略一一对应
- spec § 2 必做 / 不做清单覆盖完整
- spec § 8 commit 顺序符合 TDD 红线
- 测试文件路径与 plan 一致（待 plan 检查）

---

## 11. 后续

PR-3 范围（合并 24h 后开）：
- 删 worktree-manage.sh 创建 dev-active-*.json 的代码段
- 删 verify_dev_complete 函数本体（如果 grep 确认无其他调用方）
- 删 devloop-check.sh 中只为 hook 服务的代码
- 现网 .cecelia/dev-active-*.json 残留迁移脚本
