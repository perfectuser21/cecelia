# Phase 7.1 设计：统一 claude 启动器 — Stop Hook session_id 全模式工作

**日期**：2026-04-20
**分支**：`cp-0420103233-cp-04201032-phase71-claude-launcher`
**Engine 版本**：v18.0.0 → v18.1.0（minor — 新增统一启动器，不破坏接口）

---

## 背景

Phase 7（v17.0.0 / PR #2443）修了 Stop Hook 多 worktree 路由——stop.sh 读 stdin JSON 拿 session_id、按 owner_session 精确匹配 .dev-lock。但只对 **headless** 有效：

- **Headless**：`cecelia-run.sh` 用 `claude -p --session-id <uuid>` → cmdline 有 flag → worktree-manage.sh 沿 PPID 链能解析 → owner_session 正确
- **Interactive**：用户手敲 `claude` → 无 flag → cmdline 找不到 → owner_session = "unknown" → Stop Hook 永远不匹配 → exit 0 放行

2026-04-20 实测（Phase 8.1 PR 期间）：手动 /dev 场景下 Stop Hook 完全失效，assistant "宣布完成"就真结束，阻止器循环不工作。

用户 2026-04-20 明确主张：**一套规则、支持并行、头/无头统一**。

## 核心洞察

不是代码架构有两套模式——是**源头数据缺失**的单点漏洞：
- 写 .dev-lock 时没拿到 session_id（interactive claude 没 flag）
- 匹配时拿到了 session_id（Claude Code 自动生成）但对方是 "unknown"

## 方案

**一个 launcher 脚本统一所有 claude 启动**：

```
# scripts/claude-launch.sh
#!/usr/bin/env bash
SID="${CLAUDE_SESSION_ID:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"
export CLAUDE_SESSION_ID="$SID"      # 子进程继承（worktree-manage 能读）
exec claude --session-id "$SID" "$@"
```

- Headless：`cecelia-run.sh` 调 `claude-launch.sh -p "<prompt>"`（SESSION_UUID 通过 env 传入，launcher 继承）
- Interactive：用户 `alias claude='bash scripts/claude-launch.sh'`
- 并行：每个 launcher 实例独立 session_id，各自写自己的 .dev-lock

**关键改动**：`worktree-manage.sh::_resolve_claude_session_id` 优先读 `$CLAUDE_SESSION_ID` env var——这样 launcher export 后，任何子 bash 调 worktree-manage 都能拿到。

## 方案对比（选择当前方案的理由）

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A：launcher 脚本 + env var**（选） | 一套代码；无需 Claude Code 官方改动；用户只改一次 alias | 用户需手动 source alias |
| B：改 Claude Code 官方 export session_id | 零用户配置 | 依赖 Anthropic 改动，不可控 |
| C：stop-dev.sh fallback 更宽松（无 session 下保守 block） | 零用户改动 | 破坏并行隔离；headless 任务会被交互 session 误 block |

**选 A**：代码可控 + 用户配置 1 行 + 不破坏并行。

## 变更清单

### 新建

- `scripts/claude-launch.sh`（可执行）——10 行启动器
- `packages/engine/tests/launcher/claude-launch.test.ts`——launcher 行为测试
- `packages/engine/tests/launcher/session-resolve.test.ts`——worktree-manage env 路径测试

### 修改

- `packages/brain/scripts/cecelia-run.sh`——把 `claude -p ... --session-id $UUID` 改成 `bash /path/to/claude-launch.sh -p ...`（SESSION_UUID 通过 `CLAUDE_SESSION_ID` env 传入）
- `packages/engine/skills/dev/scripts/worktree-manage.sh::_resolve_claude_session_id`——函数开头加 env 优先检查
- `.claude/CLAUDE.md`——加 shell config 说明章节
- Engine 6 处版本文件 → 18.1.0
- `packages/engine/skills/dev/SKILL.md` frontmatter version → 18.1.0
- `packages/engine/feature-registry.yml`——phase-7.1 changelog

### 不改

- `hooks/stop.sh` / `hooks/stop-dev.sh`（Phase 7 已对）
- `devloop_check` SSOT
- 其他 engine skills

## worktree-manage.sh 精确改动

```bash
_resolve_claude_session_id() {
    # Phase 7.1: env var 优先（launcher export 的）
    if [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then
        echo "$CLAUDE_SESSION_ID"
        return 0
    fi

    # Phase 7 fallback: 沿 PPID 链找 claude cmdline（不走 launcher 时）
    local pid="${PPID:-}"
    local depth=0
    while [[ -n "$pid" && "$pid" != "1" && $depth -lt 10 ]]; do
        # ... (现有代码不变)
    done
    echo ""
}
```

## cecelia-run.sh 精确改动

现有：
```bash
CLAUDE_INVOKE="claude -p \"\$1\" --session-id $SESSION_UUID"
```

改为：
```bash
# Phase 7.1: 走 claude-launch.sh 统一启动器
CLAUDE_LAUNCHER="${CECELIA_ROOT:-$(git rev-parse --show-toplevel)}/scripts/claude-launch.sh"
CLAUDE_INVOKE="CLAUDE_SESSION_ID=$SESSION_UUID bash $CLAUDE_LAUNCHER -p \"\$1\""
```

attempt >= 2（resume）保持 `claude --resume` 不变（resume 路径不需要新 session_id）。

## 测试矩阵

### claude-launch.test.ts

- Test 1：`unset CLAUDE_SESSION_ID; bash claude-launch.sh --help` → launcher 生成新 UUID 并 export（子进程 env 有）
- Test 2：`CLAUDE_SESSION_ID=test-uuid bash claude-launch.sh --help` → launcher 继承 test-uuid
- Test 3：生成的 UUID 符合小写 hex-dash 格式

> 测试用 mock claude（write 一个假的 `claude` script 在 PATH 前），让 launcher exec 到 mock 后 dump env。

### session-resolve.test.ts

- Test 1：`CLAUDE_SESSION_ID=env-uuid` + 无父 claude → worktree-manage 拿 env-uuid
- Test 2：unset env + 父进程 cmdline 有 --session-id=ppid-uuid → worktree-manage 拿 ppid-uuid
- Test 3：都没有 → worktree-manage 返回空（调用方 fallback "unknown"）

## Structured Review Block（B-5 spec approval，按 Phase 8.1 机制）

## Review（autonomous，B-5 spec approval）

**依据**：
- 用户的话：对话记录 2026-04-20 "一套规则、支持并行、头/无头统一" + "不应该有头一个模式、无头一个模式"
- 代码：`cecelia-run.sh:565` 现有 headless invoke + `worktree-manage.sh:456-470` 现有 _resolve_claude_session_id + Phase 7 PR #2443 的 Stop Hook 匹配逻辑
- OKR：Cecelia Engine KR — /dev 工作流自主化闭环（Stop Hook 循环机制完整可靠）

**判断**：APPROVE

**confidence**：HIGH

**质量分**：9/10（spec_completeness）

**风险**：
- R1：用户首次使用需手动 source shell alias——配置漂移风险。CLAUDE.md 写清楚 + 启动检测脚本可缓解（Phase 7.2 考虑）
- R2：launcher 依赖 `uuidgen`（macOS/Linux 都有，但 minimal docker 可能没）。测试覆盖 fallback 或 install 要求

**下一步**：进入 writing-plans

---

## DoD

- [ ] [ARTIFACT] `scripts/claude-launch.sh` 存在且可执行（chmod +x）
  - Test: `manual:bash -c "test -x scripts/claude-launch.sh"`
- [ ] [BEHAVIOR] launcher 无 env 时生成 UUID 并 export
  - Test: `tests/launcher/claude-launch.test.ts`
- [ ] [BEHAVIOR] launcher 有 env 时继承 + 传 --session-id 给 claude
  - Test: `tests/launcher/claude-launch.test.ts`
- [ ] [BEHAVIOR] `_resolve_claude_session_id` 优先读 env var
  - Test: `tests/launcher/session-resolve.test.ts`
- [ ] [ARTIFACT] `cecelia-run.sh` 改成调 launcher
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');if(!c.includes('claude-launch.sh'))process.exit(1)"`
- [ ] [ARTIFACT] Engine 版本 6 处 + SKILL.md 同步到 18.1.0
  - Test: `manual:bash -c "for f in packages/engine/VERSION packages/engine/.hook-core-version packages/engine/hooks/VERSION; do grep -q '18\.1\.0' \$f || exit 1; done"`
- [ ] [ARTIFACT] `.claude/CLAUDE.md` 含 claude-launch.sh alias 说明
  - Test: `manual:node -e "if(!require('fs').readFileSync('.claude/CLAUDE.md','utf8').includes('claude-launch.sh'))process.exit(1)"`
